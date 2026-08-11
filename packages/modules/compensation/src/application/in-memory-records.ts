import type { Transaction } from '@work/kernel';

import { overlaps, type RecurringState } from '../domain/recurring.js';
import { payableWithin, type OneTimeState } from '../domain/one-time.js';
import { inForceOn } from '../domain/recurring.js';
import {
  ExclusionViolation,
  InMemoryStore,
  UniqueViolation,
  equalWhereGiven,
  paged,
  scoped,
  withinDates,
} from './in-memory-support.js';
import type { AdjustmentState } from '../domain/adjustment.js';
import type { ApprovalDecisionState } from '../domain/approval.js';
import type { CompensationChangeState } from '../domain/change-log.js';
import type {
  AdjustmentQuery,
  ChangeQuery,
  OneTimeQuery,
  Page,
  Paged,
  PeriodQuery,
  RecurringQuery,
} from './compensation-ports.js';

/**
 * The four stores whose behaviour is load-bearing: the authoritative recurring records, the
 * one-time items, the approval decisions and the append-only history.
 *
 * Two behaviours here are reproduced deliberately rather than approximated.
 *
 * **The overlap exclusion**, including the SQLSTATE. Every write path in this module branches on
 * `23P01`, and a fake that simply refused would leave that branch untested.
 *
 * **The append-only guarantee.** `InMemoryDecisionStore` and `InMemoryChangeStore` offer `insert`
 * and reads and nothing else — the same surface as the real repositories, so a use case that tried
 * to rewrite an approval would not compile against either.
 */

export class InMemoryRecurringStore extends InMemoryStore<RecurringState> {
  public forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly RecurringState[]> {
    return Promise.resolve(
      [...this.scoped(transaction).filter((row) => row.employmentId === employmentId)].sort(
        (left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom),
      ),
    );
  }

  public forComponent(
    transaction: Transaction,
    employmentId: string,
    componentId: string,
  ): Promise<readonly RecurringState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) => row.employmentId === employmentId && row.componentId === componentId,
      ),
    );
  }

  public inForceOn(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<readonly RecurringState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) => row.employmentId === employmentId && inForceOn(row, onDate),
      ),
    );
  }

  public overlappingPeriod(
    transaction: Transaction,
    query: PeriodQuery,
  ): Promise<readonly RecurringState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          query.employmentIds.includes(row.employmentId) &&
          row.effectiveFrom <= query.periodEnd &&
          (row.effectiveTo === undefined || row.effectiveTo > query.periodStart),
      ),
    );
  }

  public recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly RecurringState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter(
          (row) =>
            row.recordedAt > recordedAfter &&
            row.effectiveFrom <= period.to &&
            (row.effectiveTo === undefined || row.effectiveTo > period.from),
        )
        .slice(0, limit),
    );
  }

  public bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<RecurringState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) =>
          row.source === source.source &&
          row.sourceId === source.sourceId &&
          row.componentId === source.componentId &&
          row.employmentId === source.employmentId,
      ),
    );
  }

  public search(transaction: Transaction, query: RecurringQuery): Promise<Page<RecurringState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.componentId, query.componentId) &&
        (query.effectiveOn === undefined || inForceOn(row, query.effectiveOn)),
    );

    return Promise.resolve(paged(matched, query));
  }

  /** The exclusion constraint and the import idempotency index, in memory. */
  public override insert(transaction: Transaction, state: RecurringState): Promise<void> {
    const mine = scoped(this.rows, transaction).filter(
      (row) => row.employmentId === state.employmentId && row.componentId === state.componentId,
    );

    if (mine.some((row) => overlaps(row, state))) {
      throw new ExclusionViolation('compensation_recurring_overlap');
    }
    if (
      state.sourceId !== undefined &&
      mine.some((row) => row.source === state.source && row.sourceId === state.sourceId)
    ) {
      throw new UniqueViolation('compensation_recurring_source_key');
    }
    return super.insert(transaction, state);
  }
}

export class InMemoryOneTimeStore extends InMemoryStore<OneTimeState> {
  public payableWithin(
    transaction: Transaction,
    query: PeriodQuery,
  ): Promise<readonly OneTimeState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          query.employmentIds.includes(row.employmentId) &&
          payableWithin(row, { from: query.periodStart, to: query.periodEnd }),
      ),
    );
  }

  public recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly OneTimeState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter(
          (row) =>
            row.recordedAt > recordedAfter && withinDates(row.payableOn, period.from, period.to),
        )
        .slice(0, limit),
    );
  }

  public bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<OneTimeState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) =>
          row.source === source.source &&
          row.sourceId === source.sourceId &&
          row.componentId === source.componentId &&
          row.employmentId === source.employmentId,
      ),
    );
  }

  public search(transaction: Transaction, query: OneTimeQuery): Promise<Page<OneTimeState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.componentId, query.componentId) &&
        withinDates(row.payableOn, query.fromDate, query.toDate),
    );

    return Promise.resolve(paged(matched, query));
  }

  public override insert(transaction: Transaction, state: OneTimeState): Promise<void> {
    if (
      state.sourceId !== undefined &&
      scoped(this.rows, transaction).some(
        (row) =>
          row.source === state.source &&
          row.sourceId === state.sourceId &&
          row.componentId === state.componentId &&
          row.employmentId === state.employmentId,
      )
    ) {
      throw new UniqueViolation('compensation_one_time_source_key');
    }
    return super.insert(transaction, state);
  }
}

export class InMemoryAdjustmentStore extends InMemoryStore<AdjustmentState> {
  public search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.componentId, query.componentId),
    );

    return Promise.resolve(paged(matched, query));
  }
}

/** Insert and read, and nothing else — the same surface the real repository offers. */
export class InMemoryDecisionStore {
  public readonly rows: ApprovalDecisionState[] = [];

  public forSubject(
    transaction: Transaction,
    subjectKind: string,
    subjectId: string,
  ): Promise<readonly ApprovalDecisionState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter(
        (row) => row.subjectKind === subjectKind && row.subjectId === subjectId,
      ),
    );
  }

  public byId(transaction: Transaction, id: string): Promise<ApprovalDecisionState | undefined> {
    return Promise.resolve(scoped(this.rows, transaction).find((row) => row.id === id));
  }

  public pendingCount(_transaction: Transaction): Promise<number> {
    return Promise.resolve(0);
  }

  public insert(_transaction: Transaction, state: ApprovalDecisionState): Promise<void> {
    // The self-approval check constraint, in memory. The domain refuses it first; this is what
    // proves the second line exists rather than being assumed.
    if (state.decidedBy === state.requestedBy) {
      throw new Error('compensation_approval_decision_self_approval_check');
    }
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export class InMemoryChangeStore {
  public readonly rows: CompensationChangeState[] = [];

  public forEmployment(
    transaction: Transaction,
    employmentId: string,
    bounds: Paged,
  ): Promise<Page<CompensationChangeState>> {
    const matched = scoped(this.rows, transaction).filter(
      (row) => row.employmentId === employmentId,
    );

    return Promise.resolve(paged(matched, bounds));
  }

  public search(
    transaction: Transaction,
    query: ChangeQuery,
  ): Promise<Page<CompensationChangeState>> {
    const matched = scoped(this.rows, transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.componentId, query.componentId),
    );

    return Promise.resolve(paged(matched, query));
  }

  public insert(_transaction: Transaction, state: CompensationChangeState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}
