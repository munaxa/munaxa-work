/**
 * The words this module uses, and the ones it refuses to.
 *
 * Every list here is a **closed vocabulary this module owns** and therefore translates. A tenant's
 * own values — a path code, a pool name, a readiness level's label — are never in this file: those
 * are strings the customer wrote, and a product that interpreted them would be interpreting the
 * customer's business (00B).
 *
 * Five refusals are worth stating before the lists, because each is a word that would have been
 * easy to reach for and wrong:
 *
 * **No `criticality`.** `organization_position.criticality` exists, `POSITION_CRITICALITIES` is
 * Organization's published vocabulary, and AD-004 assigns it there. A second copy here would be a
 * staler second answer to whether a position is critical (ADR-0072).
 *
 * **No `potential`, no `nine_box`, no `box_code`.** Performance owns `performance_talent_placement`
 * and publishes `potentialBand`. Pool membership is a *decision* somebody took; a nine-box placement
 * is an *observation* one calibration meeting made in one cycle. Neither derives the other, and a
 * word here that blurred them would make the product answer "is this person high potential" two
 * ways (ADR-0073).
 *
 * **No `course`, no `enrolment`, no `completion`.** Learning owns those. A development item that is
 * a course carries a Learning assignment identifier and no status of its own; what Career owns is
 * coaching, mentoring, projects and stretch assignments, which have no owner anywhere else.
 *
 * **No `readiness_score`, no `mix_target`, no `balance`.** The specification names readiness levels
 * and gives no derivation; it gives a 70-20-10 weighting and no validation rule. Readiness is
 * *stated* by a person and the mix is `NOT VERIFIED` (ADR-0074). A field here would be schema
 * claiming a rule nobody wrote.
 *
 * **No `promotion`, no `transfer`, no `effective_transfer_date`.** A mobility recommendation is
 * advisory. `accepted` means a human agreed with a suggestion, and nothing else happens (ADR-0072).
 */

const member = <TValue extends string>(values: readonly TValue[], value: string): value is TValue =>
  (values as readonly string[]).includes(value);

// ------------------------------------------------------------------------------------------------
// Career paths
// ------------------------------------------------------------------------------------------------

/**
 * What kind of progression a path describes.
 *
 * From the specification's list, plus `custom` because it says "Custom Paths — tenant configurable".
 * **Nothing in this module branches on a kind.** It is a label a tenant files a path under, exactly
 * as Learning's `PATH_KINDS` is, and a rule that read it would be this product deciding what
 * "leadership" means at somebody else's company.
 */
export const CAREER_PATH_KINDS = [
  'technical',
  'management',
  'leadership',
  'executive',
  'specialist',
  'custom',
] as const;
export type CareerPathKind = (typeof CAREER_PATH_KINDS)[number];

/**
 * A path's own lifecycle.
 *
 * `archived` and not `deleted`: a career plan created against a path in 2024 must still name what
 * it was planning towards, and removing the path would make the plan unexplainable. Archival is
 * terminal — a path is superseded by publishing a new one, never by un-archiving an old one.
 */
export const CAREER_PATH_STATUSES = ['draft', 'published', 'archived'] as const;
export type CareerPathStatus = (typeof CAREER_PATH_STATUSES)[number];

export const CAREER_PATH_TRANSITIONS: Readonly<
  Record<CareerPathStatus, readonly CareerPathStatus[]>
> = {
  draft: ['published', 'archived'],
  published: ['archived'],
  archived: [],
};

// ------------------------------------------------------------------------------------------------
// Career plans
// ------------------------------------------------------------------------------------------------

/**
 * One person's plan, and how it ended.
 *
 * `achieved` and `abandoned` are both endings and both are kept: "we planned this and they got
 * there" and "we planned this and stopped" are different answers a year later, and collapsing them
 * into one terminal state would lose the second.
 *
 * `archived` is separate again — a plan that is neither achieved nor abandoned but no longer worth
 * showing, typically because the person left. Reaching it from `draft` and `active` is deliberate.
 */
export const CAREER_PLAN_STATUSES = [
  'draft',
  'active',
  'achieved',
  'abandoned',
  'archived',
] as const;
export type CareerPlanStatus = (typeof CAREER_PLAN_STATUSES)[number];

export const CAREER_PLAN_TRANSITIONS: Readonly<
  Record<CareerPlanStatus, readonly CareerPlanStatus[]>
> = {
  draft: ['active', 'abandoned', 'archived'],
  active: ['achieved', 'abandoned', 'archived'],
  achieved: [],
  abandoned: [],
  archived: [],
};

// ------------------------------------------------------------------------------------------------
// Talent pools
// ------------------------------------------------------------------------------------------------

/**
 * What a tenant groups a pool by.
 *
 * From the specification's list, plus `custom`. As with a path kind, **nothing branches on it** —
 * and in particular `high_potential` is a name a tenant chose for a pool, not a fact this module
 * computes. Performance's `potentialBand` is the observation; membership of a pool called
 * "high potential" is a decision (ADR-0073).
 */
export const TALENT_POOL_KINDS = [
  'graduate',
  'leadership',
  'technical_expert',
  'future_manager',
  'high_potential',
  'custom',
] as const;
export type TalentPoolKind = (typeof TALENT_POOL_KINDS)[number];

/** A pool closes; its membership history stays. Removing a person is a period ending, not a delete. */
export const TALENT_POOL_STATUSES = ['active', 'closed'] as const;
export type TalentPoolStatus = (typeof TALENT_POOL_STATUSES)[number];

export const TALENT_POOL_TRANSITIONS: Readonly<
  Record<TalentPoolStatus, readonly TalentPoolStatus[]>
> = {
  active: ['closed'],
  closed: [],
};

// ------------------------------------------------------------------------------------------------
// Succession
// ------------------------------------------------------------------------------------------------

/** A succession plan for one position. The position and its criticality stay Organization's. */
export const SUCCESSION_PLAN_STATUSES = ['draft', 'active', 'archived'] as const;
export type SuccessionPlanStatus = (typeof SUCCESSION_PLAN_STATUSES)[number];

export const SUCCESSION_PLAN_TRANSITIONS: Readonly<
  Record<SuccessionPlanStatus, readonly SuccessionPlanStatus[]>
> = {
  draft: ['active', 'archived'],
  active: ['archived'],
  archived: [],
};

/**
 * A nomination's own state.
 *
 * `confirmed` is the moment an organization commits to a name, and it is what an auditor asks
 * about — which is why `career.successor.confirm` is a permission of its own and why
 * `system:auto-approval` is refused on it (ADR-0072).
 *
 * `withdrawn` is a state and never a delete. "We put this person forward and then took them off the
 * list" is exactly the history a succession review needs, and a deleted row cannot answer it.
 */
export const SUCCESSOR_STATUSES = ['nominated', 'confirmed', 'withdrawn'] as const;
export type SuccessorStatus = (typeof SUCCESSOR_STATUSES)[number];

export const SUCCESSOR_TRANSITIONS: Readonly<Record<SuccessorStatus, readonly SuccessorStatus[]>> =
  {
    nominated: ['confirmed', 'withdrawn'],
    confirmed: ['withdrawn'],
    withdrawn: [],
  };

// ------------------------------------------------------------------------------------------------
// Development
// ------------------------------------------------------------------------------------------------

/**
 * Which of the three kinds of development an item is.
 *
 * The categories the 70-20-10 model names. **They are recorded and counted, and nothing validates a
 * balance between them** — the specification gives a default weighting and the word "validated" and
 * defines neither the rule nor the tolerance nor how contribution is measured. Recording the
 * category costs nothing and loses nothing; inventing the verdict would decide whether somebody's
 * development plan is acceptable on a rule nobody wrote (ADR-0074, D-12 `NOT VERIFIED`).
 */
export const DEVELOPMENT_CATEGORIES = ['experience', 'exposure', 'education'] as const;
export type DevelopmentCategory = (typeof DEVELOPMENT_CATEGORIES)[number];

/**
 * What an item actually is.
 *
 * `course` is the one kind Career does not own: an item of that kind names a Learning assignment and
 * takes its progress from Learning. The other five have no owner anywhere in this repository, and
 * they are the reason a development plan is a Career aggregate rather than a Learning one.
 */
export const DEVELOPMENT_ITEM_KINDS = [
  'course',
  'coaching',
  'mentoring',
  'project',
  'stretch_assignment',
  'assessment',
] as const;
export type DevelopmentItemKind = (typeof DEVELOPMENT_ITEM_KINDS)[number];

export const DEVELOPMENT_PLAN_STATUSES = ['draft', 'active', 'completed', 'abandoned'] as const;
export type DevelopmentPlanStatus = (typeof DEVELOPMENT_PLAN_STATUSES)[number];

export const DEVELOPMENT_PLAN_TRANSITIONS: Readonly<
  Record<DevelopmentPlanStatus, readonly DevelopmentPlanStatus[]>
> = {
  draft: ['active', 'abandoned'],
  active: ['completed', 'abandoned'],
  completed: [],
  abandoned: [],
};

export const DEVELOPMENT_ITEM_STATUSES = [
  'planned',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export type DevelopmentItemStatus = (typeof DEVELOPMENT_ITEM_STATUSES)[number];

export const DEVELOPMENT_ITEM_TRANSITIONS: Readonly<
  Record<DevelopmentItemStatus, readonly DevelopmentItemStatus[]>
> = {
  planned: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

// ------------------------------------------------------------------------------------------------
// Mobility
// ------------------------------------------------------------------------------------------------

/** What kind of move is being suggested. From the specification's list. A suggestion, never a move. */
export const MOBILITY_KINDS = [
  'promotion',
  'lateral_move',
  'cross_department',
  'international_assignment',
  'temporary_assignment',
] as const;
export type MobilityKind = (typeof MOBILITY_KINDS)[number];

/**
 * What a recommendation currently *stands as*, including the one value nothing stores.
 *
 * `proposed`, `accepted` and `declined` are stored. **`expired` is never written**: it is derived
 * from the recommendation's own `validUntil` and the day somebody asked, because a stored flag
 * would need something to move it overnight and `JobPort` has no adapter anywhere in this
 * repository. This is exactly Learning's `VALIDITY_STATES` construction (ADR-0070) — a published
 * vocabulary for an answer computed on read.
 *
 * **`accepted` means a human agreed with the suggestion.** No transfer, no assignment, no letter,
 * no employment change of any kind (ADR-0072).
 */
export const MOBILITY_STATUSES = ['proposed', 'accepted', 'declined', 'expired'] as const;
export type MobilityStatus = (typeof MOBILITY_STATUSES)[number];

/** The three a row may actually hold. `expired` is derived and is not one of them. */
export const STORED_MOBILITY_STATUSES = ['proposed', 'accepted', 'declined'] as const;
export type StoredMobilityStatus = (typeof STORED_MOBILITY_STATUSES)[number];

export const MOBILITY_TRANSITIONS: Readonly<
  Record<StoredMobilityStatus, readonly StoredMobilityStatus[]>
> = {
  proposed: ['accepted', 'declined'],
  accepted: [],
  declined: [],
};

// ------------------------------------------------------------------------------------------------
// Shapes
// ------------------------------------------------------------------------------------------------

/**
 * A civil date. A target date is the same date in every time zone.
 *
 * Never a `Date` on the wire and never an instant — the Phase 8 defect this product has already
 * paid for once, and the reason Phase 14A has no timezone bug to find (D-11).
 *
 * **The round-trip is the check, and `Date.parse` alone is not.** Five modules validate a civil date
 * as `pattern && !Number.isNaN(Date.parse(...))`, and that accepts `2026-02-30`: V8 rolls an
 * out-of-range *day* into the next month and returns a perfectly good instant, so only an
 * out-of-range *month* ever produces `NaN`. A February 30th therefore passes as a due date, an
 * expiry or an assessment day, and PostgreSQL is the first thing to object — as a driver error
 * rather than a refusal a caller can act on.
 *
 * Comparing the parsed instant back to the string it came from is what closes it. `2026-02-30`
 * parses to `2026-03-02` and no longer matches; `2026-02-28` does. This was found by a Career domain
 * test; the five existing copies are a pre-existing repository-wide defect recorded as debt rather
 * than changed here, because they live in completed modules.
 */
export const isCivilDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};

/** A stable, human-authored code, unique within its tenant. The shape five modules already use. */
export const isCode = (value: string): boolean =>
  /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(value);

/**
 * A whole number inside a range, named once.
 *
 * Every number this module stores is one of these: a stage's position in a path, a successor's
 * rank, a readiness level's ordinal. There is no money, no rate, no percentage and nothing
 * computed — so there is no rounding rule to get wrong and no floating-point arithmetic anywhere
 * (ADR-0074).
 */
export const isWholeWithin = (value: number, low: number, high: number): boolean =>
  Number.isInteger(value) && value >= low && value <= high;

/** A stage's position in a path. An order, not a gate — nothing enforces progression (D-17). */
export const MAX_STAGE_SEQUENCE = 500;

/** A successor's rank on a bench. An order a human stated, never a computed score. */
export const MAX_SUCCESSOR_RANK = 50;

/** How many readiness levels a tenant may configure. Ordered least to most ready. */
export const MAX_READINESS_ORDINAL = 100;

/** The actor no act in this module accepts. `AutoApprovingPort` is not a human (ADR-0072). */
export const AUTO_APPROVAL = 'system:auto-approval';

export const isCareerPathKind = (value: string): value is CareerPathKind =>
  member(CAREER_PATH_KINDS, value);
export const isTalentPoolKind = (value: string): value is TalentPoolKind =>
  member(TALENT_POOL_KINDS, value);
export const isDevelopmentCategory = (value: string): value is DevelopmentCategory =>
  member(DEVELOPMENT_CATEGORIES, value);
export const isDevelopmentItemKind = (value: string): value is DevelopmentItemKind =>
  member(DEVELOPMENT_ITEM_KINDS, value);
export const isMobilityKind = (value: string): value is MobilityKind =>
  member(MOBILITY_KINDS, value);
