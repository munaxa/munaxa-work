import type { Transaction } from '@work/kernel';

import type { BalanceState } from '../domain/balance.js';
import type { LedgerBucket, LedgerEntryState } from '../domain/ledger.js';
import {
  InMemoryStore,
  UniqueViolation,
  equalWhereGiven,
  paged,
  scoped,
  withinDates,
} from './in-memory-support.js';
import type { BalanceQuery, LedgerQuery, Page } from './leave-ports.js';

/**
 * The ledger and the balance projection, in memory.
 *
 * Two behaviours here are load-bearing, because the module's correctness rests on them and a naive
 * fake would get both wrong:
 *
 * - the ledger's **idempotency index** on `(source_kind, source_id, kind)`, which every bounded run
 *   rests on — reproduced including the SQLSTATE the driver would raise;
 * - the balance's **stale predicate**, which tests *presence of the mark* and never a comparison
 *   against `calculatedAt`. That comparison is the Phase 8 defect, and it is not repeated here.
 */

/** Insert and read, and nothing else — the same surface the real repository offers. */
export class InMemoryLedgerStore {
  public readonly rows: LedgerEntryState[] = [];

  public byId(transaction: Transaction, id: string): Promise<LedgerEntryState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.id === id));
  }

  public forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<readonly LedgerEntryState[]> {
    return Promise.resolve(scoped(this.rows, transaction).filter((row) => inBucket(row, bucket)));
  }

  public forBucketUpTo(
    transaction: Transaction,
    bucket: LedgerBucket,
    onDate: string,
  ): Promise<readonly LedgerEntryState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter(
        (row) => inBucket(row, bucket) && row.effectiveOn <= onDate,
      ),
    );
  }

  public bySource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string; readonly kind: string },
  ): Promise<LedgerEntryState | undefined> {
    return Promise.resolve(
      scoped(this.rows, transaction).find(
        (row) =>
          row.sourceKind === source.sourceKind &&
          row.sourceId === source.sourceId &&
          row.kind === source.kind,
      ),
    );
  }

  public forSource(
    transaction: Transaction,
    source: { readonly sourceKind: string; readonly sourceId: string },
  ): Promise<readonly LedgerEntryState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter(
        (row) => row.sourceKind === source.sourceKind && row.sourceId === source.sourceId,
      ),
    );
  }

  public search(transaction: Transaction, query: LedgerQuery): Promise<Page<LedgerEntryState>> {
    const matched = scoped(this.rows, transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.leaveTypeId, query.leaveTypeId) &&
        equalWhereGiven(row.leaveYearStart, query.leaveYearStart) &&
        equalWhereGiven(row.kind, query.kind) &&
        withinDates(row.effectiveOn, query.fromDate, query.toDate),
    );

    return Promise.resolve(paged(matched, query));
  }

  /** The idempotency index, in memory — including the error the driver would raise. */
  public insert(transaction: Transaction, state: LedgerEntryState): Promise<void> {
    const clash = scoped(this.rows, transaction).find(
      (row) =>
        row.sourceKind === state.sourceKind &&
        row.sourceId === state.sourceId &&
        row.kind === state.kind,
    );

    if (clash !== undefined) throw new UniqueViolation('leave_ledger_source_key');

    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

const inBucket = (row: LedgerEntryState, bucket: LedgerBucket): boolean =>
  row.employmentId === bucket.employmentId &&
  row.leaveTypeId === bucket.leaveTypeId &&
  row.leaveYearStart === bucket.leaveYearStart;

export class InMemoryBalanceStore extends InMemoryStore<BalanceState> {
  public forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<BalanceState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) =>
          row.employmentId === bucket.employmentId &&
          row.leaveTypeId === bucket.leaveTypeId &&
          row.leaveYearStart === bucket.leaveYearStart,
      ),
    );
  }

  public forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly BalanceState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.employmentId === employmentId),
    );
  }

  /**
   * **Presence of the mark, not a comparison against `calculatedAt`** — the same predicate as the
   * partial index `where inputs_changed_at is not null`. A comparison would lose an entry that
   * moved within the same clock tick as the calculation it invalidates.
   */
  public stale(transaction: Transaction, limit: number): Promise<readonly BalanceState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.inputsChangedAt !== undefined)
        .slice(0, limit),
    );
  }

  public markStale(
    transaction: Transaction,
    scope: { readonly employmentId?: string; readonly leaveTypeId?: string },
    at: Date,
  ): Promise<number> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, scope.employmentId) &&
        equalWhereGiven(row.leaveTypeId, scope.leaveTypeId),
    );

    for (const row of matched) {
      const index = this.rows.findIndex((one) => one.id === row.id);

      this.rows.splice(index, 1, { ...row, inputsChangedAt: at });
    }
    return Promise.resolve(matched.length);
  }

  public search(transaction: Transaction, query: BalanceQuery): Promise<Page<BalanceState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.leaveTypeId, query.leaveTypeId) &&
        equalWhereGiven(row.leaveYearStart, query.leaveYearStart),
    );

    return Promise.resolve(paged(matched, query));
  }
}
