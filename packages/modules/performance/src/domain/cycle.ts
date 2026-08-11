import {
  CYCLE_TRANSITIONS,
  isCycleKind,
  isEntityCode,
  permits,
  type CycleKind,
  type CycleStatus,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type { LocalizedName } from './rating-scale.js';

/**
 * A scheduled evaluation period. Payroll's period/run pair is the precedent, deliberately followed.
 *
 * **The due dates are configuration, and nothing fires them.** `JobPort` has no adapter anywhere in
 * this repository, so a cycle does not open itself, does not chase anybody and does not close when
 * the date passes. Overdue work is a *query* somebody runs; a transition is a command somebody
 * issues. That is Phase 12's D-26 reasoning applied unchanged, and the report and the screen both
 * say so rather than letting a date field imply a scheduler (D-22).
 *
 * **A closed cycle does not reopen.** Its reviews are completed and immutable, and reopening the
 * container would imply they were not. A correction is a new cycle, exactly as a correction to an
 * issued letter is a new letter.
 */

const AUTO_APPROVAL = 'system:auto-approval';

export interface CycleState {
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly reviewTemplateId: string;
  readonly kind: CycleKind;
  readonly status: CycleStatus;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly selfAssessmentDue?: Date;
  readonly managerAssessmentDue?: Date;
  readonly peerAssessmentDue?: Date;
  readonly calibrationDue?: Date;
  readonly openedAt?: Date;
  readonly closedAt?: Date;
  readonly closedBy?: string;
  readonly cancelledAt?: Date;
  readonly cancellationReason?: string;
  readonly version: number;
}

export interface OpenCycleRequest {
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly reviewTemplateId: string;
  readonly kind: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly selfAssessmentDue?: Date;
  readonly managerAssessmentDue?: Date;
  readonly peerAssessmentDue?: Date;
  readonly calibrationDue?: Date;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const createCycle = (request: OpenCycleRequest): PerformanceResult<CycleState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    cycleId: request.cycleId,
    code: request.code,
    name: request.name,
    reviewTemplateId: request.reviewTemplateId,
    kind: checked.value,
    status: 'draft',
    periodStart: request.periodStart,
    periodEnd: request.periodEnd,
    version: 1,
    ...optional('selfAssessmentDue', request.selfAssessmentDue),
    ...optional('managerAssessmentDue', request.managerAssessmentDue),
    ...optional('peerAssessmentDue', request.peerAssessmentDue),
    ...optional('calibrationDue', request.calibrationDue),
  });
};

const validate = (request: OpenCycleRequest): PerformanceResult<CycleKind> => {
  if (!isEntityCode(request.code)) return refuse('cycle-code-invalid', { code: request.code });
  if (!isCycleKind(request.kind)) return refuse('cycle-kind-unknown', { kind: request.kind });
  if (request.periodEnd < request.periodStart) return refuse('cycle-period-inverted');

  // A due date before the period it belongs to would put a deadline in the past on the day the
  // cycle opened. A due date is allowed after the period ends: assessing what happened takes time.
  const due = [
    request.selfAssessmentDue,
    request.managerAssessmentDue,
    request.peerAssessmentDue,
    request.calibrationDue,
  ].filter((date): date is Date => date !== undefined);

  if (due.some((date) => date < request.periodStart)) return refuse('cycle-due-before-period');

  return accept(request.kind);
};

export const moveCycle = (
  state: CycleState,
  to: CycleStatus,
  at: Date,
): PerformanceResult<CycleState> => {
  if (!permits(CYCLE_TRANSITIONS, state.status, to)) {
    return refuse('cycle-transition-refused', { from: state.status, to });
  }
  if (to === 'open') return accept({ ...state, status: to, openedAt: at });

  return accept({ ...state, status: to });
};

/**
 * Closing a cycle is a named human's act.
 *
 * Nothing closes on a schedule, and `system:auto-approval` is refused here as it is in five modules
 * before this one. A cycle that closed itself would complete nobody's review and would leave the
 * ones nobody finished looking as though somebody had.
 */
export const closeCycle = (
  state: CycleState,
  closedBy: string,
  at: Date,
): PerformanceResult<CycleState> => {
  if (closedBy === AUTO_APPROVAL) return refuse('cycle-closure-not-human');

  const moved = moveCycle(state, 'closed', at);

  if (!moved.ok) return moved;

  return accept({ ...moved.value, closedAt: at, closedBy });
};

export const cancelCycle = (
  state: CycleState,
  reason: string,
  at: Date,
): PerformanceResult<CycleState> => {
  if (reason.trim().length === 0) return refuse('cycle-cancellation-needs-reason');

  const moved = moveCycle(state, 'cancelled', at);

  if (!moved.ok) return moved;

  return accept({ ...moved.value, cancelledAt: at, cancellationReason: reason.trim() });
};

/** Whether a cycle is accepting the work a review does. Nothing derives this from a date. */
export const acceptsAssessments = (state: CycleState): boolean =>
  state.status === 'open' || state.status === 'in_progress';

/**
 * Whether a due date has passed, as a question rather than an event.
 *
 * This is the whole of D-22 in one function: overdue is something a query computes when somebody
 * asks, because there is no scheduler to notice it happening. Nothing calls this on a timer, and
 * nothing sends anything when it returns true.
 */
export const overdue = (due: Date | undefined, asOf: Date): boolean =>
  due !== undefined && due < asOf;
