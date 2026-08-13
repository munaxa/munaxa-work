import {
  AUTO_APPROVAL,
  MAX_SUCCESSOR_RANK,
  SUCCESSION_PLAN_TRANSITIONS,
  SUCCESSOR_TRANSITIONS,
  isCivilDate,
  isWholeWithin,
  type SuccessionPlanStatus,
  type SuccessorStatus,
} from './career-vocabulary.js';
import { accept, refuse, type CareerResult } from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * A succession plan for one position, and the people nominated against it.
 *
 * **The position is Organization's and so is its criticality** (AD-004, ADR-0072). This aggregate
 * stores a `positionId` and nothing else about it — no title, no grade, and above all no
 * `criticality` column. A tenant's answer to "is this position critical" lives in exactly one place,
 * and a copy here would be the staler of two.
 *
 * That is also why this is a `SuccessionPlan` and not the specification's `CriticalPositionReference`
 * (D-3): what Career owns is the plan *for* a position, not a second record of the position itself.
 *
 * **Confirming a successor is a named human act** (ADR-0072, D-8). It is the moment an organization
 * commits to a name, and it is what an auditor asks about a year later — so it carries its own
 * permission, the actor comes from the authenticated context, and `system:auto-approval` is refused
 * outright. `AutoApprovingPort` is the only approval adapter in this repository and its own comment
 * says it pretends nothing; recording it against a succession decision would be a fabricated
 * approval on the most consequential record in the module.
 *
 * **Nothing here promotes anybody.** A confirmed successor is a sentence about a contingency. No
 * employment, position, assignment or salary changes, and there is no port through which this
 * module could change one.
 *
 * **Withdrawal is a state, never a delete.** "We put this person forward and later took them off"
 * is the history a review needs.
 */

export interface SuccessionPlanState {
  readonly successionPlanId: string;
  /** Organization's identifier. Career stores nothing else about the position, and no criticality. */
  readonly positionId: string;
  readonly status: SuccessionPlanStatus;
  /** A civil day somebody chose to look at this again. **Nothing reminds them** — `JobPort` has no
   * adapter, so "reviews due" is a query somebody runs, never a notice anybody receives. */
  readonly reviewOn?: string;
  readonly notes?: string;
  readonly archivedAt?: Date;
  readonly archivedBy?: string;
  readonly version: number;
}

/**
 * One nomination.
 *
 * `readinessLevelId` names a tenant-configured level, and it is **stated** rather than derived
 * (ADR-0074). `rank` is an order a human put the bench in — not a score, and nothing computes it.
 */
export interface SuccessorState {
  readonly successorId: string;
  readonly successionPlanId: string;
  readonly employmentId: string;
  readonly readinessLevelId?: string;
  readonly rank?: number;
  readonly status: SuccessorStatus;
  readonly nominatedOn: string;
  readonly nominatedBy: string;
  readonly confirmedOn?: string;
  readonly confirmedBy?: string;
  readonly withdrawnOn?: string;
  readonly withdrawnBy?: string;
  readonly withdrawalReason?: string;
  readonly version: number;
}

export interface CreateSuccessionPlanRequest {
  readonly successionPlanId: string;
  readonly positionId: string;
  readonly reviewOn?: string;
  readonly notes?: string;
}

export const createSuccessionPlan = (
  request: CreateSuccessionPlanRequest,
): CareerResult<SuccessionPlanState> => {
  if (request.reviewOn !== undefined && !isCivilDate(request.reviewOn)) {
    return refuse('succession-review-date-invalid');
  }

  return accept({
    successionPlanId: request.successionPlanId,
    positionId: request.positionId,
    status: 'draft',
    version: 1,
    ...definedOf({ reviewOn: request.reviewOn, notes: request.notes }),
  });
};

const planPermits = (from: SuccessionPlanStatus, to: SuccessionPlanStatus): boolean =>
  SUCCESSION_PLAN_TRANSITIONS[from].includes(to);

/**
 * Activating a plan: the point at which it is the tenant's live answer for this position.
 *
 * **A plan with nobody nominated activates nothing.** An empty bench presented as an active
 * succession plan is worse than no plan, because a review would read it as "covered" — the same
 * emptiness that stops Learning publishing a path with no steps.
 */
export const activateSuccessionPlan = (
  state: SuccessionPlanState,
  successorCount: number,
): CareerResult<SuccessionPlanState> => {
  if (!planPermits(state.status, 'active')) return refuse('succession-transition-refused');
  if (successorCount === 0) return refuse('succession-plan-has-no-successors');

  return accept({ ...state, status: 'active' });
};

export const archiveSuccessionPlan = (
  state: SuccessionPlanState,
  at: Date,
  by: string,
): CareerResult<SuccessionPlanState> => {
  if (!planPermits(state.status, 'archived')) return refuse('succession-transition-refused');

  return accept({ ...state, status: 'archived', archivedAt: at, archivedBy: by });
};

export interface NominateRequest {
  readonly successorId: string;
  readonly employmentId: string;
  readonly readinessLevelId?: string;
  readonly rank?: number;
  readonly on: string;
  readonly by: string;
}

/**
 * Nominating somebody against a plan.
 *
 * Refused on an archived plan. **Uniqueness is not checked here**: one open nomination per plan and
 * employment is a fact about a set of rows, arbitrated by a partial unique index — the
 * specification's "Duplicate Successor Assignments" validation belongs at the database, because two
 * managers can run it at the same instant and a pre-check would let both through (§15).
 */
export const nominate = (
  plan: SuccessionPlanState,
  request: NominateRequest,
): CareerResult<SuccessorState> => {
  if (plan.status === 'archived') return refuse('succession-plan-archived');
  if (!isCivilDate(request.on)) return refuse('nomination-date-invalid');
  if (request.rank !== undefined && !isWholeWithin(request.rank, 1, MAX_SUCCESSOR_RANK)) {
    return refuse('successor-rank-invalid');
  }
  if (request.by === AUTO_APPROVAL) return refuse('nomination-requires-a-person');

  return accept({
    successorId: request.successorId,
    successionPlanId: plan.successionPlanId,
    employmentId: request.employmentId,
    status: 'nominated',
    nominatedOn: request.on,
    nominatedBy: request.by,
    version: 1,
    ...definedOf({ readinessLevelId: request.readinessLevelId, rank: request.rank }),
  });
};

const successorPermits = (from: SuccessorStatus, to: SuccessorStatus): boolean =>
  SUCCESSOR_TRANSITIONS[from].includes(to);

export interface ConfirmRequest {
  readonly on: string;
  readonly by: string;
}

/**
 * Confirming a nomination.
 *
 * The one act in this module that a reader could mistake for a decision with consequences. It is a
 * decision — an organization committing to a name — and it has none: no employment changes, nothing
 * is scheduled, nobody is told.
 *
 * `system:auto-approval` is refused. Four modules already refuse that actor on the act that
 * matters — Performance on completing a review, Learning on waiving and revoking, Payroll on
 * finalizing — and this is Career's.
 */
export const confirmSuccessor = (
  state: SuccessorState,
  request: ConfirmRequest,
): CareerResult<SuccessorState> => {
  if (!successorPermits(state.status, 'confirmed')) return refuse('successor-transition-refused');
  if (!isCivilDate(request.on)) return refuse('confirmation-date-invalid');
  if (request.by === AUTO_APPROVAL) return refuse('confirmation-requires-a-person');

  return accept({
    ...state,
    status: 'confirmed',
    confirmedOn: request.on,
    confirmedBy: request.by,
  });
};

export interface WithdrawRequest {
  readonly on: string;
  readonly by: string;
  readonly reason: string;
}

/**
 * Taking somebody off a bench.
 *
 * A reason is required, for the reason a waiver requires one in Learning: this is the act somebody
 * asks about later, and "why is this person no longer a successor" has an answer the organization
 * should have written down at the time.
 */
export const withdrawSuccessor = (
  state: SuccessorState,
  request: WithdrawRequest,
): CareerResult<SuccessorState> => {
  if (!successorPermits(state.status, 'withdrawn')) return refuse('successor-transition-refused');
  if (!isCivilDate(request.on)) return refuse('withdrawal-date-invalid');
  if (request.reason.trim().length === 0) return refuse('withdrawal-reason-required');

  return accept({
    ...state,
    status: 'withdrawn',
    withdrawnOn: request.on,
    withdrawnBy: request.by,
    withdrawalReason: request.reason,
  });
};

/**
 * Whether a review date has passed, on the day somebody asked.
 *
 * Derived and never stored, and it notifies nobody. `JobPort` has no adapter anywhere in this
 * repository, so a succession review comes due because somebody ran a query — not because anything
 * fired. Scheduled review remains `NOT VERIFIED`.
 */
export const reviewIsDue = (state: SuccessionPlanState, on: string): boolean =>
  state.status === 'active' && state.reviewOn !== undefined && state.reviewOn <= on;
