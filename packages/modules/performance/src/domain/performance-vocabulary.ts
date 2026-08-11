/**
 * The closed vocabularies this module owns, and the transitions between them.
 *
 * Closed because they are *this module's* concepts rather than a tenant's or a country's: an
 * assessment is a draft or it is submitted, and there is no jurisdiction in which that means
 * something else. Everything a tenant decides — what the rating scale is called, which competencies
 * exist, what a cycle is named, how the components are weighted — is configuration and appears
 * nowhere here.
 *
 * The transition tables are data rather than `switch` statements for the same reason Payroll's are:
 * a reader can see every permitted move at once, and a move nobody listed is refused by default
 * instead of falling through to "allowed".
 *
 * **The word `grade` does not appear anywhere in this module.** `PositionView.grade` means a job's
 * level and `compensation_pay_grade` means a pay band; a third meaning would make the term useless
 * in all three modules. A performance level is a `RatingLevel` on a `RatingScale`.
 */

/** Basis points, the unit every weight in this module is expressed in. 10,000 is one whole. */
export const MAX_BASIS_POINTS = 10_000;

/**
 * The lifecycle of a scheduled evaluation period, following Payroll's period/run precedent.
 *
 * `cancelled` is reachable from anything short of `closed`, because a cycle abandoned halfway is a
 * real event and pretending it closed would put reviews nobody completed into the history.
 */
export const CYCLE_STATUSES = [
  'draft',
  'open',
  'in_progress',
  'calibration',
  'closed',
  'cancelled',
] as const;
export type CycleStatus = (typeof CYCLE_STATUSES)[number];

export const CYCLE_TRANSITIONS: Readonly<Record<CycleStatus, readonly CycleStatus[]>> = {
  draft: ['open', 'cancelled'],
  open: ['in_progress', 'cancelled'],
  in_progress: ['calibration', 'closed', 'cancelled'],
  calibration: ['in_progress', 'closed', 'cancelled'],
  // A closed cycle does not reopen. Its reviews are completed and immutable; reopening the
  // container would imply they were not.
  closed: [],
  cancelled: [],
};

/** What kind of period a cycle covers. A tenant chooses; nothing here is statutory. */
export const CYCLE_KINDS = [
  'annual',
  'semi-annual',
  'quarterly',
  'monthly',
  'probation',
  'project',
] as const;
export type CycleKind = (typeof CYCLE_KINDS)[number];

/**
 * One employment's review, through the lifecycle the specification describes.
 *
 * `peer_assessment` sits after `manager_assessment` rather than in parallel because a review is in
 * exactly one state, and the state names the work that is outstanding. A cycle that collects both
 * at once moves to whichever remains.
 */
export const REVIEW_STATUSES = [
  'pending',
  'self_assessment',
  'manager_assessment',
  'peer_assessment',
  'calibration',
  'completed',
  'archived',
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = {
  pending: ['self_assessment', 'manager_assessment'],
  self_assessment: ['manager_assessment'],
  manager_assessment: ['peer_assessment', 'calibration', 'completed'],
  peer_assessment: ['calibration', 'completed'],
  calibration: ['completed'],
  // AD-004. A completed review is immutable; the only move left is archival, and a correction is a
  // new review rather than an edit of this one.
  completed: ['archived'],
  archived: [],
};

/**
 * In what capacity somebody was asked to assess.
 *
 * This is where 360° lives. A peer, a direct report and a skip-level manager are three reviewer
 * roles on one review rather than three parallel systems (D-2), which is why there is no separate
 * "360 request" concept anywhere in this module.
 */
export const REVIEWER_ROLES = ['self', 'manager', 'peer', 'direct_report', 'skip_level'] as const;
export type ReviewerRole = (typeof REVIEWER_ROLES)[number];

/** The roles that make a review a multi-rater one. Used to decide whether a minimum applies. */
export const MULTI_RATER_ROLES: readonly ReviewerRole[] = ['peer', 'direct_report', 'skip_level'];

export const ASSIGNMENT_STATUSES = ['pending', 'submitted', 'declined'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_TRANSITIONS: Readonly<
  Record<AssignmentStatus, readonly AssignmentStatus[]>
> = {
  pending: ['submitted', 'declined'],
  submitted: [],
  declined: [],
};

/** An assessment kind is a reviewer role that produced one, and the two vocabularies match. */
export const ASSESSMENT_KINDS = REVIEWER_ROLES;
export type AssessmentKind = ReviewerRole;

/**
 * A draft belongs to its author and may be rewritten freely. A submitted assessment belongs to the
 * record, and the domain, the application and a database trigger all refuse to change it.
 */
export const ASSESSMENT_STATUSES = ['draft', 'submitted'] as const;
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number];

export const ASSESSMENT_TRANSITIONS: Readonly<
  Record<AssessmentStatus, readonly AssessmentStatus[]>
> = {
  draft: ['submitted'],
  submitted: [],
};

export const GOAL_STATUSES = [
  'draft',
  'approved',
  'active',
  'achieved',
  'missed',
  'cancelled',
] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_TRANSITIONS: Readonly<Record<GoalStatus, readonly GoalStatus[]>> = {
  draft: ['approved', 'cancelled'],
  approved: ['active', 'cancelled'],
  active: ['achieved', 'missed', 'cancelled'],
  achieved: [],
  missed: [],
  cancelled: [],
};

/** Where a goal was set. Which owner column applies follows from this and nothing else. */
export const GOAL_SCOPES = ['corporate', 'department', 'team', 'individual'] as const;
export type GoalScope = (typeof GOAL_SCOPES)[number];

export const GOAL_MEASUREMENTS = ['percentage', 'numeric', 'milestone', 'binary'] as const;
export type GoalMeasurement = (typeof GOAL_MEASUREMENTS)[number];

export const OBJECTIVE_STATUSES = ['open', 'achieved', 'missed', 'cancelled'] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

export const CALIBRATION_STATUSES = ['scheduled', 'in_session', 'concluded'] as const;
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number];

export const CALIBRATION_TRANSITIONS: Readonly<
  Record<CalibrationStatus, readonly CalibrationStatus[]>
> = {
  scheduled: ['in_session'],
  in_session: ['concluded'],
  // Concluded decisions are immutable. Reopening a session would imply they were not.
  concluded: [],
};

export const COMPETENCY_CATEGORIES = ['core', 'leadership', 'functional', 'technical'] as const;
export type CompetencyCategory = (typeof COMPETENCY_CATEGORIES)[number];

/**
 * What the final score is made of.
 *
 * Exactly two components, because those are the two things this module assesses. A tenant weights
 * them; a tenant does not add a third, because there is no third kind of assessment item and a
 * component with nothing behind it would weigh part of a score against nothing.
 */
export const SCORE_COMPONENTS = ['goals', 'competencies'] as const;
export type ScoreComponent = (typeof SCORE_COMPONENTS)[number];

/**
 * Why something did not participate in a score.
 *
 * Recorded rather than implied, because D-6's fifth decision is that missing or incomplete work is
 * **excluded from the denominator and the exclusion is recorded with its reason**. Silently
 * converting it to a zero would rate somebody down for work nobody assessed.
 *
 * `not_applicable` covers the case where the arithmetic itself has nothing to divide by — every
 * item in a component carrying a weight of zero, for instance. The component contributed nothing
 * and the record says which of the four reasons it was.
 */
export const EXCLUSION_REASONS = ['missing', 'incomplete', 'cancelled', 'not_applicable'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const FEEDBACK_KINDS = ['praise', 'suggestion', 'observation', 'requested'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/**
 * Who may read a piece of feedback.
 *
 * **There is no `anonymous` value, and there will not be one.** Every row in this module carries
 * `created_by`, row-level security is tenant-scoped, and the correlation identifier records the
 * request. Hiding an author in a screen is a presentation choice; it is not anonymity, and a
 * vocabulary that offered the word would be claiming a guarantee this architecture cannot make
 * (D-12).
 */
export const FEEDBACK_VISIBILITIES = ['subject', 'manager', 'hr'] as const;
export type FeedbackVisibility = (typeof FEEDBACK_VISIBILITIES)[number];

/** The nine-box axes. Three bands each, and the box code is derived from the pair. */
export const TALENT_BANDS = [1, 2, 3] as const;
export type TalentBand = (typeof TALENT_BANDS)[number];

const member = <TValue extends string>(values: readonly TValue[], value: string): value is TValue =>
  (values as readonly string[]).includes(value);

export const isCycleStatus = (value: string): value is CycleStatus => member(CYCLE_STATUSES, value);
export const isCycleKind = (value: string): value is CycleKind => member(CYCLE_KINDS, value);
export const isReviewStatus = (value: string): value is ReviewStatus =>
  member(REVIEW_STATUSES, value);
export const isReviewerRole = (value: string): value is ReviewerRole =>
  member(REVIEWER_ROLES, value);
export const isAssessmentKind = (value: string): value is AssessmentKind =>
  member(ASSESSMENT_KINDS, value);
export const isGoalStatus = (value: string): value is GoalStatus => member(GOAL_STATUSES, value);
export const isGoalScope = (value: string): value is GoalScope => member(GOAL_SCOPES, value);
export const isGoalMeasurement = (value: string): value is GoalMeasurement =>
  member(GOAL_MEASUREMENTS, value);
export const isObjectiveStatus = (value: string): value is ObjectiveStatus =>
  member(OBJECTIVE_STATUSES, value);
export const isCalibrationStatus = (value: string): value is CalibrationStatus =>
  member(CALIBRATION_STATUSES, value);
export const isCompetencyCategory = (value: string): value is CompetencyCategory =>
  member(COMPETENCY_CATEGORIES, value);
export const isScoreComponent = (value: string): value is ScoreComponent =>
  member(SCORE_COMPONENTS, value);
export const isExclusionReason = (value: string): value is ExclusionReason =>
  member(EXCLUSION_REASONS, value);
export const isFeedbackKind = (value: string): value is FeedbackKind =>
  member(FEEDBACK_KINDS, value);
export const isFeedbackVisibility = (value: string): value is FeedbackVisibility =>
  member(FEEDBACK_VISIBILITIES, value);
export const isAssignmentStatus = (value: string): value is AssignmentStatus =>
  member(ASSIGNMENT_STATUSES, value);
export const isAssessmentStatus = (value: string): value is AssessmentStatus =>
  member(ASSESSMENT_STATUSES, value);

/** The entity-code shape every tenant-defined code in this repository shares. */
const CODE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

export const isEntityCode = (value: string): boolean => CODE.test(value);

/**
 * Whether a move is one the machine permits. A move nobody listed is refused, which is the whole
 * point of holding the transitions as data.
 */
export const permits = <TState extends string>(
  transitions: Readonly<Record<TState, readonly TState[]>>,
  from: TState,
  to: TState,
): boolean => transitions[from].includes(to);
