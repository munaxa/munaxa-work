import type { CycleView, GoalView, ReviewView } from '@work/performance/contracts';

/**
 * Which actions a cycle's, a goal's or a review's state permits, and which it does not.
 *
 * **This is not authorization.** The API is authoritative and refuses every one of these
 * independently — `cycle-transition-refused`, `review-not-scored`, `goal-not-in-progress`,
 * `calibration-decision-not-human` — and a caller with `curl` reaches the same handler this screen
 * does. What this gives an HR administrator is an interface that does not offer them an action the
 * system is going to refuse, which is a usability property rather than a security one. Hiding a
 * control has never stopped anybody, and nothing here relies on it having done so.
 *
 * The rules are read straight off each record's own state, never recomputed from parts:
 *
 * - **A closed cycle offers nothing.** It does not reopen: its reviews are completed and immutable,
 *   and reopening the container would imply they were not.
 * - **A completed review offers only archival.** The rating is frozen by the domain and by a
 *   trigger; the remedy for a wrong completed review is not an edit, because a rating somebody was
 *   given is a thing that happened.
 * - **Scoring precedes completion.** A review with no calculated score offers neither completion nor
 *   calibration — there is nothing yet to sign off or to moderate.
 * - **Calibration precedes nothing.** It is offered on a scored review and withheld on a completed
 *   one, because moderating a rating after it has been given is a different act with a different
 *   name.
 * - **A closed goal is terminal**, whichever way it closed. Achieved, missed and cancelled are all
 *   endings.
 */

export const CYCLE_ACTIONS = ['open', 'enrol', 'close', 'cancel'] as const;
export type CycleAction = (typeof CYCLE_ACTIONS)[number];

export const REVIEW_ACTIONS = [
  'assignReviewer',
  'assess',
  'score',
  'calibrate',
  'complete',
  'archive',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const GOAL_ACTIONS = [
  'amend',
  'approve',
  'activate',
  'recordProgress',
  'closeGoal',
] as const;
export type GoalAction = (typeof GOAL_ACTIONS)[number];

const CLOSED_CYCLES = new Set(['closed', 'cancelled']);
const CLOSED_GOALS = new Set(['achieved', 'missed', 'cancelled']);

export const cycleActionsFor = (cycle: CycleView | undefined): ReadonlySet<CycleAction> => {
  const permitted = new Set<CycleAction>();

  if (cycle === undefined || CLOSED_CYCLES.has(cycle.status)) return permitted;

  // A draft cycle has nobody in it yet: it opens first, and enrolment follows.
  if (cycle.status === 'draft') {
    permitted.add('open');
    permitted.add('cancel');
    return permitted;
  }

  permitted.add('enrol');
  permitted.add('close');
  permitted.add('cancel');
  return permitted;
};

export const reviewActionsFor = (review: ReviewView | undefined): ReadonlySet<ReviewAction> => {
  const permitted = new Set<ReviewAction>();

  if (review === undefined || review.status === 'archived') return permitted;

  if (review.status === 'completed') {
    // Terminal but readable. Archival is the only thing left, and it changes nothing it says.
    permitted.add('archive');
    return permitted;
  }

  permitted.add('assignReviewer');
  permitted.add('assess');
  permitted.add('score');

  // Nothing to moderate and nothing to sign off until the engine has produced a number.
  if (review.calculatedScore === undefined) return permitted;

  permitted.add('calibrate');
  permitted.add('complete');
  return permitted;
};

export const goalActionsFor = (goal: GoalView | undefined): ReadonlySet<GoalAction> => {
  const permitted = new Set<GoalAction>();

  if (goal === undefined || CLOSED_GOALS.has(goal.status)) return permitted;

  if (goal.status === 'draft') {
    permitted.add('amend');
    permitted.add('approve');
    return permitted;
  }
  if (goal.status === 'approved') {
    permitted.add('amend');
    permitted.add('activate');
    return permitted;
  }

  permitted.add('amend');
  permitted.add('recordProgress');
  permitted.add('closeGoal');
  return permitted;
};

/**
 * Why an action is not offered, as a catalogue key — never a blank, disabled control.
 *
 * A screen that simply omitted the controls would leave an administrator refreshing the page
 * wondering whether something had failed. Saying "a completed review is immutable" is the
 * difference between a rule and a bug.
 */
export const cycleWithheldBecause = (cycle: CycleView | undefined): string | undefined => {
  if (cycle === undefined) return undefined;
  if (cycle.status === 'closed') return 'performance.withheld.cycleClosed';
  if (cycle.status === 'cancelled') return 'performance.withheld.cycleCancelled';
  return undefined;
};

export const reviewWithheldBecause = (review: ReviewView | undefined): string | undefined => {
  if (review === undefined) return undefined;
  if (review.status === 'archived') return 'performance.withheld.reviewArchived';
  if (review.status === 'completed') return 'performance.withheld.reviewCompleted';
  if (review.calculatedScore === undefined) return 'performance.withheld.notScored';
  return undefined;
};

export const goalWithheldBecause = (goal: GoalView | undefined): string | undefined =>
  goal !== undefined && CLOSED_GOALS.has(goal.status)
    ? 'performance.withheld.goalClosed'
    : undefined;
