import { uuidV7 } from '@work/kernel';

import {
  checkedOptionalCode,
  checkedPeriod,
  definedOnly,
  type EffectivePeriod,
} from './compensation-aggregate.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import {
  SCOPE_SPECIFICITY,
  isScope,
  periodContains,
  type Scope,
} from './compensation-vocabulary.js';

/**
 * Which plan version governs which scope, effective-dated.
 *
 * **Most-specific-wins, resolved as at the effective date** — the pattern Leave established for
 * policy assignment. An employment-scoped assignment beats a unit-scoped one, which beats a
 * legal-entity one, which beats the tenant's.
 *
 * **A tie is refused, not broken.** Two plans claiming the same unit on the same date is a
 * configuration mistake with no correct answer, and picking one silently would put a plan somebody
 * did not choose behind everybody's compensation in that unit. The refusal names the scope so an
 * administrator can find the pair.
 *
 * **The resolved plan version is recorded on the compensation record and never re-resolved.** A
 * plan reassigned in June does not change what a March assignment was governed by.
 */

export interface PlanAssignmentState extends EffectivePeriod {
  readonly id: string;
  readonly tenantId: string;
  readonly compensationPlanId: string;
  readonly scope: Scope;
  /** Absent for the tenant scope, which applies to everybody and therefore names nobody. */
  readonly scopeId?: string;
  readonly reasonCode?: string;
  readonly version: number;
}

export interface AssignCompensationPlan {
  readonly tenantId: string;
  readonly compensationPlanId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export const planAssignment = (
  request: AssignCompensationPlan,
  occurredAt: Date,
): CompensationResult<PlanAssignmentState> => {
  if (!isScope(request.scope)) return refuse('scope_unknown', { scope: request.scope });
  // The tenant scope names nobody; every other scope must name somebody. The database refuses the
  // same pairing, so a row reaching it another way is still refused.
  if ((request.scope === 'tenant') !== (request.scopeId === undefined)) {
    return refuse('scope_id_disagrees_with_scope', { scope: request.scope });
  }

  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo, 'assignment');

  if (!period.ok) return period;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    compensationPlanId: request.compensationPlanId,
    scope: request.scope,
    ...definedOnly({ scopeId: request.scopeId, reasonCode: reason.value }),
    ...period.value,
    version: 0,
  });
};

export const coversDate = (assignment: PlanAssignmentState, onDate: string): boolean =>
  periodContains(
    { from: assignment.effectiveFrom, ...definedOnly({ to: assignment.effectiveTo }) },
    onDate,
  );

/** Where an employment sits, for resolving which assignment applies to it. */
export interface AssignmentSubject {
  readonly employmentId: string;
  readonly unitId?: string;
  readonly legalEntityId?: string;
}

/**
 * The plan governing an employment on a date, or a named refusal.
 *
 * Returns `undefined` when nothing is configured — which is a real answer and not an error. A
 * tenant that has assigned no plan has no plan, and the caller reports that rather than inventing
 * one.
 */
export const resolvePlan = (
  candidates: readonly PlanAssignmentState[],
  subject: AssignmentSubject,
  onDate: string,
): CompensationResult<PlanAssignmentState | undefined> => {
  const applicable = candidates.filter(
    (candidate) => coversDate(candidate, onDate) && appliesTo(candidate, subject),
  );

  if (applicable.length === 0) return accept(undefined);

  const ranked = [...applicable].sort(
    (left, right) => SCOPE_SPECIFICITY[right.scope] - SCOPE_SPECIFICITY[left.scope],
  );
  const winner = ranked[0];

  if (winner === undefined) return accept(undefined);

  const tied = ranked.filter(
    (candidate) =>
      SCOPE_SPECIFICITY[candidate.scope] === SCOPE_SPECIFICITY[winner.scope] &&
      candidate.compensationPlanId !== winner.compensationPlanId,
  );

  if (tied.length > 0) return refuse('plan_assignment_ambiguous', { scope: winner.scope, onDate });

  return accept(winner);
};

const appliesTo = (assignment: PlanAssignmentState, subject: AssignmentSubject): boolean => {
  switch (assignment.scope) {
    case 'tenant':
      return true;
    case 'legal_entity':
      return assignment.scopeId === subject.legalEntityId;
    case 'unit':
      return assignment.scopeId === subject.unitId;
    case 'employment':
      return assignment.scopeId === subject.employmentId;
  }
};
