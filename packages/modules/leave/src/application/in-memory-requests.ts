import type { Transaction } from '@work/kernel';

import type {
  LeaveRequestState,
  RequestDayState,
  RequestDecisionState,
  RequestEventState,
} from '../domain/leave-request-state.js';
import { isApproved } from '../domain/leave-vocabulary.js';
import {
  ExclusionViolation,
  InMemoryStore,
  equalWhereGiven,
  paged,
  scoped,
} from './in-memory-support.js';
import type { CoverageQuery, CoveredDay, Page, RequestQuery } from './leave-ports.js';

/**
 * The request family, in memory.
 *
 * Three behaviours here are load-bearing and are reproduced carefully rather than approximated:
 *
 * - the day rows' **overlap exclusion**, including that a first and a second half of one date
 *   coexist while two full days do not;
 * - the coverage read's **approved-only** filter, since a request somebody merely asked for is not
 *   leave and an attendance record saying otherwise would be wrong about them;
 * - the decision table's **self-approval check**, because it is the control this module's
 *   separation of duties rests on and a fake that let it through would leave the refusal untested.
 */

export class InMemoryRequestStore extends InMemoryStore<LeaveRequestState> {
  public forEmployment(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly LeaveRequestState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) => row.employmentId === employmentId && row.fromDate <= to && row.toDate >= from,
      ),
    );
  }

  public byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly LeaveRequestState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => ids.includes(row.id)));
  }

  public search(transaction: Transaction, query: RequestQuery): Promise<Page<LeaveRequestState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.employmentId, query.employmentId) &&
        equalWhereGiven(row.leaveTypeId, query.leaveTypeId) &&
        equalWhereGiven(row.state, query.state) &&
        (query.fromDate === undefined || row.toDate >= query.fromDate) &&
        (query.toDate === undefined || row.fromDate <= query.toDate),
    );

    return Promise.resolve(paged(matched, query));
  }
}

/** Minutes of the day a portion occupies — the generated `span` column, in memory. */
const spanOf = (day: RequestDayState): readonly [number, number] => {
  if (day.portion === 'full_day') return [0, 1440];
  if (day.portion === 'first_half') return [0, 720];
  if (day.portion === 'second_half') return [720, 1440];

  const start = minutes(day.startLocal ?? '00:00');

  return [start, Math.max(minutes(day.endLocal ?? '24:00'), start + 1)];
};

const minutes = (wallClock: string): number => {
  const [hours = '0', mins = '0'] = wallClock.split(':');
  return Number(hours) * 60 + Number(mins);
};

export class InMemoryRequestDayStore {
  public readonly rows: (RequestDayState & { deletedAt?: Date })[] = [];

  public constructor(private readonly requests: InMemoryRequestStore) {}

  public forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestDayState[]> {
    return Promise.resolve(
      this.live(transaction).filter((row) => row.leaveRequestId === requestId),
    );
  }

  public forRequests(
    transaction: Transaction,
    requestIds: readonly string[],
  ): Promise<readonly RequestDayState[]> {
    return Promise.resolve(
      this.live(transaction).filter((row) => requestIds.includes(row.leaveRequestId)),
    );
  }

  /**
   * The published coverage read.
   *
   * **Approved only.** A draft, a submitted-but-undecided, a rejected, a withdrawn and a cancelled
   * request all return nothing: somebody who has asked for the fourteenth off has not been granted
   * it, and an attendance record saying otherwise would be wrong about them.
   */
  public async covering(
    transaction: Transaction,
    query: CoverageQuery,
  ): Promise<readonly CoveredDay[]> {
    const days = this.live(transaction).filter(
      (row) =>
        row.employmentId === query.employmentId &&
        row.onDate >= query.from &&
        row.onDate <= query.to,
    );
    const requests = await this.requests.byIds(
      transaction,
      days.map((day) => day.leaveRequestId),
    );
    const byId = new Map(requests.map((one) => [one.id, one]));

    return days.flatMap((day) => {
      const request = byId.get(day.leaveRequestId);

      if (request === undefined || !isApproved(request.state)) return [];
      if (query.changedSince !== undefined && changedAt(request) < query.changedSince) return [];

      return [{ ...day, requestState: request.state, leaveTypeId: request.leaveTypeId }];
    });
  }

  /** The GiST exclusion constraint, in memory — including the error the driver would raise. */
  public insert(transaction: Transaction, state: RequestDayState): Promise<void> {
    const [start, end] = spanOf(state);
    const clash = this.live(transaction).find((row) => {
      if (row.employmentId !== state.employmentId || row.onDate !== state.onDate) return false;

      const [otherStart, otherEnd] = spanOf(row);

      return start < otherEnd && otherStart < end;
    });

    if (clash !== undefined) throw new ExclusionViolation('leave_request_day_overlap');

    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }

  /** Soft, because the exclusion constraint's predicate is `deleted_at is null`. */
  public remove(_transaction: Transaction, id: string, at: Date): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === id);
    const row = this.rows[index];

    if (row !== undefined) this.rows.splice(index, 1, { ...row, deletedAt: at });
    return Promise.resolve();
  }

  private live(transaction: Transaction): readonly (RequestDayState & { deletedAt?: Date })[] {
    return scoped(this.rows, transaction).filter((row) => row.deletedAt === undefined);
  }
}

/**
 * When a request last changed, for the incremental coverage read.
 *
 * The latest of the instants the request records. The real repository reads `updated_at`, which the
 * audit columns maintain; the fake reconstructs the same thing from the state it has, because the
 * in-memory rows carry no audit columns.
 */
const changedAt = (request: LeaveRequestState): Date =>
  [
    request.cancelledAt,
    request.withdrawnAt,
    request.approvedAt,
    request.rejectedAt,
    request.submittedAt,
    request.requestedAt,
  ].find((one): one is Date => one !== undefined) ?? request.requestedAt;

export class InMemoryDecisionStore {
  public readonly rows: RequestDecisionState[] = [];

  public forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestDecisionState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction)
        .filter((row) => row.leaveRequestId === requestId)
        .sort((one, other) => one.sequence - other.sequence),
    );
  }

  /**
   * The self-approval check constraint, in memory.
   *
   * Reproduced here as well as in the database because it is the control this module's separation
   * of duties rests on, and a fake that let it through would leave the domain refusal untested.
   */
  public insert(_transaction: Transaction, state: RequestDecisionState): Promise<void> {
    if (state.decidedBy === state.requestedBy) {
      throw new Error('new row violates check constraint "leave_request_decision_self_approval"');
    }
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export class InMemoryRequestEventStore {
  public readonly rows: RequestEventState[] = [];

  public forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestEventState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.leaveRequestId === requestId),
    );
  }

  public insert(_transaction: Transaction, state: RequestEventState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}
