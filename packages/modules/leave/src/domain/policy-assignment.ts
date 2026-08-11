import { uuidV7 } from '@work/kernel';

import {
  bilingualFrom,
  checkedCivilDate,
  checkedOptionalCivilDate,
  checkedOptionalCode,
  type BilingualInput,
  type BilingualText,
} from './leave-aggregate.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { SCOPES, type Scope } from './leave-vocabulary.js';

/**
 * Which policy governs whom, and where leave is forbidden outright.
 *
 * Two small entities in one file because they are the same shape and the same rule: a scope, a
 * period, and most-specific-wins resolution as at a date. Splitting them would duplicate the scope
 * validation, and a scope rule written twice is a scope rule that eventually differs.
 *
 * **Resolution is most-specific-wins**, and the resolved policy version is **recorded on the
 * request** rather than re-resolved later. An assignment ended in June must not change what a
 * request approved in March was decided under.
 *
 * **Overlapping assignments at the same specificity are refused, not merged.** Two policies both
 * claiming the same unit on the same date is a configuration mistake with no correct answer, and
 * silently picking one would give an employee an entitlement nobody chose. This is the rule
 * Attendance uses for schedule assignments, for the same reason.
 *
 * A **`legal_entity` scope** is what a country pack resolves from (ADR-0035). A tenant operating in
 * three countries has three legal entities and three sets of policy versions, and no code path in
 * this module knows which country any of them is.
 */

export interface PolicyAssignmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly leavePolicyId: string;
  readonly scope: Scope;
  /** Absent for the tenant scope, and the database says so with a check constraint. */
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
  readonly version: number;
}

export interface AssignPolicy {
  readonly tenantId: string;
  readonly leavePolicyId: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly reasonCode?: string;
}

export const policyAssignment = (
  request: AssignPolicy,
  occurredAt: Date,
): LeaveResult<PolicyAssignmentState> => {
  const scope = checkedScope(request.scope, request.scopeId);

  if (!scope.ok) return scope;

  const period = checkedPeriod(request.effectiveFrom, request.effectiveTo);

  if (!period.ok) return period;

  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    leavePolicyId: request.leavePolicyId,
    ...scope.value,
    ...period.value,
    ...(reason.value === undefined ? {} : { reasonCode: reason.value }),
    version: 0,
  });
};

/**
 * How specific an assignment is. Higher wins.
 *
 * A number rather than an ordered list because resolution compares two candidates and a comparison
 * on an index is the same rule written twice.
 */
const SPECIFICITY: Readonly<Record<Scope, number>> = {
  tenant: 0,
  legal_entity: 1,
  unit: 2,
  employment: 3,
};

export const specificityOf = (scope: Scope): number => SPECIFICITY[scope];

/** Whether an assignment is in force on a civil date. Inclusive of both ends. */
export const coversDate = (
  assignment: Pick<PolicyAssignmentState, 'effectiveFrom' | 'effectiveTo'>,
  onDate: string,
): boolean =>
  assignment.effectiveFrom <= onDate &&
  (assignment.effectiveTo === undefined || assignment.effectiveTo >= onDate);

/**
 * Two assignments claim the same thing at the same time.
 *
 * Compared here rather than in SQL because "the same scope" includes the scope identifier, and an
 * exclusion constraint over a nullable scope identifier would treat two tenant-scoped rows as
 * distinct — which is exactly the collision that matters most.
 */
export const conflictsWith = (
  one: Pick<PolicyAssignmentState, 'scope' | 'scopeId' | 'effectiveFrom' | 'effectiveTo'>,
  other: Pick<PolicyAssignmentState, 'scope' | 'scopeId' | 'effectiveFrom' | 'effectiveTo'>,
): boolean => {
  if (one.scope !== other.scope || one.scopeId !== other.scopeId) return false;

  const oneEnds = one.effectiveTo ?? FAR_FUTURE;
  const otherEnds = other.effectiveTo ?? FAR_FUTURE;

  return one.effectiveFrom <= otherEnds && other.effectiveFrom <= oneEnds;
};

/**
 * A period a policy forbids leave in.
 *
 * Its own entity scoped like an assignment, rather than a property of a leave type, because a
 * blackout is usually *organizational* — a stocktake, a month-end close, a peak trading week — and
 * belongs to a unit rather than to the kind of leave somebody wanted (§35.2). `leaveTypeId` is
 * optional: a blackout that names no type blocks every type.
 */
export interface BlackoutState {
  readonly id: string;
  readonly tenantId: string;
  readonly leaveTypeId?: string;
  readonly scope: Scope;
  readonly scopeId?: string;
  readonly name: BilingualText;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reasonCode?: string;
  readonly version: number;
}

export interface DeclareBlackout {
  readonly tenantId: string;
  readonly leaveTypeId?: string;
  readonly scope: string;
  readonly scopeId?: string;
  readonly name: BilingualInput;
  readonly fromDate: string;
  readonly toDate: string;
  readonly reasonCode?: string;
}

export const blackout = (
  request: DeclareBlackout,
  occurredAt: Date,
): LeaveResult<BlackoutState> => {
  const scope = checkedScope(request.scope, request.scopeId);

  if (!scope.ok) return scope;

  const name = bilingualFrom(request.name, 'name');

  if (!name.ok) return name;

  const period = checkedPeriod(request.fromDate, request.toDate);

  if (!period.ok) return period;
  if (period.value.effectiveTo === undefined) return refuse('date_required', { field: 'toDate' });

  const reason = checkedOptionalCode(request.reasonCode, 'reasonCode');

  if (!reason.ok) return reason;

  return accept({
    id: uuidV7(occurredAt.getTime()),
    tenantId: request.tenantId,
    ...(request.leaveTypeId === undefined ? {} : { leaveTypeId: request.leaveTypeId }),
    ...scope.value,
    name: name.value,
    fromDate: period.value.effectiveFrom,
    toDate: period.value.effectiveTo,
    ...(reason.value === undefined ? {} : { reasonCode: reason.value }),
    version: 0,
  });
};

/** Whether a blackout covers a date, for a type. A blackout naming no type covers every type. */
export const blocksDate = (period: BlackoutState, onDate: string, leaveTypeId: string): boolean =>
  (period.leaveTypeId === undefined || period.leaveTypeId === leaveTypeId) &&
  period.fromDate <= onDate &&
  period.toDate >= onDate;

const FAR_FUTURE = '9999-12-31';

const checkedScope = (
  scope: string,
  scopeId: string | undefined,
): LeaveResult<{ readonly scope: Scope; readonly scopeId?: string }> => {
  if (!isScope(scope)) return refuse('scope_unknown', { scope });
  if (scope === 'tenant' && scopeId !== undefined) return refuse('tenant_scope_takes_no_id');
  if (scope !== 'tenant' && scopeId === undefined) return refuse('scope_requires_an_id', { scope });

  return accept({ scope, ...(scopeId === undefined ? {} : { scopeId }) });
};

const checkedPeriod = (
  from: string,
  to: string | undefined,
): LeaveResult<{ readonly effectiveFrom: string; readonly effectiveTo?: string }> => {
  const start = checkedCivilDate(from, 'effectiveFrom');

  if (!start.ok) return start;

  const end = checkedOptionalCivilDate(to, 'effectiveTo');

  if (!end.ok) return end;
  if (end.value !== undefined && end.value < start.value) {
    return refuse('period_ends_before_it_begins');
  }
  return accept({
    effectiveFrom: start.value,
    ...(end.value === undefined ? {} : { effectiveTo: end.value }),
  });
};

const isScope = (value: string): value is Scope => (SCOPES as readonly string[]).includes(value);
