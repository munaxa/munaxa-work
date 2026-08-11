import type { Transaction } from '@work/kernel';
import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type { CalibrationDecisionState, CalibrationSessionState } from '../domain/calibration.js';
import type {
  CompetencyFrameworkState,
  CompetencyLevelState,
  CompetencyState,
} from '../domain/competency-framework.js';
import type { CycleState } from '../domain/cycle.js';
import type { FeedbackState } from '../domain/feedback.js';
import type { GoalProgressState, GoalState } from '../domain/goal.js';
import type { RatingLevelState, RatingScaleState } from '../domain/rating-scale.js';
import type { ReviewSnapshotState } from '../domain/review-snapshot.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { ReviewState, ReviewerAssignmentState } from '../domain/review.js';
import type { TalentPlacementState } from '../domain/talent-placement.js';
import type { ComponentOutcome } from '../domain/scoring.js';

/**
 * The persistence and the cross-module reads this module needs, as interfaces the domain never
 * sees.
 *
 * Three stores are **deliberately narrower than the rest**. `GoalProgressStore`,
 * `CalibrationDecisionStore` and `SnapshotStore` offer inserts and reads and **no update, no
 * remove**. Each of them is the record of something that already happened — what somebody reported
 * in March, what a meeting decided, what a completed review was calculated from — and the cheapest
 * guarantee that nobody rewrote one is to have no method that could. The database refuses it too,
 * with a trigger; this is the same rule expressed where a developer meets it first.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound. There is no unbounded query in this module: a tenant running an annual cycle for a
 * hundred thousand employments is the case this is designed for, not the exception.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface Clock {
  now(): Date;
}

// ------------------------------------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------------------------------------

export interface RatingScaleStore {
  byId(transaction: Transaction, id: string): Promise<RatingScaleState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<RatingScaleState | undefined>;
  all(transaction: Transaction): Promise<readonly RatingScaleState[]>;
  levelsFor(transaction: Transaction, scaleId: string): Promise<readonly RatingLevelState[]>;
  insert(
    transaction: Transaction,
    scale: RatingScaleState,
    levels: readonly RatingLevelState[],
  ): Promise<void>;
  update(transaction: Transaction, scale: RatingScaleState, expected: number): Promise<void>;
}

export interface CompetencyFrameworkStore {
  byId(transaction: Transaction, id: string): Promise<CompetencyFrameworkState | undefined>;
  byCode(
    transaction: Transaction,
    code: string,
    frameworkVersion: number,
  ): Promise<CompetencyFrameworkState | undefined>;
  all(transaction: Transaction): Promise<readonly CompetencyFrameworkState[]>;
  competenciesFor(
    transaction: Transaction,
    frameworkId: string,
  ): Promise<readonly CompetencyState[]>;
  levelsFor(
    transaction: Transaction,
    competencyId: string,
  ): Promise<readonly CompetencyLevelState[]>;
  insert(transaction: Transaction, framework: CompetencyFrameworkState): Promise<void>;
  update(
    transaction: Transaction,
    framework: CompetencyFrameworkState,
    expected: number,
  ): Promise<void>;
  insertCompetency(
    transaction: Transaction,
    competency: CompetencyState,
    levels: readonly CompetencyLevelState[],
  ): Promise<void>;
}

export interface GoalCategoryState {
  readonly goalCategoryId: string;
  readonly code: string;
  readonly name: { readonly en: string; readonly ar: string };
  readonly active: boolean;
  readonly version: number;
}

export interface GoalCategoryStore {
  byId(transaction: Transaction, id: string): Promise<GoalCategoryState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<GoalCategoryState | undefined>;
  all(transaction: Transaction): Promise<readonly GoalCategoryState[]>;
  insert(transaction: Transaction, state: GoalCategoryState): Promise<void>;
  update(transaction: Transaction, state: GoalCategoryState, expected: number): Promise<void>;
}

export interface TemplateStore {
  byId(transaction: Transaction, id: string): Promise<ReviewTemplateState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<ReviewTemplateState | undefined>;
  all(transaction: Transaction): Promise<readonly ReviewTemplateState[]>;
  componentsFor(
    transaction: Transaction,
    templateId: string,
  ): Promise<readonly TemplateComponentState[]>;
  insert(
    transaction: Transaction,
    template: ReviewTemplateState,
    components: readonly TemplateComponentState[],
  ): Promise<void>;
  update(transaction: Transaction, template: ReviewTemplateState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Goals
// ------------------------------------------------------------------------------------------------

export interface GoalFilters {
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly cycleId?: string;
  readonly status?: string;
  readonly scope?: string;
  readonly parentGoalId?: string;
  /** Restricts the result to these employments. The manager queue's bound, applied in the store. */
  readonly employmentIdsIn?: readonly string[];
}

export interface GoalStore {
  byId(transaction: Transaction, id: string): Promise<GoalState | undefined>;
  search(transaction: Transaction, filters: GoalFilters, paged: Paged): Promise<Page<GoalState>>;
  /** Every goal of one employment in one cycle. What the scoring engine's goal component reads. */
  forReview(
    transaction: Transaction,
    employmentId: string,
    cycleId: string,
  ): Promise<readonly GoalState[]>;
  insert(transaction: Transaction, state: GoalState): Promise<void>;
  update(transaction: Transaction, state: GoalState, expected: number): Promise<void>;
}

/** Insert and read. A progress entry is never edited: the trail is what a dispute is argued from. */
export interface GoalProgressStore {
  forGoal(transaction: Transaction, goalId: string): Promise<readonly GoalProgressState[]>;
  insert(transaction: Transaction, state: GoalProgressState): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Cycles and reviews
// ------------------------------------------------------------------------------------------------

export interface CycleStore {
  byId(transaction: Transaction, id: string): Promise<CycleState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CycleState | undefined>;
  all(transaction: Transaction, paged: Paged): Promise<Page<CycleState>>;
  insert(transaction: Transaction, state: CycleState): Promise<void>;
  update(transaction: Transaction, state: CycleState, expected: number): Promise<void>;
}

export interface ReviewFilters {
  readonly cycleId?: string;
  readonly employmentId?: string;
  readonly managerEmploymentId?: string;
  readonly status?: string;
  /** Restricts to these employments. How `read-team` is bounded, and never a client-supplied list. */
  readonly employmentIdsIn?: readonly string[];
}

export interface ReviewStore {
  byId(transaction: Transaction, id: string): Promise<ReviewState | undefined>;
  forParticipant(
    transaction: Transaction,
    cycleId: string,
    employmentId: string,
  ): Promise<ReviewState | undefined>;
  forCycle(transaction: Transaction, cycleId: string): Promise<readonly ReviewState[]>;
  search(
    transaction: Transaction,
    filters: ReviewFilters,
    paged: Paged,
  ): Promise<Page<ReviewState>>;
  insert(transaction: Transaction, state: ReviewState): Promise<void>;
  /**
   * Optimistic. `expected` is the version the caller read; a mismatch is the refusal that settles
   * two managers completing one review at the same moment.
   */
  update(transaction: Transaction, state: ReviewState, expected: number): Promise<void>;
}

export interface ReviewerAssignmentStore {
  byId(transaction: Transaction, id: string): Promise<ReviewerAssignmentState | undefined>;
  forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly ReviewerAssignmentState[]>;
  forReviewer(
    transaction: Transaction,
    reviewerEmploymentId: string,
    paged: Paged,
  ): Promise<Page<ReviewerAssignmentState>>;
  insert(transaction: Transaction, state: ReviewerAssignmentState): Promise<void>;
  update(transaction: Transaction, state: ReviewerAssignmentState, expected: number): Promise<void>;
}

export interface AssessmentStore {
  byId(transaction: Transaction, id: string): Promise<AssessmentState | undefined>;
  forReview(transaction: Transaction, reviewId: string): Promise<readonly AssessmentState[]>;
  forAssessor(
    transaction: Transaction,
    reviewId: string,
    assessorEmploymentId: string,
    assessmentKind: string,
  ): Promise<AssessmentState | undefined>;
  itemsFor(transaction: Transaction, assessmentId: string): Promise<readonly AssessmentItemState[]>;
  insert(transaction: Transaction, state: AssessmentState): Promise<void>;
  update(transaction: Transaction, state: AssessmentState, expected: number): Promise<void>;
  upsertItem(transaction: Transaction, item: AssessmentItemState): Promise<void>;
}

export interface ComponentScoreRecord extends ComponentOutcome {
  readonly reviewId: string;
  readonly calculatedAt: Date;
}

export interface ComponentScoreStore {
  forReview(transaction: Transaction, reviewId: string): Promise<readonly ComponentScoreRecord[]>;
  /** Replaces the working for one review. Rescoring supersedes it; nothing accumulates. */
  replace(
    transaction: Transaction,
    reviewId: string,
    records: readonly ComponentScoreRecord[],
  ): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Calibration, classification, feedback and the snapshot
// ------------------------------------------------------------------------------------------------

export interface CalibrationSessionStore {
  byId(transaction: Transaction, id: string): Promise<CalibrationSessionState | undefined>;
  forCycle(transaction: Transaction, cycleId: string): Promise<readonly CalibrationSessionState[]>;
  insert(transaction: Transaction, state: CalibrationSessionState): Promise<void>;
  update(transaction: Transaction, state: CalibrationSessionState, expected: number): Promise<void>;
}

/** Insert and read. A decision records what a rating was before; a rewritable one records nothing. */
export interface CalibrationDecisionStore {
  forSession(
    transaction: Transaction,
    sessionId: string,
  ): Promise<readonly CalibrationDecisionState[]>;
  forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly CalibrationDecisionState[]>;
  insert(transaction: Transaction, state: CalibrationDecisionState): Promise<void>;
}

export interface TalentPlacementStore {
  forCycle(transaction: Transaction, cycleId: string): Promise<readonly TalentPlacementState[]>;
  forReview(transaction: Transaction, reviewId: string): Promise<TalentPlacementState | undefined>;
  insert(transaction: Transaction, state: TalentPlacementState): Promise<void>;
  update(transaction: Transaction, state: TalentPlacementState, expected: number): Promise<void>;
}

export interface FeedbackFilters {
  readonly subjectEmploymentId?: string;
  readonly authorEmploymentId?: string;
  readonly relatedReviewId?: string;
  readonly subjectEmploymentIdsIn?: readonly string[];
}

/** Insert, read and withdraw. There is no edit: what somebody said is what they said. */
export interface FeedbackStore {
  byId(transaction: Transaction, id: string): Promise<FeedbackState | undefined>;
  search(
    transaction: Transaction,
    filters: FeedbackFilters,
    paged: Paged,
  ): Promise<Page<FeedbackState>>;
  insert(transaction: Transaction, state: FeedbackState): Promise<void>;
  withdraw(transaction: Transaction, id: string, at: Date, by: string): Promise<void>;
}

/** Insert and read. Written once at completion; the reason a rating survives a reorganization. */
export interface SnapshotStore {
  forReview(transaction: Transaction, reviewId: string): Promise<ReviewSnapshotState | undefined>;
  insert(transaction: Transaction, state: ReviewSnapshotState): Promise<void>;
}

export interface ReconciliationFinding {
  readonly kind: string;
  readonly subjectId: string;
  readonly detail: Readonly<Record<string, string>>;
}

/**
 * What reconciliation found. **It reports; it repairs nothing.**
 *
 * There is no scheduler to run it and nothing that acts on it. It is a query somebody runs, which
 * is the only honest shape while `JobPort` has no adapter (D-22).
 */
export interface ReconciliationStore {
  findings(transaction: Transaction, cycleId: string): Promise<readonly ReconciliationFinding[]>;
}

export interface PerformanceStores {
  readonly ratingScales: RatingScaleStore;
  readonly frameworks: CompetencyFrameworkStore;
  readonly goalCategories: GoalCategoryStore;
  readonly templates: TemplateStore;
  readonly goals: GoalStore;
  readonly goalProgress: GoalProgressStore;
  readonly cycles: CycleStore;
  readonly reviews: ReviewStore;
  readonly reviewers: ReviewerAssignmentStore;
  readonly assessments: AssessmentStore;
  readonly componentScores: ComponentScoreStore;
  readonly calibrationSessions: CalibrationSessionStore;
  readonly calibrationDecisions: CalibrationDecisionStore;
  readonly placements: TalentPlacementStore;
  readonly feedback: FeedbackStore;
  readonly snapshots: SnapshotStore;
  readonly reconciliation: ReconciliationStore;
}

export { documentsUnavailable } from './performance-cross-module-ports.js';
export type {
  DocumentReferencePort,
  EmploymentFacts,
  EmploymentPort,
  NotificationIntentPort,
  OrganizationPort,
} from './performance-cross-module-ports.js';
