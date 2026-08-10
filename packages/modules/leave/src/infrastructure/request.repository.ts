import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import { APPROVED_REQUEST_STATES } from '../domain/leave-vocabulary.js';
import type { LeaveRequestState, RequestDayState } from '../domain/leave-request-state.js';
import type {
  CoverageQuery,
  CoveredDay,
  Page,
  RequestDayStore,
  RequestQuery,
  RequestStore,
} from '../application/leave-ports.js';

import {
  DAY_COLUMNS,
  REQUEST_COLUMNS,
  dayValues,
  requestValues,
  toDay,
  toRequest,
  type LeaveRequestRow,
  type RequestDayRow,
} from './request-rows.js';
import { insertRow, mutable, pageOf, predicateFor } from './row-writer.js';

/**
 * Requests and their day rows, in PostgreSQL.
 *
 * `covering` is the read Attendance calls on **every** recalculation, so its cost is multiplied by
 * every day of every run. It is one join on `leave_request_day_coverage_idx`, filtered to the
 * approved states, and it does no arithmetic — the rows it returns *are* the day rows, so
 * Attendance and Leave cannot disagree about which dates are covered.
 *
 * A day row is removed **softly**, because the exclusion constraint's predicate is
 * `deleted_at is null`: clearing the mark is what releases the date, and the row stays readable so
 * "what did this request originally cover" survives a withdrawal or an amendment.
 */
export class LeaveRequestRepository
  extends Repository<{ id: string; version: number }>
  implements RequestStore
{
  public constructor() {
    super('leave_request');
  }

  public async byId(transaction: Transaction, id: string): Promise<LeaveRequestState | undefined> {
    const rows = await transaction.execute<LeaveRequestRow>(
      `select ${REQUEST_COLUMNS} from leave_request q
        where q.id = $1 and q.tenant_id = $2 and q.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toRequest(row);
  }

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
    from: string,
    to: string,
  ): Promise<readonly LeaveRequestState[]> {
    const rows = await transaction.execute<LeaveRequestRow>(
      `select ${REQUEST_COLUMNS} from leave_request q
        where q.tenant_id = $1 and q.employment_id = $2
          and q.from_date <= $4::date and q.to_date >= $3::date and q.deleted_at is null
        order by q.from_date`,
      [transaction.tenantId, employmentId, from, to],
    );
    return rows.map(toRequest);
  }

  /** One statement for a page of identifiers, because the alternative is an N+1 per screen. */
  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly LeaveRequestState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<LeaveRequestRow>(
      `select ${REQUEST_COLUMNS} from leave_request q
        where q.tenant_id = $1 and q.id = any($2::uuid[]) and q.deleted_at is null`,
      [transaction.tenantId, ids],
    );
    return rows.map(toRequest);
  }

  public search(transaction: Transaction, query: RequestQuery): Promise<Page<LeaveRequestState>> {
    const { clause, parameters, next } = predicateFor('q', transaction.tenantId, [
      { column: 'q.employment_id', value: query.employmentId },
      { column: 'q.leave_type_id', value: query.leaveTypeId },
      { column: 'q.state', value: query.state },
      { column: 'q.to_date', value: query.fromDate, cast: '::date', operator: '>=' },
      { column: 'q.from_date', value: query.toDate, cast: '::date', operator: '<=' },
    ]);

    return pageOf<LeaveRequestRow, LeaveRequestState>(
      transaction,
      {
        select: `select ${REQUEST_COLUMNS} from leave_request q where ${clause}
                 order by q.requested_at desc, q.id
                 limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*) as total from leave_request q where ${clause}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toRequest,
    );
  }

  public async insert(transaction: Transaction, state: LeaveRequestState): Promise<void> {
    await insertRow(transaction, 'leave_request', requestValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: LeaveRequestState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(requestValues(state)));
  }
}

interface CoveredDayRow extends RequestDayRow {
  readonly request_state: string;
  readonly request_leave_type_id: string;
}

export class RequestDayRepository
  extends Repository<{ id: string; version: number }>
  implements RequestDayStore
{
  public constructor() {
    super('leave_request_day');
  }

  public async forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly RequestDayState[]> {
    const rows = await transaction.execute<RequestDayRow>(
      `select ${DAY_COLUMNS} from leave_request_day d
        where d.tenant_id = $1 and d.leave_request_id = $2 and d.deleted_at is null
        order by d.on_date`,
      [transaction.tenantId, requestId],
    );
    return rows.map(toDay);
  }

  public async forRequests(
    transaction: Transaction,
    requestIds: readonly string[],
  ): Promise<readonly RequestDayState[]> {
    if (requestIds.length === 0) return [];

    const rows = await transaction.execute<RequestDayRow>(
      `select ${DAY_COLUMNS} from leave_request_day d
        where d.tenant_id = $1 and d.leave_request_id = any($2::uuid[]) and d.deleted_at is null
        order by d.on_date`,
      [transaction.tenantId, requestIds],
    );
    return rows.map(toDay);
  }

  /**
   * The published coverage read, and the query Attendance is on the path of.
   *
   * **Approved states only.** A draft, a submitted-but-undecided, a rejected, a withdrawn and a
   * cancelled request all return nothing: somebody who has *asked* for the fourteenth off has not
   * been granted it, and an attendance record saying otherwise would be wrong about them.
   *
   * `changedSince` compares `q.updated_at`, which the audit columns maintain on every write — so an
   * approval, a cancellation and an amendment all move it, and Attendance's incremental pull sees
   * each of them.
   */
  public async covering(
    transaction: Transaction,
    query: CoverageQuery,
  ): Promise<readonly CoveredDay[]> {
    const rows = await transaction.execute<CoveredDayRow>(
      `select ${DAY_COLUMNS}, q.state as request_state, q.leave_type_id as request_leave_type_id
         from leave_request_day d
         join leave_request q on q.id = d.leave_request_id and q.tenant_id = d.tenant_id
        where d.tenant_id = $1 and d.employment_id = $2
          and d.on_date between $3::date and $4::date
          and d.deleted_at is null and q.deleted_at is null
          and q.state = any($5::text[])
          and ($6::timestamptz is null or q.updated_at >= $6::timestamptz)
        order by d.on_date`,
      [
        transaction.tenantId,
        query.employmentId,
        query.from,
        query.to,
        [...APPROVED_REQUEST_STATES],
        query.changedSince ?? null,
      ],
    );

    return rows.map((row) => ({
      ...toDay(row),
      requestState: row.request_state,
      leaveTypeId: row.request_leave_type_id,
    }));
  }

  public async insert(transaction: Transaction, state: RequestDayState): Promise<void> {
    await insertRow(transaction, 'leave_request_day', dayValues(state), new Date());
  }

  /**
   * Soft, because the exclusion constraint's predicate is `deleted_at is null`.
   *
   * Removing the mark is what releases the date; the row stays readable, so "what did this request
   * originally cover" survives a withdrawal or an amendment.
   */
  public async remove(transaction: Transaction, id: string, _at: Date): Promise<void> {
    const row = await this.findRow(transaction, id);

    // Already gone is not an error: releasing a request's dates twice — a withdrawal that races an
    // amendment — should leave them released rather than fail the second caller.
    if (row === undefined) return;

    await this.softDeleteRow(transaction, id, row.version);
  }
}
