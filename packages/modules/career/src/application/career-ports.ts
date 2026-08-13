import type { Transaction } from '@work/kernel';

import type { DevelopmentItemState, DevelopmentPlanState } from '../domain/development.js';
import type { MobilityRecommendationState } from '../domain/mobility.js';
import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { CareerPlanState } from '../domain/plan.js';
import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type { ReadinessAssessmentState, ReadinessLevelState } from '../domain/readiness.js';
import type { SuccessionPlanState, SuccessorState } from '../domain/succession.js';

/**
 * The persistence this module needs, as interfaces the domain never sees.
 *
 * **`ReadinessAssessmentStore` is deliberately narrower than the rest**: it offers inserts and reads
 * and **no update, no remove**. An assessment is a record of what one person said about another on
 * one day, and the cheapest guarantee that nobody rewrote one is to have no method that could. The
 * database refuses it too, with a trigger (D-14); this is the same rule expressed where a developer
 * meets it first. A correction is a new assessment.
 *
 * **`insertIfAbsent` is not a convenience.** It is the shape that makes a retried nomination or a
 * retried pool assignment converge under concurrency: it maps to `insert ... on conflict do nothing`
 * against the partial unique indexes Checkpoint 3 created, and returns whether a row was written, so
 * the *database index* decides and not a read-then-write check that two managers pressing the button
 * at the same moment would both pass. This is the specification's "Duplicate Successor Assignments"
 * validation, and §15 places it here rather than in a pre-check for exactly that reason.
 *
 * **Where uniqueness is the database's, the store returns `false` rather than throwing.** The
 * handler maps that to the row that already exists with `created: false`, which is convergence
 * rather than an error — a retry that reported a conflict would make a lost response indistinguish-
 * able from a duplicate act.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound. There is no unbounded query in this module.
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
// Paths and stages
// ------------------------------------------------------------------------------------------------

export interface PathFilters {
  readonly status?: string;
  readonly kind?: string;
}

export interface PathStore {
  byId(transaction: Transaction, id: string): Promise<CareerPathState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CareerPathState | undefined>;
  search(
    transaction: Transaction,
    filters: PathFilters,
    paged: Paged,
  ): Promise<Page<CareerPathState>>;
  stagesFor(transaction: Transaction, pathId: string): Promise<readonly CareerStageState[]>;
  /** How many stages a path has, counted by the database — never by the length of a page. */
  stageCountOf(transaction: Transaction, pathId: string): Promise<number>;
  insert(transaction: Transaction, state: CareerPathState): Promise<void>;
  /**
   * Optimistic. `expected` is the version the caller read; a mismatch is the refusal that settles
   * two administrators publishing the same path at the same moment.
   */
  update(transaction: Transaction, state: CareerPathState, expected: number): Promise<void>;
  insertStage(transaction: Transaction, state: CareerStageState): Promise<void>;
  stageById(transaction: Transaction, id: string): Promise<CareerStageState | undefined>;
}

// ------------------------------------------------------------------------------------------------
// Career plans
// ------------------------------------------------------------------------------------------------

export interface PlanFilters {
  readonly employmentId?: string;
  readonly pathId?: string;
  readonly status?: string;
  /** Restricts to these employments. How a bounded scope is applied, never a client-supplied list. */
  readonly employmentIdsIn?: readonly string[];
}

export interface PlanStore {
  byId(transaction: Transaction, id: string): Promise<CareerPlanState | undefined>;
  search(
    transaction: Transaction,
    filters: PlanFilters,
    paged: Paged,
  ): Promise<Page<CareerPlanState>>;
  /** The active plan for this employment, where there is one. */
  activeFor(transaction: Transaction, employmentId: string): Promise<CareerPlanState | undefined>;
  /** Refused by the partial unique index where an active plan already exists. */
  insertIfAbsent(transaction: Transaction, state: CareerPlanState): Promise<boolean>;
  update(transaction: Transaction, state: CareerPlanState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Talent pools
// ------------------------------------------------------------------------------------------------

export interface PoolStore {
  byId(transaction: Transaction, id: string): Promise<TalentPoolState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<TalentPoolState | undefined>;
  all(
    transaction: Transaction,
    status: string | undefined,
    paged: Paged,
  ): Promise<Page<TalentPoolState>>;
  insert(transaction: Transaction, state: TalentPoolState): Promise<void>;
  update(transaction: Transaction, state: TalentPoolState, expected: number): Promise<void>;
}

export interface MembershipFilters {
  readonly talentPoolId?: string;
  readonly employmentId?: string;
  /** Only memberships in force on this civil day. Both ends inclusive — how an as-of read is bounded. */
  readonly inForceOn?: string;
  readonly openOnly?: boolean;
  readonly employmentIdsIn?: readonly string[];
}

export interface MembershipStore {
  byId(transaction: Transaction, id: string): Promise<PoolMembershipState | undefined>;
  search(
    transaction: Transaction,
    filters: MembershipFilters,
    paged: Paged,
  ): Promise<Page<PoolMembershipState>>;
  openFor(
    transaction: Transaction,
    talentPoolId: string,
    employmentId: string,
  ): Promise<PoolMembershipState | undefined>;
  /** Refused by the partial unique index where an open membership already exists. */
  insertIfAbsent(transaction: Transaction, state: PoolMembershipState): Promise<boolean>;
  update(transaction: Transaction, state: PoolMembershipState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Succession
// ------------------------------------------------------------------------------------------------

export interface SuccessionFilters {
  readonly positionId?: string;
  readonly status?: string;
  /** Active plans whose review day is on or before this civil date. How "reviews due" is bounded. */
  readonly reviewOnOrBefore?: string;
}

export interface SuccessionPlanStore {
  byId(transaction: Transaction, id: string): Promise<SuccessionPlanState | undefined>;
  search(
    transaction: Transaction,
    filters: SuccessionFilters,
    paged: Paged,
  ): Promise<Page<SuccessionPlanState>>;
  activeFor(transaction: Transaction, positionId: string): Promise<SuccessionPlanState | undefined>;
  /** Refused by the partial unique index where an active plan already exists for the position. */
  insertIfAbsent(transaction: Transaction, state: SuccessionPlanState): Promise<boolean>;
  update(transaction: Transaction, state: SuccessionPlanState, expected: number): Promise<void>;
}

export interface SuccessorFilters {
  readonly successionPlanId?: string;
  readonly employmentId?: string;
  readonly status?: string;
  readonly employmentIdsIn?: readonly string[];
}

/** How many people stand at each status on a bench, counted by the database. */
export interface BenchCounts {
  readonly nominated: number;
  readonly confirmed: number;
}

export interface SuccessorStore {
  byId(transaction: Transaction, id: string): Promise<SuccessorState | undefined>;
  search(
    transaction: Transaction,
    filters: SuccessorFilters,
    paged: Paged,
  ): Promise<Page<SuccessorState>>;
  forPlan(transaction: Transaction, successionPlanId: string): Promise<readonly SuccessorState[]>;
  openFor(
    transaction: Transaction,
    successionPlanId: string,
    employmentId: string,
  ): Promise<SuccessorState | undefined>;
  /**
   * The bench, counted rather than listed.
   *
   * Separate from `forPlan` deliberately: a count taken from a page of rows is the size of the page,
   * and "this director has three successors" computed that way would be wrong the moment there were
   * more than a page of them.
   */
  benchCountsOf(transaction: Transaction, successionPlanId: string): Promise<BenchCounts>;
  /** Refused by the partial unique index where an open nomination already exists. */
  insertIfAbsent(transaction: Transaction, state: SuccessorState): Promise<boolean>;
  update(transaction: Transaction, state: SuccessorState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Readiness
// ------------------------------------------------------------------------------------------------

export interface ReadinessLevelStore {
  byId(transaction: Transaction, id: string): Promise<ReadinessLevelState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<ReadinessLevelState | undefined>;
  byOrdinal(transaction: Transaction, ordinal: number): Promise<ReadinessLevelState | undefined>;
  all(transaction: Transaction, activeOnly: boolean): Promise<readonly ReadinessLevelState[]>;
  insert(transaction: Transaction, state: ReadinessLevelState): Promise<void>;
  update(transaction: Transaction, state: ReadinessLevelState, expected: number): Promise<void>;
}

export interface AssessmentFilters {
  readonly employmentId?: string;
  readonly successionPlanId?: string;
  readonly positionId?: string;
  readonly readinessLevelId?: string;
  readonly employmentIdsIn?: readonly string[];
}

/**
 * Insert and read. **No update and no remove** (D-14).
 *
 * What one person said about another on one day is a thing that happened. A correction is a new
 * assessment, so the trail shows what was thought and when it changed — which is the question a
 * succession review asks and the one an edited row could not answer.
 */
export interface ReadinessAssessmentStore {
  byId(transaction: Transaction, id: string): Promise<ReadinessAssessmentState | undefined>;
  search(
    transaction: Transaction,
    filters: AssessmentFilters,
    paged: Paged,
  ): Promise<Page<ReadinessAssessmentState>>;
  /** Every assessment about one employment, most recent first. The history, whole. */
  historyFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly ReadinessAssessmentState[]>;
  insert(transaction: Transaction, state: ReadinessAssessmentState): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Development
// ------------------------------------------------------------------------------------------------

export interface DevelopmentPlanFilters {
  readonly employmentId?: string;
  readonly status?: string;
  readonly careerPlanId?: string;
  readonly employmentIdsIn?: readonly string[];
}

export interface DevelopmentPlanStore {
  byId(transaction: Transaction, id: string): Promise<DevelopmentPlanState | undefined>;
  search(
    transaction: Transaction,
    filters: DevelopmentPlanFilters,
    paged: Paged,
  ): Promise<Page<DevelopmentPlanState>>;
  activeFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<DevelopmentPlanState | undefined>;
  insert(transaction: Transaction, state: DevelopmentPlanState): Promise<void>;
  update(transaction: Transaction, state: DevelopmentPlanState, expected: number): Promise<void>;
}

export interface DevelopmentItemFilters {
  readonly developmentPlanId?: string;
  readonly category?: string;
  readonly status?: string;
  /** Items due on or before this civil date. How the "what is coming up" queue is bounded. */
  readonly targetOnOrBefore?: string;
}

export interface DevelopmentItemStore {
  byId(transaction: Transaction, id: string): Promise<DevelopmentItemState | undefined>;
  search(
    transaction: Transaction,
    filters: DevelopmentItemFilters,
    paged: Paged,
  ): Promise<Page<DevelopmentItemState>>;
  forPlan(
    transaction: Transaction,
    developmentPlanId: string,
  ): Promise<readonly DevelopmentItemState[]>;
  itemCountOf(transaction: Transaction, developmentPlanId: string): Promise<number>;
  insert(transaction: Transaction, state: DevelopmentItemState): Promise<void>;
  update(transaction: Transaction, state: DevelopmentItemState, expected: number): Promise<void>;
}

// ------------------------------------------------------------------------------------------------
// Mobility
// ------------------------------------------------------------------------------------------------

export interface MobilityFilters {
  readonly employmentId?: string;
  readonly status?: string;
  readonly kind?: string;
  readonly employmentIdsIn?: readonly string[];
}

export interface MobilityStore {
  byId(transaction: Transaction, id: string): Promise<MobilityRecommendationState | undefined>;
  search(
    transaction: Transaction,
    filters: MobilityFilters,
    paged: Paged,
  ): Promise<Page<MobilityRecommendationState>>;
  openFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly MobilityRecommendationState[]>;
  insert(transaction: Transaction, state: MobilityRecommendationState): Promise<void>;
  update(
    transaction: Transaction,
    state: MobilityRecommendationState,
    expected: number,
  ): Promise<void>;
}

export interface CareerStores {
  readonly paths: PathStore;
  readonly plans: PlanStore;
  readonly pools: PoolStore;
  readonly memberships: MembershipStore;
  readonly successionPlans: SuccessionPlanStore;
  readonly successors: SuccessorStore;
  readonly readinessLevels: ReadinessLevelStore;
  readonly assessments: ReadinessAssessmentStore;
  readonly developmentPlans: DevelopmentPlanStore;
  readonly developmentItems: DevelopmentItemStore;
  readonly mobility: MobilityStore;
}

export type {
  EmploymentFacts,
  EmploymentPort,
  LearningPort,
  OrganizationPort,
  Workforce,
} from './career-cross-module-ports.js';
