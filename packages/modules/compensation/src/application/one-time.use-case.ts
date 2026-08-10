import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { oneTime } from '../domain/one-time.js';
import { isUniqueViolation, recordChange } from './recurring-writer.js';
import {
  componentFor,
  employmentFor,
  initialApprovalState,
  permittedByPlan,
  planFor,
} from './assignment-context.js';
import { checkedMoney, type MoneyInput } from '../domain/money-amount.js';
import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import { currentActor, currentTenant, refusedBy } from './compensation-context.js';
import { CompensationPermissions } from './compensation-permissions.js';
import type { CompensationDependencies } from './compensation-dependencies.js';
import type { Metadata } from '../domain/compensation-aggregate.js';
import type { ApprovalState } from '../domain/compensation-vocabulary.js';

/**
 * Recording one-time compensation: a bonus, a commission, an award.
 *
 * **Compensation records that it is owed and on what date it becomes payable. Payroll decides which
 * period pays it.** Which run consumes a 15 March bonus depends on the period calendar, the cut-off
 * and the jurisdiction, and all three are Payroll's.
 *
 * A one-time item has **no effective period and therefore no overlap rule** — two bonuses on one
 * date is ordinary. Its idempotency comes from `(source, sourceId, component, employment)` instead,
 * so an import retried writes once.
 *
 * Whether it needs approving is **governed by the plan**, the same flag that governs a recurring
 * change. A tenant wanting bonuses approved and raises not can express that with two plans.
 */

export interface RecordOneTimeCommand extends Command {
  readonly commandName: 'compensation.record-one-time';
  readonly employmentId: string;
  readonly componentId: string;
  readonly amount: MoneyInput;
  readonly payableOn: string;
  readonly reasonCode: string;
  readonly note?: string;
  readonly source?: string;
  readonly sourceId?: string;
  readonly metadata?: Metadata;
}

export interface OneTimeRecorded {
  readonly oneTimeId: string;
  readonly approvalState: string;
  /** True when an identical `(source, sourceId, component, employment)` was already present. */
  readonly alreadyRecorded: boolean;
}

export const recordOneTimeHandler = (
  dependencies: CompensationDependencies,
): CommandHandler<RecordOneTimeCommand, OneTimeRecorded> => ({
  commandName: 'compensation.record-one-time',
  permission: CompensationPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const recorded = await writeOneTime(dependencies, transaction, command);

      if (!recorded.ok) return refusedBy<OneTimeRecorded>(recorded.error);

      return success(recorded.value);
    }),
});

const writeOneTime = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: RecordOneTimeCommand,
): Promise<CompensationResult<OneTimeRecorded>> => {
  const checked = await checkedOneTime(dependencies, transaction, command);

  if (!checked.ok) return checked;

  const existing = await alreadyRecorded(dependencies, transaction, command);

  if (existing !== undefined) {
    return accept({
      oneTimeId: existing.id,
      approvalState: existing.approvalState,
      alreadyRecorded: true,
    });
  }

  const built = oneTime(
    {
      ...command,
      tenantId: currentTenant(),
      compensationPlanId: checked.value.planId,
      recordedBy: currentActor(),
      approvalState: checked.value.approvalState,
    },
    dependencies.clock.now(),
  );

  if (!built.ok) return built;

  try {
    await dependencies.stores.oneTime.insert(transaction, built.value);
  } catch (cause) {
    if (!isUniqueViolation(cause)) throw cause;
    return refuse('compensation_already_recorded', { componentId: command.componentId });
  }

  const logged = await recordChange(dependencies, transaction, currentTenant(), {
    employmentId: built.value.employmentId,
    componentId: built.value.componentId,
    subjectKind: 'one_time',
    subjectId: built.value.id,
    changeKind: built.value.source === 'import' ? 'imported' : 'assigned',
    next: built.value,
    effectiveFrom: built.value.payableOn,
    actor: currentActor(),
    reasonCode: built.value.reasonCode,
    source: built.value.source,
  });

  if (!logged.ok) return logged;

  return accept({
    oneTimeId: built.value.id,
    approvalState: built.value.approvalState,
    alreadyRecorded: false,
  });
};

/** The four questions a one-time item answers before it is written. */
const checkedOneTime = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: RecordOneTimeCommand,
): Promise<
  CompensationResult<{ readonly planId: string; readonly approvalState: ApprovalState }>
> => {
  const amount = checkedMoney(command.amount, 'amount');

  if (!amount.ok) return amount;

  const employment = await employmentFor(dependencies, command.employmentId, command.payableOn);

  if (!employment.ok) return employment;

  const plan = await planFor(dependencies, transaction, employment.value, command.payableOn);

  if (!plan.ok) return plan;

  const component = await componentFor(dependencies, transaction, command.componentId, 'one_time');

  if (!component.ok) return component;

  const permitted = await permittedByPlan(
    dependencies,
    transaction,
    plan.value,
    command.componentId,
    amount.value,
  );

  if (!permitted.ok) return permitted;

  return accept({ planId: plan.value.id, approvalState: initialApprovalState(plan.value) });
};

/**
 * The idempotency read an import makes before it writes.
 *
 * The unique index is still what guarantees it under concurrency; this is what turns a second
 * submission into a reported skip rather than a conflict.
 */
const alreadyRecorded = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  command: RecordOneTimeCommand,
) => {
  if (command.sourceId === undefined) return undefined;

  return dependencies.stores.oneTime.bySource(transaction, {
    source: command.source ?? 'manual',
    sourceId: command.sourceId,
    componentId: command.componentId,
    employmentId: command.employmentId,
  });
};
