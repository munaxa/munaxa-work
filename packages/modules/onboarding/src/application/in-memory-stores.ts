import type { Transaction } from '@work/kernel';

import { isOnboardingLive, isTaskSatisfied, isTaskTerminal } from '../domain/onboarding-vocabulary.js';
import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { PlanState } from '../domain/plan.js';
import type { PlanVersionState, TaskTemplateState } from '../domain/plan-version.js';
import type { TaskState } from '../domain/task-definition.js';
import type { TaskEventState } from '../domain/task-event.js';

import type {
  OnboardingQuery,
  OnboardingStore,
  OnboardingStores,
  Page,
  PlanQuery,
  PlanStore,
  TaskQuery,
  TaskStore,
  TaskTally,
} from './onboarding-ports.js';

/**
 * In-memory implementations of every store, for the application and API suites.
 *
 * They exist so a lifecycle test, an authorization test and the idempotency tests can run in
 * milliseconds without a database — and so the *tenant* filter is exercised in those tests too
 * rather than only in the integration suites. Every read filters on `transaction.tenantId`, exactly
 * as the SQL does.
 *
 * **The onboarding store reproduces the partial unique index**, and it raises the same SQLSTATE the
 * driver would. That is deliberate rather than fastidious: the start command's race path branches on
 * that error, and a fake that failed differently would leave the branch untested until production.
 *
 * They are not a substitute for the integration suites. Row-level security, the real index and the
 * check constraints are the database's, and only a real one can prove them.
 */

const scoped = <TState extends { readonly tenantId: string }>(
  rows: readonly TState[],
  transaction: Transaction,
): readonly TState[] => rows.filter((row) => row.tenantId === transaction.tenantId);

/** The error a PostgreSQL unique violation raises, so both stores fail the same way. */
export class UniqueViolation extends Error {
  public readonly code = '23505';

  public constructor(constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.name = 'UniqueViolation';
  }
}

class InMemoryStore<TState extends { id: string; tenantId: string; version: number }> {
  public readonly rows: TState[] = [];

  public byId(transaction: Transaction, id: string): Promise<TState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.id === id));
  }

  public all(transaction: Transaction): Promise<readonly TState[]> {
    return Promise.resolve(this.scoped(transaction));
  }

  public insert(_transaction: Transaction, state: TState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  public update(_transaction: Transaction, state: TState, expected: number): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === state.id);

    if (index === -1) throw new Error(`No such row ${state.id}.`);
    if (this.rows[index]?.version !== expected) {
      throw new Error(`Concurrent modification of ${state.id}.`);
    }
    this.rows.splice(index, 1, { ...state, version: expected + 1 });
    return Promise.resolve();
  }

  protected scoped(transaction: Transaction): readonly TState[] {
    return scoped(this.rows, transaction);
  }
}

const paged = <TState>(
  matched: readonly TState[],
  bounds: { readonly limit: number; readonly offset: number },
): Page<TState> => ({
  items: matched.slice(bounds.offset, bounds.offset + bounds.limit),
  total: matched.length,
});

const equalWhereGiven = (value: string | undefined, filter: string | undefined): boolean =>
  filter === undefined || value === filter;

class InMemoryPlanStore extends InMemoryStore<PlanState> implements PlanStore {
  public byCode(transaction: Transaction, code: string): Promise<PlanState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.code === code));
  }

  public search(transaction: Transaction, query: PlanQuery): Promise<Page<PlanState>> {
    const matched = this.scoped(transaction)
      .filter(
        (row) => equalWhereGiven(row.status, query.status) && equalWhereGiven(row.code, query.code),
      )
      .sort((left, right) => left.code.localeCompare(right.code));

    return Promise.resolve(paged(matched, query));
  }
}

class InMemoryPlanVersionStore extends InMemoryStore<PlanVersionState> {
  public forPlan(transaction: Transaction, planId: string): Promise<readonly PlanVersionState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.planId === planId)
        .sort((left, right) => left.versionNumber - right.versionNumber),
    );
  }

  public publishedForPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<PlanVersionState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find((row) => row.planId === planId && row.status === 'published'),
    );
  }
}

class InMemoryTemplateStore extends InMemoryStore<TaskTemplateState> {
  public forVersion(
    transaction: Transaction,
    planVersionId: string,
  ): Promise<readonly TaskTemplateState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.planVersionId === planVersionId)
        .sort((left, right) => left.sequence - right.sequence),
    );
  }

  public byCode(
    transaction: Transaction,
    planVersionId: string,
    code: string,
  ): Promise<TaskTemplateState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) => row.planVersionId === planVersionId && row.code === code,
      ),
    );
  }

  public remove(_transaction: Transaction, id: string, _expected: number): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);

    if (index !== -1) this.rows.splice(index, 1);
    return Promise.resolve();
  }
}

class InMemoryOnboardingStore
  extends InMemoryStore<OnboardingInstanceState>
  implements OnboardingStore
{
  /**
   * The task store, so `overdueAsOf` filters here the way the `exists` subquery does in SQL.
   *
   * A fake that silently ignored a filter is worse than a fake that lacks one: the test passes, the
   * screen ships, and the first honest answer arrives from a customer.
   */
  public constructor(private readonly tasks: { readonly rows: readonly TaskState[] }) {
    super();
  }

  public liveForEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<OnboardingInstanceState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) => row.employmentId === employmentId && isOnboardingLive(row.state),
      ),
    );
  }

  public employmentsWithAny(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly string[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => employmentIds.includes(row.employmentId))
        .map((row) => row.employmentId),
    );
  }

  public search(
    transaction: Transaction,
    query: OnboardingQuery,
  ): Promise<Page<OnboardingInstanceState>> {
    const matched = this.scoped(transaction)
      .filter(
        (row) =>
          equalWhereGiven(row.state, query.state) &&
          equalWhereGiven(row.planId, query.planId) &&
          equalWhereGiven(row.employmentId, query.employmentId) &&
          (query.plannedStartFrom === undefined || row.plannedStartOn >= query.plannedStartFrom) &&
          (query.plannedStartTo === undefined || row.plannedStartOn <= query.plannedStartTo) &&
          this.hasOverdueRequiredTask(transaction, row.id, query.overdueAsOf),
      )
      .sort((left, right) => left.plannedStartOn.localeCompare(right.plannedStartOn));

    return Promise.resolve(paged(matched, query));
  }

  /** The partial unique index, in memory — including the error the driver would raise. */
  public override insert(
    transaction: Transaction,
    state: OnboardingInstanceState,
  ): Promise<void> {
    const clash = this.scoped(transaction).find(
      (row) => row.employmentId === state.employmentId && isOnboardingLive(row.state),
    );

    if (clash !== undefined && isOnboardingLive(state.state)) {
      throw new UniqueViolation('onboarding_instance_live_employment_key');
    }
    return super.insert(transaction, state);
  }

  private hasOverdueRequiredTask(
    transaction: Transaction,
    onboardingId: string,
    asOf: string | undefined,
  ): boolean {
    if (asOf === undefined) return true;

    return scoped(this.tasks.rows, transaction).some(
      (task) =>
        task.onboardingId === onboardingId &&
        task.required &&
        !isTaskTerminal(task.status) &&
        task.dueOn !== undefined &&
        task.dueOn < asOf,
    );
  }
}

class InMemoryTaskStore extends InMemoryStore<TaskState> implements TaskStore {
  public forOnboarding(
    transaction: Transaction,
    onboardingId: string,
  ): Promise<readonly TaskState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.onboardingId === onboardingId)
        .sort((left, right) => left.sequence - right.sequence),
    );
  }

  public forOnboardings(
    transaction: Transaction,
    onboardingIds: readonly string[],
  ): Promise<readonly TaskState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => onboardingIds.includes(row.onboardingId)),
    );
  }

  public dependents(transaction: Transaction, taskId: string): Promise<readonly TaskState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => row.dependsOnTaskId === taskId));
  }

  public search(transaction: Transaction, query: TaskQuery): Promise<Page<TaskState>> {
    const matched = this.scoped(transaction)
      .filter((row) => matchesTask(row, query))
      .sort((left, right) => left.sequence - right.sequence);

    return Promise.resolve(paged(matched, query));
  }

  public tally(
    transaction: Transaction,
    onboardingId: string,
    asOf: string,
  ): Promise<TaskTally> {
    const tasks = this.scoped(transaction).filter((row) => row.onboardingId === onboardingId);
    const required = tasks.filter((task) => task.required);
    const optional = tasks.filter((task) => !task.required);
    const outstanding: Record<string, number> = {};

    for (const task of tasks) {
      if (isTaskTerminal(task.status)) continue;
      outstanding[task.ownerKind] = (outstanding[task.ownerKind] ?? 0) + 1;
    }
    return Promise.resolve({
      requiredTotal: required.length,
      requiredSatisfied: required.filter((task) => isTaskSatisfied(task.status)).length,
      requiredOverdue: required.filter(
        (task) => !isTaskTerminal(task.status) && task.dueOn !== undefined && task.dueOn < asOf,
      ).length,
      optionalTotal: optional.length,
      optionalSatisfied: optional.filter((task) => isTaskSatisfied(task.status)).length,
      byOwnerKindOutstanding: outstanding,
    });
  }
}

const matchesOwner = (row: TaskState, query: TaskQuery): boolean =>
  equalWhereGiven(row.ownerKind, query.ownerKind) &&
  equalWhereGiven(row.ownerRef, query.ownerRef) &&
  equalWhereGiven(row.ownerRole, query.ownerRole);

/** The same comparison the SQL makes: a date from the caller, never the machine's own today. */
const isOverdue = (row: TaskState, asOf: string | undefined): boolean =>
  asOf === undefined ||
  (!isTaskTerminal(row.status) && row.dueOn !== undefined && row.dueOn < asOf);

const matchesTask = (row: TaskState, query: TaskQuery): boolean =>
  equalWhereGiven(row.onboardingId, query.onboardingId) &&
  equalWhereGiven(row.status, query.status) &&
  equalWhereGiven(row.kind, query.kind) &&
  matchesOwner(row, query) &&
  (query.requiredOnly !== true || row.required) &&
  isOverdue(row, query.overdueAsOf);

class InMemoryTaskEventStore {
  public readonly rows: TaskEventState[] = [];

  public forTask(transaction: Transaction, taskId: string): Promise<readonly TaskEventState[]> {
    return Promise.resolve(scoped(this.rows, transaction).filter((row) => row.taskId === taskId));
  }

  public forOnboarding(
    transaction: Transaction,
    onboardingId: string,
  ): Promise<readonly TaskEventState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.onboardingId === onboardingId),
    );
  }

  public insert(_transaction: Transaction, state: TaskEventState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export interface InMemoryOnboardingStores extends OnboardingStores {
  readonly onboardings: InMemoryOnboardingStore;
  readonly tasks: InMemoryTaskStore;
}

export const inMemoryOnboardingStores = (): InMemoryOnboardingStores => {
  const tasks = new InMemoryTaskStore();

  return {
    plans: new InMemoryPlanStore(),
    planVersions: new InMemoryPlanVersionStore(),
    templates: new InMemoryTemplateStore(),
    onboardings: new InMemoryOnboardingStore(tasks),
    tasks,
    taskEvents: new InMemoryTaskEventStore(),
  };
};
