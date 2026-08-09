import type { Transaction } from '@work/kernel';

import type { AttendanceDayState, DayExceptionState } from '../domain/attendance-day-state.js';
import type { TimeEventState } from '../domain/time-event.js';

import type { DayQuery, EventQuery, ExceptionQuery, Page } from './attendance-ports.js';

/**
 * In-memory implementations of every store, for the application and API suites.
 *
 * They exist so a calculation test, an authorization test and the idempotency tests can run in
 * milliseconds without a database — and so the *tenant* filter is exercised in those tests too
 * rather than only in the integration suites. Every read filters on `transaction.tenantId`, exactly
 * as the SQL does.
 *
 * **The event store reproduces the deduplication index**, and it raises the same SQLSTATE the driver
 * would. That is deliberate rather than fastidious: ingestion's race path branches on that error,
 * and a fake that failed differently would leave the branch untested until a punch clock found it.
 *
 * The definition stores — shifts, schedules, rotas, policies, corrections, snapshots and imports —
 * are in `in-memory-definitions.ts`, and the bundle that assembles all thirteen with them.
 *
 * They are not a substitute for the integration suites. Row-level security, the real indexes and
 * the check constraints are the database's, and only a real one can prove them.
 */

export const scoped = <TState extends { readonly tenantId: string }>(
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

export const paged = <TState>(
  matched: readonly TState[],
  bounds: { readonly limit: number; readonly offset: number },
): Page<TState> => ({
  items: matched.slice(bounds.offset, bounds.offset + bounds.limit),
  total: matched.length,
});

export const equalWhereGiven = (value: string | undefined, filter: string | undefined): boolean =>
  filter === undefined || value === filter;

export const withinDates = (
  onDate: string,
  from: string | undefined,
  to: string | undefined,
): boolean => (from === undefined || onDate >= from) && (to === undefined || onDate <= to);

export class InMemoryStore<TState extends { id: string; tenantId: string; version: number }> {
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

/** Insert and read, and nothing else — the same surface the real repository offers. */
export class InMemoryEventStore {
  public readonly rows: TimeEventState[] = [];

  public byId(transaction: Transaction, id: string): Promise<TimeEventState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.id === id));
  }

  public byKey(transaction: Transaction, eventKey: string): Promise<TimeEventState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.eventKey === eventKey));
  }

  public forDay(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<readonly TimeEventState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter(
        (row) => row.employmentId === employmentId && row.attendanceDate === attendanceDate,
      ),
    );
  }

  public search(transaction: Transaction, query: EventQuery): Promise<Page<TimeEventState>> {
    const matched = scoped(this.rows, transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.source, query.source) &&
        equalWhereGiven(row.kind, query.kind) &&
        withinDates(row.attendanceDate, query.fromDate, query.toDate),
    );

    return Promise.resolve(paged(matched, query));
  }

  /** The deduplication index, in memory — including the error the driver would raise. */
  public insert(transaction: Transaction, state: TimeEventState): Promise<void> {
    const clash = scoped(this.rows, transaction).find((row) => row.eventKey === state.eventKey);

    if (clash !== undefined) throw new UniqueViolation('attendance_time_event_key');
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export class InMemoryDayStore extends InMemoryStore<AttendanceDayState> {
  public byDate(
    transaction: Transaction,
    employmentId: string,
    attendanceDate: string,
  ): Promise<AttendanceDayState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) => row.employmentId === employmentId && row.attendanceDate === attendanceDate,
      ),
    );
  }

  public forPeriod(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly AttendanceDayState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) => row.employmentId === employmentId && withinDates(row.attendanceDate, from, to),
      ),
    );
  }

  public stale(transaction: Transaction, limit: number): Promise<readonly AttendanceDayState[]> {
    return Promise.resolve(
      // Presence of the mark, not a comparison against `calculatedAt` — the same predicate as the
      // partial index `where inputs_changed_at is not null`. A comparison would lose an input that
      // moved within the same clock tick as the calculation it invalidates.
      this.scoped(transaction)
        .filter((row) => row.inputsChangedAt !== undefined)
        .slice(0, limit),
    );
  }

  public markStale(
    _transaction: Transaction,
    scope: { readonly employmentId?: string; readonly from: string; readonly to: string },
    at: Date,
  ): Promise<number> {
    let marked = 0;

    for (const [index, row] of this.rows.entries()) {
      if (scope.employmentId !== undefined && row.employmentId !== scope.employmentId) continue;
      if (!withinDates(row.attendanceDate, scope.from, scope.to)) continue;
      this.rows.splice(index, 1, { ...row, inputsChangedAt: at });
      marked += 1;
    }
    return Promise.resolve(marked);
  }

  public search(transaction: Transaction, query: DayQuery): Promise<Page<AttendanceDayState>> {
    const matched = this.scoped(transaction)
      .filter(
        (row) =>
          equalWhereGiven(row.employmentId, query.employmentId) &&
          equalWhereGiven(row.state, query.state) &&
          equalWhereGiven(row.dayKind, query.dayKind) &&
          withinDates(row.attendanceDate, query.fromDate, query.toDate) &&
          (query.employmentIds === undefined || query.employmentIds.includes(row.employmentId)),
      )
      .sort((left, right) => left.attendanceDate.localeCompare(right.attendanceDate));

    return Promise.resolve(paged(matched, query));
  }

  /** One day per employment per date, exactly as the partial unique index enforces. */
  public override insert(transaction: Transaction, state: AttendanceDayState): Promise<void> {
    const clash = this.scoped(transaction).find(
      (row) =>
        row.employmentId === state.employmentId && row.attendanceDate === state.attendanceDate,
    );

    if (clash !== undefined) throw new UniqueViolation('attendance_day_key');
    return super.insert(transaction, state);
  }
}

export class InMemoryExceptionStore extends InMemoryStore<DayExceptionState> {
  public forDay(
    transaction: Transaction,
    attendanceDayId: string,
  ): Promise<readonly DayExceptionState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.attendanceDayId === attendanceDayId),
    );
  }

  public forDays(
    transaction: Transaction,
    attendanceDayIds: readonly string[],
  ): Promise<readonly DayExceptionState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => attendanceDayIds.includes(row.attendanceDayId)),
    );
  }

  public search(transaction: Transaction, query: ExceptionQuery): Promise<Page<DayExceptionState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.kind, query.kind) &&
        equalWhereGiven(row.severity, query.severity) &&
        equalWhereGiven(row.state, query.state) &&
        withinDates(row.attendanceDate, query.fromDate, query.toDate),
    );

    return Promise.resolve(paged(matched, query));
  }

  public countBlocking(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<number> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          row.employmentId === employmentId &&
          row.severity === 'blocking' &&
          row.state === 'open' &&
          withinDates(row.attendanceDate, from, to),
      ).length,
    );
  }

  public supersedeOpen(
    _transaction: Transaction,
    attendanceDayId: string,
    _at: Date,
  ): Promise<void> {
    for (const [index, row] of this.rows.entries()) {
      if (row.attendanceDayId !== attendanceDayId || row.state !== 'open') continue;
      this.rows.splice(index, 1, { ...row, state: 'superseded' });
    }
    return Promise.resolve();
  }
}
