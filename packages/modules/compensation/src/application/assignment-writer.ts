import type { Transaction } from '@work/kernel';

import { checkedMoney, type MoneyAmount, type MoneyInput } from '../domain/money-amount.js';
import { recurring, type RecurringState } from '../domain/recurring.js';
import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import { basisCurrencyAgrees } from './percentage-resolution.js';
import {
  componentFor,
  employmentFor,
  inForceRecord,
  initialApprovalState,
  permittedByPlan,
  planFor,
  withinGrade,
} from './assignment-context.js';
import { closePeriod, insertRecurring, recordChange } from './recurring-writer.js';
import { currentActor, currentTenant } from './compensation-context.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState } from '../domain/compensation-plan.js';
import type { CompensationDependencies } from './compensation-dependencies.js';
import type { Metadata } from '../domain/compensation-aggregate.js';

/**
 * One recurring assignment, from the checks through the supersession to the history row.
 *
 * Shared by the assign and amend commands **and by the importer**, because an import is not a back
 * door: a bulk-loaded row goes through exactly these checks — the same period rules, the same
 * currency rules, the same grade bounds and the same exclusion constraint (§23).
 *
 * Apart from the handlers because the three commands are transport and this is the rule; keeping
 * them together put the file past its budget, and the split is the one the budget exists to force.
 */

export interface AssignmentOutcome {
  readonly recurringId: string;
  readonly approvalState: string;
  readonly supersededId?: string;
}

export interface AssignmentInput {
  readonly employmentId: string;
  readonly componentId: string;
  readonly amount: MoneyInput;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly payGradeId?: string;
  readonly payScaleId?: string;
  readonly salaryStepId?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly metadata?: Metadata;
}

export const writeAssignment = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  input: AssignmentInput,
  changeKind: 'assigned' | 'amended' | 'imported',
): Promise<CompensationResult<AssignmentOutcome>> => {
  const checked = await checkedAssignment(dependencies, transaction, input);

  if (!checked.ok) return checked;

  const { plan } = checked.value;
  const superseded = await inForceRecord(
    dependencies,
    transaction,
    input.employmentId,
    input.componentId,
    input.effectiveFrom,
  );

  if (superseded !== undefined) {
    const ended = await closePeriod(dependencies, transaction, superseded, input.effectiveFrom);

    if (!ended.ok) return ended;
  }

  const built = recurring(
    {
      ...input,
      tenantId: currentTenant(),
      compensationPlanId: plan.id,
      amount: input.amount,
      recordedBy: currentActor(),
      approvalState: initialApprovalState(plan),
      ...(superseded === undefined ? {} : { supersedesId: superseded.id }),
    },
    dependencies.clock.now(),
  );

  if (!built.ok) return built;

  const inserted = await insertRecurring(dependencies, transaction, built.value);

  if (!inserted.ok) return inserted;

  return finish(dependencies, transaction, inserted.value, superseded, changeKind);
};

const finish = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  state: RecurringState,
  superseded: RecurringState | undefined,
  changeKind: 'assigned' | 'amended' | 'imported',
): Promise<CompensationResult<AssignmentOutcome>> => {
  const recorded = await recordChange(dependencies, transaction, currentTenant(), {
    employmentId: state.employmentId,
    componentId: state.componentId,
    subjectKind: 'recurring',
    subjectId: state.id,
    changeKind,
    next: state,
    effectiveFrom: state.effectiveFrom,
    actor: currentActor(),
    source: state.source,
    ...(superseded === undefined ? {} : { previous: superseded }),
    ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  });

  if (!recorded.ok) return recorded;

  return accept({
    recurringId: state.id,
    approvalState: state.approvalState,
    ...(superseded === undefined ? {} : { supersededId: superseded.id }),
  });
};

/** The four questions every assignment answers before it writes anything. */
const checkedAssignment = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  input: AssignmentInput,
): Promise<CompensationResult<{ readonly plan: CompensationPlanState }>> => {
  const amount = checkedMoney(input.amount, 'amount');

  if (!amount.ok) return amount;

  const employment = await employmentFor(dependencies, input.employmentId, input.effectiveFrom);

  if (!employment.ok) return employment;

  const plan = await planFor(dependencies, transaction, employment.value, input.effectiveFrom);

  if (!plan.ok) return plan;

  const component = await componentFor(dependencies, transaction, input.componentId, 'recurring');

  if (!component.ok) return component;

  const permitted = await permittedByPlan(
    dependencies,
    transaction,
    plan.value,
    input.componentId,
    amount.value,
  );

  if (!permitted.ok) return permitted;

  const graded = await withinGrade(
    dependencies,
    transaction,
    input.payGradeId,
    amount.value,
    input.effectiveFrom,
  );

  if (!graded.ok) return graded;

  const basis = await checkedBasis(dependencies, transaction, input, amount.value, component.value);

  if (!basis.ok) return basis;

  return accept({ plan: plan.value });
};

/**
 * A percentage component's basis must be assigned, and in the same currency.
 *
 * Checked when the assignment is made rather than when a payroll run three months later cannot
 * produce a figure — 40% of an amount in another currency is not a quantity this module can produce
 * without converting, and nothing here converts (§20.4).
 */
const checkedBasis = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  input: AssignmentInput,
  amount: MoneyAmount,
  component: CompensationComponentState,
): Promise<CompensationResult<void>> => {
  if (component.calculationBasis !== 'percentage_of_component') return accept(undefined);
  if (component.basisComponentId === undefined) return refuse('percentage_requires_a_basis');

  const basisRecord = await inForceRecord(
    dependencies,
    transaction,
    input.employmentId,
    component.basisComponentId,
    input.effectiveFrom,
  );

  if (basisRecord === undefined) return refuse('percentage_basis_not_assigned');

  return basisCurrencyAgrees(amount, basisRecord.amount);
};
