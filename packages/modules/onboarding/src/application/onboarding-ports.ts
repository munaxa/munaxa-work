import type { Transaction } from '@work/kernel';

import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { PlanState } from '../domain/plan.js';
import type { PlanVersionState, TaskTemplateState } from '../domain/plan-version.js';
import type { TaskState } from '../domain/task-definition.js';
import type { TaskEventState } from '../domain/task-event.js';

/**
 * What the application layer needs from persistence and from the modules Onboarding depends on,
 * stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Every persistence method takes the `Transaction`, so a use case cannot
 * accidentally read outside the unit of work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface PlanQuery extends Paged {
  readonly status?: string;
  readonly code?: string;
}

export interface PlanStore {
  byId(transaction: Transaction, id: string): Promise<PlanState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<PlanState | undefined>;
  search(transaction: Transaction, query: PlanQuery): Promise<Page<PlanState>>;
  all(transaction: Transaction): Promise<readonly PlanState[]>;
  insert(transaction: Transaction, state: PlanState): Promise<void>;
  update(transaction: Transaction, state: PlanState, expected: number): Promise<void>;
}

export interface PlanVersionStore {
  byId(transaction: Transaction, id: string): Promise<PlanVersionState | undefined>;
  forPlan(transaction: Transaction, planId: string): Promise<readonly PlanVersionState[]>;
  /** The version an onboarding is generated from: the highest published one, or nothing. */
  publishedForPlan(transaction: Transaction, planId: string): Promise<PlanVersionState | undefined>;
  insert(transaction: Transaction, state: PlanVersionState): Promise<void>;
  update(transaction: Transaction, state: PlanVersionState, expected: number): Promise<void>;
}

/** Templates are replaced wholesale on a draft version and frozen on a published one. */
export interface TaskTemplateStore {
  forVersion(
    transaction: Transaction,
    planVersionId: string,
  ): Promise<readonly TaskTemplateState[]>;
  byCode(
    transaction: Transaction,
    planVersionId: string,
    code: string,
  ): Promise<TaskTemplateState | undefined>;
  insert(transaction: Transaction, state: TaskTemplateState): Promise<void>;
  remove(transaction: Transaction, id: string, expected: number): Promise<void>;
}

export interface OnboardingQuery extends Paged {
  readonly state?: string;
  readonly planId?: string;
  readonly employmentId?: string;
  /**
   * Instances with at least one required task due before this civil date and not concluded.
   *
   * A date rather than a flag, and supplied by the handler from the injected clock rather than read
   * from the database's `current_date`: "overdue" must mean the same day to the store, to the
   * in-memory fake and to the test that asserts on it, and a store that reached for the server's own
   * idea of today would be untestable and would disagree with the task query beside it.
   */
  readonly overdueAsOf?: string;
  readonly plannedStartFrom?: string;
  readonly plannedStartTo?: string;
}

export interface OnboardingStore {
  byId(transaction: Transaction, id: string): Promise<OnboardingInstanceState | undefined>;
  /**
   * The live onboarding for an employment, if there is one.
   *
   * The read the idempotent start makes before it writes, and the same predicate the partial unique
   * index is built on — so the check the application makes and the constraint the database enforces
   * cannot disagree about what "live" means.
   */
  liveForEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<OnboardingInstanceState | undefined>;
  /** Which of these employments already have an onboarding. The reconciliation read. */
  employmentsWithAny(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly string[]>;
  search(transaction: Transaction, query: OnboardingQuery): Promise<Page<OnboardingInstanceState>>;
  all(transaction: Transaction): Promise<readonly OnboardingInstanceState[]>;
  insert(transaction: Transaction, state: OnboardingInstanceState): Promise<void>;
  update(transaction: Transaction, state: OnboardingInstanceState, expected: number): Promise<void>;
}

export interface TaskQuery extends Paged {
  readonly onboardingId?: string;
  readonly ownerKind?: string;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly status?: string;
  readonly kind?: string;
  /** `dueOn < asOf` and the task has not concluded. Computed, never a stored flag. */
  readonly overdueAsOf?: string;
  readonly requiredOnly?: boolean;
}

/** Counts per status for one onboarding, so progress is an aggregate rather than a page of rows. */
export interface TaskTally {
  readonly requiredTotal: number;
  readonly requiredSatisfied: number;
  readonly requiredOverdue: number;
  readonly optionalTotal: number;
  readonly optionalSatisfied: number;
  readonly byOwnerKindOutstanding: Readonly<Record<string, number>>;
}

export interface TaskStore {
  byId(transaction: Transaction, id: string): Promise<TaskState | undefined>;
  forOnboarding(transaction: Transaction, onboardingId: string): Promise<readonly TaskState[]>;
  forOnboardings(
    transaction: Transaction,
    onboardingIds: readonly string[],
  ): Promise<readonly TaskState[]>;
  dependents(transaction: Transaction, taskId: string): Promise<readonly TaskState[]>;
  search(transaction: Transaction, query: TaskQuery): Promise<Page<TaskState>>;
  tally(transaction: Transaction, onboardingId: string, asOf: string): Promise<TaskTally>;
  all(transaction: Transaction): Promise<readonly TaskState[]>;
  insert(transaction: Transaction, state: TaskState): Promise<void>;
  update(transaction: Transaction, state: TaskState, expected: number): Promise<void>;
}

/** Task history is appended, never updated — so the store offers no update. */
export interface TaskEventStore {
  forTask(transaction: Transaction, taskId: string): Promise<readonly TaskEventState[]>;
  forOnboarding(transaction: Transaction, onboardingId: string): Promise<readonly TaskEventState[]>;
  insert(transaction: Transaction, state: TaskEventState): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface OnboardingStores {
  readonly plans: PlanStore;
  readonly planVersions: PlanVersionStore;
  readonly templates: TaskTemplateStore;
  readonly onboardings: OnboardingStore;
  readonly tasks: TaskStore;
  readonly taskEvents: TaskEventStore;
}

/**
 * What Onboarding needs of Employment, and nothing more.
 *
 * A port rather than a query, because Employment owns the employment and this module may not read
 * its tables. **Every method here runs under a bounded service grant** (ADR-0043): the HR user is
 * authorized for the *onboarding* operation, and the module — not the user — holds the narrow
 * Employment read permission the check needs. That is what keeps broad Employment and People
 * permissions off every HR administrator's role.
 *
 * Note what is *not* here: no `create`. Recruitment's hire creates the employment (ADR-0046), and
 * Onboarding could not create one even if it tried — the instance's foreign key would refuse a row
 * pointing at an employment that does not exist.
 */
export interface EmploymentForOnboarding {
  readonly employmentId: string;
  readonly personId: string;
  readonly status: string;
  readonly startDate: string;
  /** The manager on the reporting line in force. Absent when nobody is recorded. */
  readonly managerEmploymentId?: string;
}

export interface EmploymentDirectoryPort {
  find(employmentId: string): Promise<EmploymentForOnboarding | undefined>;
  /**
   * Employments that could need onboarding, newest first, bounded.
   *
   * The authoritative half of reconciliation: Onboarding cannot join to Employment's tables, so it
   * asks Employment for a bounded page of live employments and removes the ones it already has an
   * instance for. Deterministic, tenant-scoped, and it creates nothing by being run.
   */
  liveEmployments(limit: number): Promise<readonly EmploymentForOnboarding[]>;
}

/**
 * What Onboarding needs of People: that a person is real, in this tenant, and not merged away.
 *
 * Existence only — never their name, never an identifier. A task queue shows an employment
 * identifier; resolving it to a human being is People's read, behind People's permission (§29).
 */
export interface PersonForOnboarding {
  readonly personId: string;
  readonly status: string;
  readonly mergedIntoPersonId?: string;
}

export interface PeopleDirectoryPort {
  find(personId: string): Promise<PersonForOnboarding | undefined>;
}

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
