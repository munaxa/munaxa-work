import {
  GOAL_TRANSITIONS,
  MAX_BASIS_POINTS,
  isGoalMeasurement,
  isGoalScope,
  permits,
  type GoalMeasurement,
  type GoalScope,
  type GoalStatus,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';

/**
 * A goal, at whichever level of the organization set it.
 *
 * **A goal is not a child of a review.** An annual goal is assessed by a quarterly review and still
 * exists afterwards; making it a child of the review that assessed it would make it
 * un-referenceable between cycles, which is why `cycleId` is optional and the aggregate stands on
 * its own (§5).
 *
 * **`scope` decides who owns it, and nothing else does.** A corporate goal belongs to no employment
 * and no unit; a department or team goal belongs to a unit; an individual goal belongs to an
 * employment. Inferring the owner from whichever identifier happened to be supplied is how a goal
 * ends up belonging to two things at once, so the combination is refused rather than resolved.
 *
 * **A cancelled goal carries no score, ever.** The sixth approved scoring decision is that it is
 * excluded entirely — neither a score nor a denominator weight — and this is the half of that rule
 * the aggregate itself enforces. The scoring engine enforces the other half.
 *
 * **Approval is a named human's.** `system:auto-approval` is refused here as it is in five modules
 * before this one, and as a check constraint refuses it at the table. Workflow is Phase 16; when it
 * arrives it changes the source of the decision, not the fact that somebody made it (D-15).
 */

const AUTO_APPROVAL = 'system:auto-approval';

export interface GoalState {
  readonly goalId: string;
  readonly goalCategoryId?: string;
  readonly parentGoalId?: string;
  readonly cycleId?: string;
  readonly scope: GoalScope;
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly title: string;
  readonly description?: string;
  readonly measurement: GoalMeasurement;
  readonly targetDescription?: string;
  readonly weightBasisPoints: number;
  readonly status: GoalStatus;
  readonly startDate: Date;
  readonly dueDate: Date;
  readonly progressBasisPoints: number;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly closedAt?: Date;
  readonly closedBy?: string;
  readonly finalScore?: number;
  readonly closureReason?: string;
  readonly evidenceDocumentId?: string;
  readonly version: number;
}

export interface CreateGoalRequest {
  readonly goalId: string;
  readonly goalCategoryId?: string;
  readonly parentGoalId?: string;
  readonly cycleId?: string;
  readonly scope: string;
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly title: string;
  readonly description?: string;
  readonly measurement: string;
  readonly targetDescription?: string;
  readonly weightBasisPoints: number;
  readonly startDate: Date;
  readonly dueDate: Date;
  readonly evidenceDocumentId?: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const createGoal = (request: CreateGoalRequest): PerformanceResult<GoalState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    goalId: request.goalId,
    scope: checked.value.scope,
    title: request.title.trim(),
    measurement: checked.value.measurement,
    weightBasisPoints: request.weightBasisPoints,
    status: 'draft',
    startDate: request.startDate,
    dueDate: request.dueDate,
    progressBasisPoints: 0,
    version: 1,
    ...optional('goalCategoryId', request.goalCategoryId),
    ...optional('parentGoalId', request.parentGoalId),
    ...optional('cycleId', request.cycleId),
    ...optional('employmentId', request.employmentId),
    ...optional('organizationUnitId', request.organizationUnitId),
    ...optional('description', request.description),
    ...optional('targetDescription', request.targetDescription),
    ...optional('evidenceDocumentId', request.evidenceDocumentId),
  });
};

interface Checked {
  readonly scope: GoalScope;
  readonly measurement: GoalMeasurement;
}

const validate = (request: CreateGoalRequest): PerformanceResult<Checked> => {
  if (request.title.trim().length === 0) return refuse('goal-title-empty');
  if (!isGoalScope(request.scope)) return refuse('goal-scope-unknown', { scope: request.scope });
  if (!isGoalMeasurement(request.measurement)) {
    return refuse('goal-measurement-unknown', { measurement: request.measurement });
  }
  if (
    !Number.isInteger(request.weightBasisPoints) ||
    request.weightBasisPoints < 0 ||
    request.weightBasisPoints > MAX_BASIS_POINTS
  ) {
    return refuse('goal-weight-out-of-range', { weight: String(request.weightBasisPoints) });
  }
  if (request.dueDate < request.startDate) return refuse('goal-period-inverted');
  if (request.parentGoalId === request.goalId) return refuse('goal-parent-is-itself');

  const owner = validateOwner(request.scope, request);

  return owner.ok ? accept({ scope: request.scope, measurement: request.measurement }) : owner;
};

/** One owner, decided by the scope and never inferred from whichever identifier arrived. */
const validateOwner = (scope: GoalScope, request: CreateGoalRequest): PerformanceResult<true> => {
  const hasEmployment = request.employmentId !== undefined;
  const hasUnit = request.organizationUnitId !== undefined;

  if (scope === 'individual') {
    return hasEmployment && !hasUnit ? accept(true) : refuse('goal-owner-mismatch', { scope });
  }
  if (scope === 'corporate') {
    return !hasEmployment && !hasUnit ? accept(true) : refuse('goal-owner-mismatch', { scope });
  }
  return !hasEmployment && hasUnit ? accept(true) : refuse('goal-owner-mismatch', { scope });
};

export const moveGoal = (state: GoalState, to: GoalStatus): PerformanceResult<GoalState> => {
  if (!permits(GOAL_TRANSITIONS, state.status, to)) {
    return refuse('goal-transition-refused', { from: state.status, to });
  }

  return accept({ ...state, status: to });
};

/** A named human approves a goal. Nothing approves it on their behalf. */
export const approveGoal = (
  state: GoalState,
  approvedBy: string,
  at: Date,
): PerformanceResult<GoalState> => {
  if (approvedBy === AUTO_APPROVAL) return refuse('goal-approval-not-human');

  const moved = moveGoal(state, 'approved');

  if (!moved.ok) return moved;

  return accept({ ...moved.value, approvedAt: at, approvedBy });
};

export interface RecordProgressRequest {
  readonly progressBasisPoints: number;
  readonly observedValue?: bigint;
  readonly note?: string;
  readonly evidenceDocumentId?: string;
  readonly recordedAt: Date;
  readonly recordedBy: string;
}

export interface GoalProgressState {
  readonly goalProgressId: string;
  readonly goalId: string;
  readonly keyResultId?: string;
  readonly progressBasisPoints: number;
  readonly observedValue?: bigint;
  readonly note?: string;
  readonly evidenceDocumentId?: string;
  readonly recordedAt: Date;
  readonly recordedBy: string;
  readonly version: number;
}

/**
 * A progress entry, and the goal's headline figure moved to match.
 *
 * The entry is appended, never edited: what somebody reported in March is not rewritten in
 * September, because the trail of what was known when is exactly what a disputed rating is argued
 * from. The goal's own `progressBasisPoints` is a denormalization of the newest entry, and the two
 * are written in one transaction.
 */
export const recordProgress = (
  state: GoalState,
  goalProgressId: string,
  request: RecordProgressRequest,
  keyResultId?: string,
): PerformanceResult<{ readonly goal: GoalState; readonly progress: GoalProgressState }> => {
  if (state.status !== 'active' && state.status !== 'approved') {
    return refuse('goal-not-in-progress', { status: state.status });
  }
  if (
    !Number.isInteger(request.progressBasisPoints) ||
    request.progressBasisPoints < 0 ||
    request.progressBasisPoints > MAX_BASIS_POINTS
  ) {
    return refuse('goal-progress-out-of-range');
  }

  return accept({
    goal: { ...state, progressBasisPoints: request.progressBasisPoints },
    progress: {
      goalProgressId,
      goalId: state.goalId,
      progressBasisPoints: request.progressBasisPoints,
      recordedAt: request.recordedAt,
      recordedBy: request.recordedBy,
      version: 1,
      ...optional('keyResultId', keyResultId),
      ...optional('observedValue', request.observedValue),
      ...optional('note', request.note),
      ...optional('evidenceDocumentId', request.evidenceDocumentId),
    },
  });
};

export interface CloseGoalRequest {
  readonly outcome: Extract<GoalStatus, 'achieved' | 'missed' | 'cancelled'>;
  readonly finalScore?: number;
  readonly reason?: string;
  readonly closedAt: Date;
  readonly closedBy: string;
}

/**
 * Closing a goal, and the one asymmetry that matters.
 *
 * An achieved or missed goal carries a final score, because it was assessed. **A cancelled goal
 * carries none** — the sixth approved decision excludes it entirely, and a score recorded against
 * it would find its way into an aggregate that is supposed not to see it.
 */
export const closeGoal = (
  state: GoalState,
  request: CloseGoalRequest,
): PerformanceResult<GoalState> => {
  const moved = moveGoal(state, request.outcome);

  if (!moved.ok) return moved;
  if (request.outcome === 'cancelled' && request.finalScore !== undefined) {
    return refuse('goal-cancelled-carries-no-score');
  }
  if (request.outcome !== 'cancelled' && request.finalScore === undefined) {
    return refuse('goal-closure-needs-score', { outcome: request.outcome });
  }
  if (request.finalScore !== undefined && !Number.isInteger(request.finalScore)) {
    return refuse('goal-score-not-whole');
  }

  return accept({
    ...moved.value,
    closedAt: request.closedAt,
    closedBy: request.closedBy,
    ...optional('finalScore', request.finalScore),
    ...optional('closureReason', request.reason),
  });
};

/**
 * Whether a set of goals weighs what the template requires.
 *
 * Cancelled goals are not counted, because they are not part of what was assessed. A total of zero
 * required means the tenant runs unweighted goals and any total is acceptable.
 */
export const goalWeightsSatisfy = (
  goals: readonly GoalState[],
  requiredTotalBasisPoints: number,
): boolean => {
  if (requiredTotalBasisPoints === 0) return true;

  const total = goals
    .filter((goal) => goal.status !== 'cancelled')
    .reduce((running, goal) => running + goal.weightBasisPoints, 0);

  return total === requiredTotalBasisPoints;
};
