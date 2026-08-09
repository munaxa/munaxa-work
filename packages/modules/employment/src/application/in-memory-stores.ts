import type { Transaction } from '@work/kernel';

import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';
import type { EmploymentContractState } from '../domain/employment-contract.js';
import type { EmploymentState } from '../domain/employment.js';
import type { ReportingLineState } from '../domain/reporting-line.js';
import type { StatusRecordState } from '../domain/status-record.js';

import type {
  AssignmentStore,
  ChildStore,
  EmploymentQuery,
  EmploymentStore,
  EmploymentStores,
  NumberSequenceStore,
  Page,
  StatusRecordStore,
} from './employment-ports.js';

/**
 * In-memory implementations of every store, for the application and API suites.
 *
 * They exist so a status-machine test, an authorization test and a timeline test can run in
 * milliseconds without a database — and so that the *tenant* filter is exercised in those tests
 * too rather than only in the integration suites. Every read here filters on
 * `transaction.tenantId`, exactly as the SQL does, so a use case that forgot to scope something
 * fails here as well as against PostgreSQL.
 *
 * They are not a substitute for the integration suites. Row-level security, the partial unique
 * indexes and the check constraints are the database's, and only a real one can prove them.
 */

const scoped = <TState extends { readonly tenantId: string }>(
  rows: readonly TState[],
  transaction: Transaction,
): readonly TState[] => rows.filter((row) => row.tenantId === transaction.tenantId);

class InMemoryEmploymentStore implements EmploymentStore {
  public readonly rows: EmploymentState[] = [];

  public byId(transaction: Transaction, id: string): Promise<EmploymentState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.id === id));
  }

  public byNumber(
    transaction: Transaction,
    employmentNumber: string,
  ): Promise<EmploymentState | undefined> {
    return Promise.resolve(
      scoped(this.rows, transaction).find(
        (row) => row.employmentNumber.toLowerCase() === employmentNumber.toLowerCase(),
      ),
    );
  }

  public byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly EmploymentState[]> {
    return Promise.resolve(scoped(this.rows, transaction).filter((row) => ids.includes(row.id)));
  }

  public forPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<readonly EmploymentState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction)
        .filter((row) => row.personId === personId)
        .sort((left, right) => right.startDate.localeCompare(left.startDate)),
    );
  }

  public openForPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<EmploymentState | undefined> {
    return Promise.resolve(
      scoped(this.rows, transaction).find(
        (row) => row.personId === personId && row.status !== 'ended',
      ),
    );
  }

  public search(transaction: Transaction, query: EmploymentQuery): Promise<Page<EmploymentState>> {
    const matched = scoped(this.rows, transaction)
      .filter((row) => matches(row, query))
      .sort((left, right) => left.employmentNumber.localeCompare(right.employmentNumber));

    return Promise.resolve({
      items: matched.slice(query.offset, query.offset + query.limit),
      total: matched.length,
    });
  }

  public all(transaction: Transaction): Promise<readonly EmploymentState[]> {
    return Promise.resolve(scoped(this.rows, transaction));
  }

  public insert(_transaction: Transaction, state: EmploymentState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  public update(
    _transaction: Transaction,
    state: EmploymentState,
    expected: number,
  ): Promise<void> {
    return replace(this.rows, state, expected);
  }
}

/**
 * The filters the in-memory store answers.
 *
 * Deliberately fewer than the SQL: the organizational filters are subqueries against the
 * assignment timeline, and reimplementing them here would be a second, subtly different search
 * that tests would pass against and production would not. Those are covered by the integration
 * suite, against the real query.
 */
const matches = (row: EmploymentState, query: EmploymentQuery): boolean =>
  equalWhereGiven(row.status, query.status) &&
  equalWhereGiven(row.personId, query.personId) &&
  equalWhereGiven(row.employmentTypeCode, query.employmentTypeCode) &&
  matchesTerm(row, query.term);

const equalWhereGiven = (value: string, filter: string | undefined): boolean =>
  filter === undefined || value === filter;

const matchesTerm = (row: EmploymentState, term: string | undefined): boolean => {
  if (term === undefined) return true;

  const needle = term.toLowerCase();

  return (
    row.employmentNumber.toLowerCase().includes(needle) ||
    (row.externalEmployeeNumber?.toLowerCase().includes(needle) ?? false)
  );
};

/**
 * Optimistic concurrency, in memory: the same refusal the SQL update makes.
 *
 * It replaces the row by splicing rather than assigning into the array's index, because the lint
 * layer forbids writing through a parameter — and the rule is right: a helper that mutates its
 * argument in place is the one whose effect a caller does not see.
 */
const replace = <TState extends { readonly id: string; readonly version: number }>(
  rows: TState[],
  state: TState,
  expected: number,
): Promise<void> => {
  const index = rows.findIndex((row) => row.id === state.id);

  if (index === -1) throw new Error(`No such row ${state.id}.`);
  if (rows[index]?.version !== expected) {
    throw new Error(`Concurrent modification of ${state.id}.`);
  }
  rows.splice(index, 1, { ...state, version: expected + 1 });
  return Promise.resolve();
};

class InMemoryChildStore<
  TState extends {
    readonly id: string;
    readonly tenantId: string;
    readonly employmentId: string;
    readonly version: number;
  },
> implements ChildStore<TState> {
  public readonly rows: TState[] = [];

  public byId(transaction: Transaction, id: string): Promise<TState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.id === id));
  }

  public forEmployment(transaction: Transaction, employmentId: string): Promise<readonly TState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.employmentId === employmentId),
    );
  }

  public forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly TState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => employmentIds.includes(row.employmentId)),
    );
  }

  public all(transaction: Transaction): Promise<readonly TState[]> {
    return Promise.resolve(scoped(this.rows, transaction));
  }

  public insert(_transaction: Transaction, state: TState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  public update(_transaction: Transaction, state: TState, expected: number): Promise<void> {
    return replace(this.rows, state, expected);
  }
}

class InMemoryAssignmentStore
  extends InMemoryChildStore<EmploymentAssignmentState>
  implements AssignmentStore
{
  public countInForce(
    transaction: Transaction,
    positionId: string,
    unitId: string,
    asOf: Date,
  ): Promise<number> {
    const count = scoped(this.rows, transaction).filter(
      (row) =>
        row.positionId === positionId &&
        row.unitId === unitId &&
        row.effectiveFrom.getTime() <= asOf.getTime() &&
        (row.effectiveTo === undefined || row.effectiveTo.getTime() > asOf.getTime()),
    ).length;

    return Promise.resolve(count);
  }
}

class InMemoryStatusRecordStore implements StatusRecordStore {
  public readonly rows: StatusRecordState[] = [];

  public forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly StatusRecordState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.employmentId === employmentId),
    );
  }

  public forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly StatusRecordState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => employmentIds.includes(row.employmentId)),
    );
  }

  public insert(_transaction: Transaction, state: StatusRecordState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

/** One counter per tenant per series, exactly as the table is. */
class InMemoryNumberSequence implements NumberSequenceStore {
  private readonly counters = new Map<string, number>();

  public allocate(transaction: Transaction, seriesKey: string): Promise<number> {
    const key = `${transaction.tenantId}:${seriesKey}`;
    const next = this.counters.get(key) ?? 1;

    this.counters.set(key, next + 1);
    return Promise.resolve(next);
  }
}

export interface InMemoryEmploymentStores extends EmploymentStores {
  readonly employments: InMemoryEmploymentStore;
  readonly assignments: InMemoryAssignmentStore;
  readonly reportingLines: InMemoryChildStore<ReportingLineState>;
  readonly contracts: InMemoryChildStore<EmploymentContractState>;
  readonly statusHistory: InMemoryStatusRecordStore;
}

export const inMemoryEmploymentStores = (): InMemoryEmploymentStores => ({
  employments: new InMemoryEmploymentStore(),
  assignments: new InMemoryAssignmentStore(),
  reportingLines: new InMemoryChildStore<ReportingLineState>(),
  contracts: new InMemoryChildStore<EmploymentContractState>(),
  statusHistory: new InMemoryStatusRecordStore(),
  numbers: new InMemoryNumberSequence(),
});
