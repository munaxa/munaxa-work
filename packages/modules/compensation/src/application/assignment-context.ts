import type { Transaction } from '@work/kernel';

import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import { isWithinRange, type MoneyAmount } from '../domain/money-amount.js';
import { resolvePlan } from '../domain/plan-assignment.js';
import { inForceOn } from '../domain/recurring.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState } from '../domain/compensation-plan.js';
import type { ApprovalState } from '../domain/compensation-vocabulary.js';
import type { CompensationDependencies } from './compensation-dependencies.js';
import type { EmploymentForCompensation } from './cross-module-ports.js';

/**
 * Everything a compensation write needs to know before it writes: is the employment real on that
 * date, which plan governs it, is the component usable, and is the amount permissible.
 *
 * Gathered in one place because the same four questions precede an assignment, an amendment, a
 * one-time item and an imported row — and four copies of them would be four chances for one path to
 * skip the check the others make.
 */

export interface AssignmentContext {
  readonly employment: EmploymentForCompensation;
  readonly plan: CompensationPlanState;
  readonly component: CompensationComponentState;
  /** What a new record's approval state starts as, given the plan. */
  readonly approvalState: ApprovalState;
}

/**
 * The employment, **as it stood on the effective date**.
 *
 * A raise effective in March is checked against March's status, not today's. Two refusals follow
 * from what Employment answers, and both are business mistakes rather than faults:
 *
 * - a change effective **before the employment started** is a data-entry mistake in every case
 *   anybody has described;
 * - a change effective **after it ended** is one too — a terminated employment's open periods are
 *   closed at the termination date, and adding a new one beyond it would create an entitlement
 *   nobody could be paid.
 */
export const employmentFor = async (
  dependencies: CompensationDependencies,
  employmentId: string,
  effectiveFrom: string,
): Promise<CompensationResult<EmploymentForCompensation>> => {
  const employment = await dependencies.employment.find(employmentId, effectiveFrom);

  if (employment === undefined) return refuse('employment_not_found', { employmentId });
  if (effectiveFrom < employment.startDate) {
    return refuse('change_before_employment_start', { effectiveFrom });
  }
  if (employment.endDate !== undefined && effectiveFrom > employment.endDate) {
    return refuse('change_after_employment_end', { effectiveFrom });
  }
  return accept(employment);
};

/**
 * The plan governing an employment on a date.
 *
 * Resolved most-specific-wins through the assignments; a tie is refused rather than broken. The
 * resolved version is then **recorded on the compensation record and never re-resolved**, so a plan
 * reassigned in June does not change what a March assignment was governed by.
 */
export const planFor = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  employment: EmploymentForCompensation,
  onDate: string,
): Promise<CompensationResult<CompensationPlanState>> => {
  const scopeIds = [employment.employmentId, employment.unitId, employment.legalEntityId].filter(
    (id): id is string => id !== undefined,
  );
  const candidates = await dependencies.stores.planAssignments.candidates(
    transaction,
    scopeIds,
    onDate,
  );
  const resolved = resolvePlan(candidates, employment, onDate);

  if (!resolved.ok) return resolved;
  // No plan configured is a real answer, not an error — but it is not one a compensation write can
  // proceed from, because the plan is what says whether the change needs approving.
  if (resolved.value === undefined) return refuse('no_plan_assigned', { onDate });

  const plan = await dependencies.stores.plans.byId(transaction, resolved.value.compensationPlanId);

  if (plan === undefined) return refuse('no_plan_assigned', { onDate });
  if (plan.status !== 'published') return refuse('plan_not_published');

  return accept(plan);
};

/**
 * The component, checked for usability rather than merely for existence.
 *
 * A draft component has not been frozen and a superseded one has been retired; assigning either
 * would attach somebody's pay to a definition that is either still moving or deliberately no longer
 * offered. Existing periods referencing a superseded component are **untouched** — retiring a
 * component does not restate what it meant while it was current.
 */
export const componentFor = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  componentId: string,
  expected: 'recurring' | 'one_time',
): Promise<CompensationResult<CompensationComponentState>> => {
  const component = await dependencies.stores.components.byId(transaction, componentId);

  if (component === undefined) return refuse('component_not_found', { componentId });
  if (component.status === 'draft') return refuse('component_not_published', { componentId });
  if (component.status === 'superseded') return refuse('component_expired', { componentId });
  if (component.recurrence !== expected) {
    return refuse('component_recurrence_disagrees_with_kind', { componentId });
  }
  return accept(component);
};

/**
 * Whether a component is permitted by the plan, and whether the amount sits inside the plan's
 * bounds for it.
 *
 * A plan that lists no components permits all of them — which is the ordinary shape for a tenant
 * that uses plans for approval configuration rather than for eligibility, and is why an empty list
 * is not treated as an empty allowance.
 */
export const permittedByPlan = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  plan: CompensationPlanState,
  componentId: string,
  amount: MoneyAmount,
): Promise<CompensationResult<void>> => {
  const terms = await dependencies.stores.planComponents.forPlan(transaction, plan.id);

  if (terms.length === 0) return accept(undefined);

  const permitted = terms.find((term) => term.componentId === componentId);

  if (permitted === undefined) {
    return refuse('component_not_permitted_by_plan', { componentId });
  }
  if (
    permitted.minimum !== undefined &&
    permitted.maximum !== undefined &&
    !isWithinRange(amount, { minimum: permitted.minimum, maximum: permitted.maximum })
  ) {
    // The bound, never the amount: a rejection's detail travels into logs, and a salary does not.
    return refuse('amount_outside_plan_bounds', { componentId });
  }
  return accept(undefined);
};

/**
 * Whether an amount sits inside a referenced grade's range, as at the effective date.
 *
 * A grade **constrains** an amount and never supplies one. Checking against the range *at the
 * effective date* rather than today's is what lets last year's assignment stay explainable against
 * last year's range after the grade is revised.
 */
export const withinGrade = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  payGradeId: string | undefined,
  amount: MoneyAmount,
  onDate: string,
): Promise<CompensationResult<void>> => {
  if (payGradeId === undefined) return accept(undefined);

  const grade = await dependencies.stores.grades.byId(transaction, payGradeId);

  if (grade === undefined) return refuse('pay_grade_not_found', { payGradeId });
  if (!inRangeOn(grade, onDate)) return refuse('pay_grade_not_effective', { onDate });
  if (!isWithinRange(amount, grade.range)) {
    return refuse('amount_outside_grade_range', { payGradeId });
  }
  return accept(undefined);
};

const inRangeOn = (
  grade: { readonly effectiveFrom: string; readonly effectiveTo?: string },
  onDate: string,
): boolean =>
  onDate >= grade.effectiveFrom && (grade.effectiveTo === undefined || onDate < grade.effectiveTo);

/**
 * What a new record's approval state starts as.
 *
 * `not_required` where the plan requires none — a first-class state, and **not** a synonym for
 * approved. The record takes effect with no decision row, and the published chain says "no approval
 * was required" rather than naming a system approver (D-9).
 */
export const initialApprovalState = (plan: CompensationPlanState): ApprovalState =>
  plan.approvalRequired && plan.approvalsRequired > 0 ? 'pending' : 'not_required';

/** The record in force for one `(employment, component)` on a date, where there is one. */
export const inForceRecord = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  employmentId: string,
  componentId: string,
  onDate: string,
): Promise<
  | Awaited<ReturnType<CompensationDependencies['stores']['recurring']['forComponent']>>[number]
  | undefined
> => {
  const records = await dependencies.stores.recurring.forComponent(
    transaction,
    employmentId,
    componentId,
  );

  return records.find((record) => inForceOn(record, onDate));
};
