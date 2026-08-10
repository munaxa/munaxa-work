import type { Transaction } from '@work/kernel';

import type { AdjustmentState, EntitlementState } from '../domain/entitlement.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { LedgerBucket } from '../domain/ledger.js';
import type { BlackoutState, PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { AccrualRunState, LeaveYearState } from '../domain/runs.js';
import { coversDate } from '../domain/policy-assignment.js';
import {
  InMemoryStore,
  equalWhereGiven,
  paged,
  rangesOverlap,
  scoped,
} from './in-memory-support.js';
import { InMemoryBalanceStore, InMemoryLedgerStore } from './in-memory-stores.js';
import {
  InMemoryDecisionStore,
  InMemoryRequestDayStore,
  InMemoryRequestEventStore,
  InMemoryRequestStore,
} from './in-memory-requests.js';
import type {
  AdjustmentQuery,
  EntitlementQuery,
  EntitlementSource,
  LeaveStores,
  Page,
} from './leave-ports.js';

/**
 * The configuration and administrative stores, and the bundle that assembles all fourteen.
 *
 * Split from `in-memory-stores.ts` because that file holds the four whose behaviour is
 * load-bearing — the ledger, the projection, the day rows and the decisions — and mixing them with
 * eight plain tables would bury the parts a reviewer should actually read.
 */

export class InMemoryTypeStore extends InMemoryStore<LeaveTypeState> {
  public byCode(transaction: Transaction, code: string): Promise<LeaveTypeState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.code === code));
  }
}

export class InMemoryPolicyStore extends InMemoryStore<LeavePolicyState> {
  public forType(
    transaction: Transaction,
    leaveTypeId: string,
  ): Promise<readonly LeavePolicyState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.leaveTypeId === leaveTypeId),
    );
  }
}

export class InMemoryAssignmentStore extends InMemoryStore<PolicyAssignmentState> {
  /**
   * Every assignment that could govern these scopes on this date.
   *
   * A tenant-scoped assignment matches whatever the scope list contains, because it applies to
   * everybody — which is why it is checked separately rather than by looking for its identifier.
   */
  public candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PolicyAssignmentState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          coversDate(row, onDate) &&
          (row.scope === 'tenant' || (row.scopeId !== undefined && scopeIds.includes(row.scopeId))),
      ),
    );
  }

  public forPolicy(
    transaction: Transaction,
    leavePolicyId: string,
  ): Promise<readonly PolicyAssignmentState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.leavePolicyId === leavePolicyId),
    );
  }
}

export class InMemoryBlackoutStore {
  public readonly rows: BlackoutState[] = [];

  public between(
    transaction: Transaction,
    from: string,
    to: string,
  ): Promise<readonly BlackoutState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) =>
        rangesOverlap({ from: row.fromDate, to: row.toDate }, { from, to }),
      ),
    );
  }

  public insert(_transaction: Transaction, state: BlackoutState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export class InMemoryEntitlementStore extends InMemoryStore<EntitlementState> {
  /** The idempotency read an accrual run makes. Backed by `leave_entitlement_source_key`. */
  public bySource(
    transaction: Transaction,
    source: EntitlementSource,
  ): Promise<EntitlementState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) =>
          row.employmentId === source.employmentId &&
          row.leaveTypeId === source.leaveTypeId &&
          row.leaveYearStart === source.leaveYearStart &&
          row.source === source.source &&
          row.sourceId === source.sourceId,
      ),
    );
  }

  public forBucket(
    transaction: Transaction,
    bucket: LedgerBucket,
  ): Promise<readonly EntitlementState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          row.employmentId === bucket.employmentId &&
          row.leaveTypeId === bucket.leaveTypeId &&
          row.leaveYearStart === bucket.leaveYearStart,
      ),
    );
  }

  public search(
    transaction: Transaction,
    query: EntitlementQuery,
  ): Promise<Page<EntitlementState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.leaveTypeId, query.leaveTypeId) &&
        equalWhereGiven(row.leaveYearStart, query.leaveYearStart),
    );

    return Promise.resolve(paged(matched, query));
  }
}

export class InMemoryAdjustmentStore extends InMemoryStore<AdjustmentState> {
  public search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.leaveTypeId, query.leaveTypeId),
    );

    return Promise.resolve(paged(matched, query));
  }
}

export class InMemoryAccrualRunStore extends InMemoryStore<AccrualRunState> {
  /** The run for a policy and period, so re-invoking the command resumes rather than reopens. */
  public forPeriod(
    transaction: Transaction,
    leavePolicyId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<AccrualRunState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) =>
          row.leavePolicyId === leavePolicyId &&
          row.periodStart === periodStart &&
          row.periodEnd === periodEnd,
      ),
    );
  }

  public recent(transaction: Transaction, limit: number): Promise<readonly AccrualRunState[]> {
    return Promise.resolve(this.scoped(transaction).slice(-limit).reverse());
  }
}

export class InMemoryLeaveYearStore {
  public readonly rows: LeaveYearState[] = [];

  public byPolicyAndYear(
    transaction: Transaction,
    leavePolicyId: string,
    leaveYearStart: string,
  ): Promise<LeaveYearState | undefined> {
    return Promise.resolve(
      scoped(this.rows, transaction).find(
        (row) => row.leavePolicyId === leavePolicyId && row.leaveYearStart === leaveYearStart,
      ),
    );
  }

  public recent(transaction: Transaction, limit: number): Promise<readonly LeaveYearState[]> {
    return Promise.resolve(scoped(this.rows, transaction).slice(-limit).reverse());
  }

  public insert(_transaction: Transaction, state: LeaveYearState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

/** All fourteen stores, assembled. What the application and API suites inject. */
export const inMemoryLeaveStores = (): LeaveStores => {
  const requests = new InMemoryRequestStore();

  return {
    types: new InMemoryTypeStore(),
    policies: new InMemoryPolicyStore(),
    assignments: new InMemoryAssignmentStore(),
    blackouts: new InMemoryBlackoutStore(),
    entitlements: new InMemoryEntitlementStore(),
    ledger: new InMemoryLedgerStore(),
    balances: new InMemoryBalanceStore(),
    requests,
    // The day store reads the request store, because "is this leave approved" is a fact about the
    // request and copying the state onto the day row would create a second copy that could differ.
    requestDays: new InMemoryRequestDayStore(requests),
    decisions: new InMemoryDecisionStore(),
    requestEvents: new InMemoryRequestEventStore(),
    adjustments: new InMemoryAdjustmentStore(),
    accrualRuns: new InMemoryAccrualRunStore(),
    leaveYears: new InMemoryLeaveYearStore(),
  };
};
