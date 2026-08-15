/**
 * What Career publishes, as shapes another module or the API may depend on.
 *
 * **Dates leave as civil-date strings** (`YYYY-MM-DD`), never as `Date`. A target date, a
 * membership period and an assessment day are the same day in every time zone, and a `Date` on the
 * wire serializes differently depending on who does it — the Phase 8 defect this product has
 * already paid for once (D-11). The only instants here are the audit moments a row was archived or
 * closed, and they say `At` in their names.
 *
 * **Derived state travels as a value, not as a stored column.** `standing` on a mobility
 * recommendation, `overdue` on a development item, `inForce` on a path and `reviewDue` on a
 * succession plan are computed against a stated `asOf` day, because no table holds any of them and
 * nothing in this product moves one overnight (D-13, ADR-0070's construction).
 *
 * **No score appears anywhere.** A readiness assessment carries the level a person stated and the
 * rationale they wrote. A readiness level carries an ordinal that orders the ladder and is never
 * published as a scale. A development plan carries three category counts and no verdict. Nothing
 * here totals, weights, thresholds or ranks, because the specification defines no formula and a
 * computed number would be believed precisely because it looked computed (ADR-0074, D-12).
 *
 * **Nothing here is another module's fact.** There is no criticality on a succession plan, no
 * potential band beside a nomination, and no course title on a development item — only the
 * identifiers through which a consumer may ask the module that owns them (ADR-0072, ADR-0073).
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

// ------------------------------------------------------------------------------------------------
// Paths and stages
// ------------------------------------------------------------------------------------------------

export interface CareerPathView {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly description?: LocalizedTextView;
  readonly kind: string;
  readonly status: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  /** Derived against the day the caller asked. No column holds it. */
  readonly inForce: boolean;
  readonly stageCount: number;
  readonly version: number;
}

/** `sequence` is an order along the path and never a prerequisite (D-17). */
export interface CareerStageView {
  readonly stageId: string;
  readonly pathId: string;
  readonly sequence: number;
  readonly name: LocalizedTextView;
  /** Organization's identifier. Career publishes nothing else about the position, and no criticality. */
  readonly targetPositionId?: string;
}

export interface CareerPathDetailView {
  readonly path: CareerPathView;
  readonly stages: readonly CareerStageView[];
  /** The day `inForce` was answered for. Stated so a screen never implies "now" and is wrong by one. */
  readonly asOf: string;
}

// ------------------------------------------------------------------------------------------------
// Plans
// ------------------------------------------------------------------------------------------------

export interface CareerPlanView {
  readonly careerPlanId: string;
  readonly employmentId: string;
  readonly pathId?: string;
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly status: string;
  readonly startedOn: string;
  readonly targetDate?: string;
  readonly notes?: string;
  readonly closedOn?: string;
  readonly closedBy?: string;
  readonly version: number;
}

// ------------------------------------------------------------------------------------------------
// Pools
// ------------------------------------------------------------------------------------------------

/**
 * A pool a tenant named.
 *
 * `kind` is a label they chose. **Nothing in this product branches on it**, and a pool named
 * `high_potential` is not derived from and does not derive Performance's potential band (ADR-0073).
 */
export interface TalentPoolView {
  readonly talentPoolId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly description?: LocalizedTextView;
  readonly kind: string;
  readonly status: string;
  readonly closedAt?: string;
  readonly closedBy?: string;
  readonly version: number;
}

/** A period, both ends inclusive. `to` absent means the membership is open. */
export interface PoolMembershipView {
  readonly membershipId: string;
  readonly talentPoolId: string;
  readonly employmentId: string;
  readonly from: string;
  readonly to?: string;
  readonly addedBy: string;
  readonly addedReason?: string;
  readonly removedBy?: string;
  readonly removedReason?: string;
  readonly version: number;
}

// ------------------------------------------------------------------------------------------------
// Succession
// ------------------------------------------------------------------------------------------------

/**
 * The plan **for** a position, not a second record of the position (D-3).
 *
 * There is no `criticality` field and there will not be one: Organization owns it (AD-004), and a
 * copy here would be the staler of two answers.
 */
export interface SuccessionPlanView {
  readonly successionPlanId: string;
  readonly positionId: string;
  readonly status: string;
  readonly reviewOn?: string;
  readonly notes?: string;
  /**
   * Whether the review day has passed, on the day the caller asked. Derived.
   *
   * **Nothing reminds anybody.** `JobPort` has no adapter, so a review comes due because somebody
   * ran this query — not because anything fired. Scheduled review is `NOT VERIFIED`.
   */
  readonly reviewDue: boolean;
  readonly archivedAt?: string;
  readonly archivedBy?: string;
  readonly version: number;
}

/** `rank` is an order a human put the bench in. Not a score, and nothing computes it. */
export interface SuccessorView {
  readonly successorId: string;
  readonly successionPlanId: string;
  readonly employmentId: string;
  readonly readinessLevelId?: string;
  readonly rank?: number;
  readonly status: string;
  readonly nominatedOn: string;
  readonly nominatedBy: string;
  readonly confirmedOn?: string;
  readonly confirmedBy?: string;
  readonly withdrawnOn?: string;
  readonly withdrawnBy?: string;
  readonly withdrawalReason?: string;
  readonly version: number;
}

export interface SuccessionPlanDetailView {
  readonly plan: SuccessionPlanView;
  readonly successors: readonly SuccessorView[];
  readonly asOf: string;
}

// ------------------------------------------------------------------------------------------------
// Readiness
// ------------------------------------------------------------------------------------------------

/**
 * A tenant's own ladder.
 *
 * `ordinal` orders the levels least to most ready so a screen can sort them and a consumer can
 * compare by index. **It is not a score and is never published as one** — the construction
 * Organization uses for `POSITION_CRITICALITIES`, and for the same reason.
 */
export interface ReadinessLevelView {
  readonly readinessLevelId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly ordinal: number;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One person's statement that somebody is at one level, on one day.
 *
 * **Stated, never computed** (ADR-0074, D-10). There is no score, no weight, no derived level and
 * no reference to the inputs a derivation would have used.
 */
export interface ReadinessAssessmentView {
  readonly readinessAssessmentId: string;
  readonly employmentId: string;
  readonly readinessLevelId: string;
  readonly positionId?: string;
  readonly successionPlanId?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
  readonly rationale?: string;
  /** The instant the row was written — genuinely a moment, which is why this one is not civil. */
  readonly recordedAt: string;
}

// ------------------------------------------------------------------------------------------------
// Development
// ------------------------------------------------------------------------------------------------

/**
 * **Joint ownership is `NOT VERIFIED`** (D-9).
 *
 * The field names say what is true: an administrator *recorded* that each party acknowledged, and
 * the recorder is the authenticated actor. A field named `employeeSignedBy` would claim something
 * the platform cannot deliver, because there is no principal-to-employment resolution (ADR-0032).
 */
export interface DevelopmentPlanView {
  readonly developmentPlanId: string;
  readonly employmentId: string;
  readonly careerPlanId?: string;
  readonly cycleLabel?: string;
  readonly status: string;
  readonly startedOn: string;
  readonly targetDate?: string;
  readonly employeeAcknowledgedOn?: string;
  readonly employeeAcknowledgementRecordedBy?: string;
  readonly managerAcknowledgedOn?: string;
  readonly managerAcknowledgementRecordedBy?: string;
  readonly closedOn?: string;
  readonly closedBy?: string;
  readonly version: number;
}

/**
 * One thing somebody is going to do.
 *
 * A `course` item carries `learningAssignmentId` and nothing else about the course: no title, no
 * completion date, no progress. Whether somebody finished is Learning's answer, asked of Learning
 * (ADR-0073, D-2).
 */
export interface DevelopmentItemView {
  readonly developmentItemId: string;
  readonly developmentPlanId: string;
  readonly category: string;
  readonly kind: string;
  readonly title: string;
  readonly learningAssignmentId?: string;
  readonly targetDate?: string;
  readonly status: string;
  readonly completedOn?: string;
  readonly completedBy?: string;
  /** Derived against the day the caller asked. Nothing notices it and nobody is told. */
  readonly overdue: boolean;
  readonly version: number;
}

/**
 * Three counts, and deliberately nothing more.
 *
 * `mixVerdict` is the constant string `NOT VERIFIED`. The 70-20-10 model the specification names
 * carries a default weighting and the word "validated", and defines neither the rule, the tolerance,
 * how contribution is measured, nor what an uncategorized item does (D-12). So this product counts
 * and does not judge — and says so in the response rather than omitting the field, because a missing
 * field reads as "balanced" to a screen that forgot to check.
 */
export interface DevelopmentMixView {
  readonly experience: number;
  readonly exposure: number;
  readonly education: number;
  readonly mixVerdict: 'NOT VERIFIED';
}

export interface DevelopmentPlanDetailView {
  readonly plan: DevelopmentPlanView;
  readonly items: readonly DevelopmentItemView[];
  readonly mix: DevelopmentMixView;
  readonly asOf: string;
}

// ------------------------------------------------------------------------------------------------
// Mobility
// ------------------------------------------------------------------------------------------------

/**
 * A suggestion, and nothing that moves anybody (ADR-0072).
 *
 * `status` is what is stored — `proposed`, `accepted` or `declined`. `standing` is what it *reads
 * as* on the day asked, and is the only place `expired` is ever produced (D-13). There is no
 * effective date and no assignment identifier, because there is nothing for either to point at.
 */
export interface MobilityRecommendationView {
  readonly mobilityRecommendationId: string;
  readonly employmentId: string;
  readonly kind: string;
  readonly targetPositionId?: string;
  readonly targetUnitId?: string;
  readonly rationale?: string;
  readonly status: string;
  readonly standing: string;
  readonly recommendedOn: string;
  readonly recommendedBy: string;
  readonly validUntil?: string;
  readonly decidedOn?: string;
  readonly decidedBy?: string;
  readonly decisionNote?: string;
  readonly version: number;
}

// ------------------------------------------------------------------------------------------------
// The derived summary
// ------------------------------------------------------------------------------------------------

/**
 * One person's career position, assembled on read from Career's own rows (D-16).
 *
 * **Not a table.** A materialized summary needs something to maintain it, and nothing in this
 * repository runs. Every field is either a Career row or a count of Career rows.
 *
 * **`ninebox` is absent, and that is a decision rather than an omission.** Showing a potential band
 * beside a nomination would need `performance.talent-matrix`, which is unpaged and cycle-wide; that
 * contract change was not authorized (D-5), so the capability is `NOT VERIFIED` and no field here
 * hints at it.
 */
export interface CareerSummaryView {
  readonly employmentId: string;
  readonly plan?: CareerPlanView;
  readonly openPoolMemberships: readonly PoolMembershipView[];
  readonly openNominations: readonly SuccessorView[];
  readonly latestReadiness?: ReadinessAssessmentView;
  readonly activeDevelopmentPlan?: DevelopmentPlanView;
  readonly openRecommendations: readonly MobilityRecommendationView[];
  /** The day every derived field above was answered for. */
  readonly asOf: string;
}

/**
 * What a bench looks like, counted by the database rather than by a page of rows.
 *
 * A count assembled from `items.length` would be the size of the page, which is the defect this
 * shape exists to make impossible.
 */
export interface BenchStrengthView {
  readonly successionPlanId: string;
  readonly positionId: string;
  readonly nominated: number;
  readonly confirmed: number;
  readonly asOf: string;
}
