/**
 * The words this module uses, and the ones it refuses to.
 *
 * Every list here is a **closed vocabulary this module owns** and therefore translates. A tenant's
 * own values — a course code, a category name, a provider's name — are never in this file: those are
 * strings the customer wrote, and a product that interpreted them would be interpreting the
 * customer's business (00B).
 *
 * Three refusals are worth stating before the lists, because each is a word that would have been
 * easy to reach for and wrong:
 *
 * **No `competency`, no `skill`, no `capability`.** Three modules already answer questions that
 * sound alike and are not: `person_capability` (Phase 4) holds what somebody **claims**,
 * `performance_competency` (Phase 13) holds what a manager **observed of the job**, and this module
 * holds what somebody **attained**. AD-002 says course completion does not imply competency, and a
 * `competency_id` column here would imply it in schema before anybody wrote a rule.
 *
 * **No `grade` and no `score` aggregate.** The specification names five assessment kinds and defines
 * no scoring formula, no threshold, no weighting and no rounding. A product that invented one would
 * be inventing how somebody passes, which is not a detail — see `assessment.ts`.
 *
 * **No `session`, no `capacity`, no `waitlist`.** Those are Phase 14B, and a state or a column left
 * here "ready for them" would be schema claiming a capability nobody built.
 */

const member = <TValue extends string>(values: readonly TValue[], value: string): value is TValue =>
  (values as readonly string[]).includes(value);

// ------------------------------------------------------------------------------------------------
// Catalogue
// ------------------------------------------------------------------------------------------------

/**
 * How a course is delivered.
 *
 * From the specification's list. `instructor_led`, `virtual`, `classroom` and `blended` describe a
 * *delivery mode a course is designed for* — they do not schedule anything, and nothing in Phase 14A
 * books a room or a trainer. A course marked `classroom` with no Phase 14B is a course a tenant
 * records and arranges outside this product.
 */
export const COURSE_DELIVERIES = [
  'self_paced',
  'instructor_led',
  'virtual',
  'classroom',
  'blended',
  'external',
] as const;
export type CourseDelivery = (typeof COURSE_DELIVERIES)[number];

/**
 * A course's own lifecycle.
 *
 * `archived` and not `deleted`: a completed enrolment must still name what was completed, and
 * removing a course would make a certification unexplainable. Withdrawal from the catalogue is a
 * state, and it is reversible only by publishing a new version rather than by un-archiving.
 */
export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const COURSE_TRANSITIONS: Readonly<Record<CourseStatus, readonly CourseStatus[]>> = {
  draft: ['published', 'archived'],
  published: ['archived'],
  // Terminal. A course that came back would be a course whose history has a gap in it.
  archived: [],
};

/**
 * What a learning path is for.
 *
 * From the specification's list, and every one of them is a *label a tenant chose*, not a rule this
 * module applies. Nothing branches on it (AD-003).
 */
export const PATH_KINDS = [
  'role_based',
  'department',
  'certification',
  'leadership',
  'custom',
] as const;
export type PathKind = (typeof PATH_KINDS)[number];

export const PATH_STATUSES = ['draft', 'published', 'archived'] as const;
export type PathStatus = (typeof PATH_STATUSES)[number];

// ------------------------------------------------------------------------------------------------
// Requirement and assignment
// ------------------------------------------------------------------------------------------------

/**
 * Why a tenant made something mandatory.
 *
 * From the specification's list, and **tenant configurable** per AD-006: no course is mandatory
 * because this product says so. The category is documentation of the tenant's own reason, and no
 * rule here reads it.
 */
export const MANDATORY_KINDS = [
  'compliance',
  'safety',
  'policy',
  'orientation',
  'role_based',
] as const;
export type MandatoryKind = (typeof MANDATORY_KINDS)[number];

/**
 * Who a mandatory rule applies to.
 *
 * Resolved through Employment's published contract at the moment the rule is reconciled, never from
 * a list somebody typed. `everybody` is the whole active workforce; the other two narrow it.
 */
export const AUDIENCE_KINDS = ['everybody', 'organization_unit', 'position'] as const;
export type AudienceKind = (typeof AUDIENCE_KINDS)[number];

/**
 * An assignment's own state.
 *
 * **`overdue` is deliberately absent.** Overdue-ness is a function of the due date and today, and a
 * stored flag needs something to move it on the right morning — `JobPort` has no adapter, so nothing
 * would (ADR-0071, and Documents' identical reasoning in `expiry.ts`). It is derived on read.
 */
export const ASSIGNMENT_STATUSES = ['assigned', 'satisfied', 'waived', 'cancelled'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_TRANSITIONS: Readonly<
  Record<AssignmentStatus, readonly AssignmentStatus[]>
> = {
  assigned: ['satisfied', 'waived', 'cancelled'],
  // All three are terminal. An assignment that was satisfied and then reopened would be a second
  // assignment wearing the first one's identity, and the compliance trail would lose the first.
  satisfied: [],
  waived: [],
  cancelled: [],
};

/** Why somebody was asked to learn something. Recorded so a queue can be explained. */
export const ASSIGNMENT_SOURCES = ['mandatory_rule', 'learning_path', 'direct'] as const;
export type AssignmentSource = (typeof ASSIGNMENT_SOURCES)[number];

// ------------------------------------------------------------------------------------------------
// Enrolment
// ------------------------------------------------------------------------------------------------

/**
 * An enrolment's lifecycle, as approved in the Definition of Ready (D-3).
 *
 * **Enrolling is not completing**, and the states are separate for that reason: `enrolled` says
 * somebody is on the course, `in_progress` says they have started, and `completed` says an
 * authorized human recorded that they finished. Nothing moves between them on its own.
 *
 * `withdrawn` and `failed` are both endings and they mean different things — leaving a course is not
 * failing it, and a compliance report that could not tell them apart would be useless.
 */
export const ENROLMENT_STATUSES = [
  'enrolled',
  'in_progress',
  'completed',
  'failed',
  'withdrawn',
] as const;
export type EnrolmentStatus = (typeof ENROLMENT_STATUSES)[number];

export const ENROLMENT_TRANSITIONS: Readonly<Record<EnrolmentStatus, readonly EnrolmentStatus[]>> =
  {
    enrolled: ['in_progress', 'withdrawn'],
    in_progress: ['completed', 'failed', 'withdrawn'],
    // Completion is immutable: a correction is a new enrolment, never an edit of the old one. The
    // domain refuses it and a trigger refuses it again (§15 of the plan).
    completed: [],
    failed: [],
    withdrawn: [],
  };

/** The three endings, named once so a rule does not have to list them. */
export const isEnrolmentClosed = (status: EnrolmentStatus): boolean =>
  status === 'completed' || status === 'failed' || status === 'withdrawn';

// ------------------------------------------------------------------------------------------------
// Assessment
// ------------------------------------------------------------------------------------------------

/**
 * The five assessment kinds the specification names, and nothing else.
 *
 * `external_result` is a result somebody obtained elsewhere and an administrator recorded. It is a
 * *kind*, not an integration: no connector exists, and Phase 22 owns the one that might.
 */
export const ASSESSMENT_KINDS = [
  'quiz',
  'practical',
  'assignment',
  'observation',
  'external_result',
] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

/**
 * What an assessment result says, and the reason there are only three values.
 *
 * **The specification defines no scoring formula, no pass threshold, no weighting, no rounding and
 * no attempt policy.** It names five kinds and says "assessments measure learning progress only".
 * So the outcome an authorized assessor records is the fact, and this product neither computes it
 * nor second-guesses it.
 *
 * `recorded` exists because an observation or an assignment often has no pass and no fail — it
 * happened, and somebody noted it. Forcing that into `passed` would state something nobody decided.
 *
 * A raw mark may be stored beside the outcome for the tenant's own records. **Nothing in this module
 * reads it, compares it, thresholds it or aggregates it**, and aggregate scoring is `NOT VERIFIED`
 * rather than approximated.
 */
export const ASSESSMENT_OUTCOMES = ['passed', 'failed', 'recorded'] as const;
export type AssessmentOutcome = (typeof ASSESSMENT_OUTCOMES)[number];

// ------------------------------------------------------------------------------------------------
// Certification
// ------------------------------------------------------------------------------------------------

/**
 * Where a certification came from (D-2).
 *
 * A certification **may exist with no enrolment behind it**: a tenant recording a forklift licence
 * somebody already held needs to record it, and manufacturing an enrolment to satisfy a foreign key
 * would state that they took a course they never took.
 *
 * The source is a column rather than an inference from which fields are null, so "where did this
 * come from" is a fact somebody can query and report on.
 */
export const CERTIFICATION_SOURCES = ['learning_completion', 'external', 'recorded'] as const;
export type CertificationSource = (typeof CERTIFICATION_SOURCES)[number];

/**
 * A certification's own state — and note what is **not** here.
 *
 * There is no `expired`. Expiry is a function of `valid_until` and today, derived on read, following
 * `documents/src/domain/expiry.ts` for the reason stated there: a stored flag needs something to
 * move it on the right morning, and nothing scheduled runs in this product (ADR-0070, ADR-0071).
 *
 * `revoked` and `superseded` are different: revoked says the issuer withdrew it, superseded says a
 * recertification replaced it. A report that could not distinguish "we took it away" from "they
 * renewed it" would be describing two very different people the same way.
 */
export const CERTIFICATION_STATUSES = ['active', 'revoked', 'superseded'] as const;
export type CertificationStatus = (typeof CERTIFICATION_STATUSES)[number];

export const CERTIFICATION_TRANSITIONS: Readonly<
  Record<CertificationStatus, readonly CertificationStatus[]>
> = {
  active: ['revoked', 'superseded'],
  revoked: [],
  superseded: [],
};

/** How a certification stands against its validity date. Derived, never stored. */
export const VALIDITY_STATES = ['valid', 'expiring_soon', 'expired', 'no_expiry'] as const;
export type ValidityState = (typeof VALIDITY_STATES)[number];

// ------------------------------------------------------------------------------------------------
// Shapes
// ------------------------------------------------------------------------------------------------

/**
 * A civil date. A due date is the same date in every time zone.
 *
 * The repository's established shape, validated identically in five modules. Never a `Date` on the
 * wire, and never an instant — the Phase 8 defect this product has already paid for once.
 */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

/** A stable, human-authored code, unique within its tenant. The shape People and Performance use. */
export const isCode = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

/**
 * How often a mandatory rule repeats, in whole months.
 *
 * Months rather than days because that is how a policy is written — "annually", "every two years" —
 * and a day count would make "every year" mean something slightly different each leap year. `0` is
 * a rule that never repeats: once satisfied, always satisfied.
 */
export const MAX_RECURRENCE_MONTHS = 600;
export const isRecurrenceMonths = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_RECURRENCE_MONTHS;

/**
 * A whole number inside a range, named once.
 *
 * Half a dozen fields here are "a positive whole number that is not absurd" — minutes, months, days,
 * a position in a path — and spelling the three clauses out at each one pushes every factory over
 * the complexity budget while making the actual business rule harder to see among them.
 */
export const isWholeWithin = (value: number, minimum: number, maximum: number): boolean =>
  Number.isInteger(value) && value >= minimum && value <= maximum;

export const isCourseStatus = (value: string): value is CourseStatus =>
  member(COURSE_STATUSES, value);
export const isEnrolmentStatus = (value: string): value is EnrolmentStatus =>
  member(ENROLMENT_STATUSES, value);
export const isAssignmentStatus = (value: string): value is AssignmentStatus =>
  member(ASSIGNMENT_STATUSES, value);
export const isCertificationStatus = (value: string): value is CertificationStatus =>
  member(CERTIFICATION_STATUSES, value);
