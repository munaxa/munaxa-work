import { auditForInsert } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { StatusRecordState } from '../domain/status-record.js';
import type { EmploymentStatus } from '../domain/employment-vocabulary.js';
import type {
  AssignmentStore,
  EmploymentStores,
  NumberSequenceStore,
  StatusRecordStore,
} from '../application/employment-ports.js';
import type { EmploymentAssignmentState } from '../domain/employment-assignment.js';

import {
  ASSIGNMENT_TABLE,
  CONTRACT_TABLE,
  REPORTING_LINE_TABLE,
  type AssignmentRow,
} from './child-tables.js';
import { ChildRepository } from './child.repository.js';
import { EmploymentRepository } from './employment.repository.js';
import { asVersion, insertRow } from './row-writer.js';

/**
 * The PostgreSQL implementation of every store the application declares.
 *
 * Assembled at the bottom of this file so the composition root wires one thing rather than six,
 * and so that swapping an implementation is one edit rather than a search.
 */

/** Assignments, plus the one count Organization asks for through `FilledHeadcountPort`. */
class AssignmentRepository
  extends ChildRepository<EmploymentAssignmentState, AssignmentRow>
  implements AssignmentStore
{
  public constructor() {
    super(ASSIGNMENT_TABLE);
  }

  /**
   * How many assignments are in force against a position in a unit on a date.
   *
   * Counted in the database rather than by loading assignments, because an establishment screen
   * asks this once per budgeted position in a department — and loading a department's assignments
   * per position is how one screen becomes a hundred queries.
   *
   * Only employments that are **not ended** count. A filled headcount that included people who
   * have left would report a department as fully staffed while it advertised the vacancy.
   */
  public async countInForce(
    transaction: Transaction,
    positionId: string,
    unitId: string,
    asOf: Date,
  ): Promise<number> {
    const rows = await transaction.execute<{ total: string }>(
      `select count(*)::text as total
         from employment_assignment a
         join employment e on e.id = a.employment_id and e.tenant_id = a.tenant_id
        where a.tenant_id = $1 and a.position_id = $2::uuid and a.unit_id = $3::uuid
          and a.deleted_at is null and e.deleted_at is null and e.status <> 'ended'
          and a.effective_from <= $4 and (a.effective_to is null or a.effective_to > $4)`,
      [transaction.tenantId, positionId, unitId, asOf],
    );
    return Number(rows[0]?.total ?? '0');
  }
}

interface StatusRecordRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly from_status: string | null;
  readonly to_status: string;
  readonly reason_code: string | null;
  readonly note: string | null;
  readonly effective_from: Date;
  readonly recorded_by: string;
  readonly recorded_at: Date;
  readonly version: number | string;
}

const STATUS_COLUMNS =
  'id, tenant_id, employment_id, from_status, to_status, reason_code, note, effective_from, recorded_by, recorded_at, version';

const toStatusRecord = (row: StatusRecordRow): StatusRecordState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  ...(row.from_status === null ? {} : { fromStatus: row.from_status as EmploymentStatus }),
  toStatus: row.to_status as EmploymentStatus,
  ...(row.reason_code === null ? {} : { reasonCode: row.reason_code }),
  ...(row.note === null ? {} : { note: row.note }),
  effectiveFrom: row.effective_from,
  recordedBy: row.recorded_by,
  recordedAt: row.recorded_at,
  version: asVersion(row.version),
});

/**
 * Status history: appended, never updated.
 *
 * There is no `update` here and there is no soft delete, and both absences are the point. A
 * history that could be rewritten is not evidence of anything, and the cheapest way to guarantee
 * that is to give the code no way to do it.
 */
class StatusRecordRepository implements StatusRecordStore {
  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly StatusRecordState[]> {
    const rows = await transaction.execute<StatusRecordRow>(
      `select ${STATUS_COLUMNS} from employment_status_record
        where tenant_id = $1 and employment_id = $2 and deleted_at is null
        order by effective_from, recorded_at`,
      [transaction.tenantId, employmentId],
    );
    return rows.map(toStatusRecord);
  }

  public async forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly StatusRecordState[]> {
    if (employmentIds.length === 0) return [];

    const rows = await transaction.execute<StatusRecordRow>(
      `select ${STATUS_COLUMNS} from employment_status_record
        where tenant_id = $1 and employment_id = any($2::uuid[]) and deleted_at is null
        order by effective_from, recorded_at`,
      [transaction.tenantId, [...employmentIds]],
    );
    return rows.map(toStatusRecord);
  }

  public async insert(transaction: Transaction, state: StatusRecordState): Promise<void> {
    await insertRow(
      transaction,
      'employment_status_record',
      {
        id: state.id,
        tenant_id: state.tenantId,
        employment_id: state.employmentId,
        from_status: state.fromStatus ?? null,
        to_status: state.toStatus,
        reason_code: state.reasonCode ?? null,
        note: state.note ?? null,
        effective_from: state.effectiveFrom,
        recorded_by: state.recordedBy,
        recorded_at: state.recordedAt,
      },
      new Date(),
    );
  }
}

/**
 * The employment-number counter.
 *
 * `insert ... on conflict do update` returning the new value is one statement that both creates
 * the tenant's series on first use and takes the row lock the increment needs — so two concurrent
 * creates serialize on the row rather than racing, and neither can receive a number the other
 * already has.
 *
 * It is deliberately not a PostgreSQL sequence: a sequence is not tenant-scoped, and it is not
 * transactional. A create that rolled back would burn a number and leave a permanent gap in a
 * customer's employee numbering that nobody could explain (ADR-0039).
 */
class NumberSequenceRepository implements NumberSequenceStore {
  public async allocate(transaction: Transaction, seriesKey: string): Promise<number> {
    // The actor and the instant come from `auditForInsert`, which reads the authenticated context
    // — the same source every other audit column in the product is written from, so a sequence row
    // cannot record an actor no other table would.
    const audit = auditForInsert(new Date());
    const rows = await transaction.execute<{ next_value: number | string }>(
      `insert into employment_number_sequence
         (tenant_id, series_key, next_value, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 2, $3, $4, $3, $4, 1)
       on conflict (tenant_id, series_key) where deleted_at is null
       do update set next_value = employment_number_sequence.next_value + 1,
                     updated_at = $3,
                     updated_by = $4,
                     version = employment_number_sequence.version + 1
       returning next_value`,
      [transaction.tenantId, seriesKey, audit.updated_at, audit.updated_by],
    );
    const allocated = rows[0]?.next_value;

    if (allocated === undefined) {
      throw new Error('The employment number sequence returned no value.');
    }
    // The row holds the *next* value, so the number just allocated is one less. Returning the
    // stored value instead would skip the first number of every series.
    return Number(allocated) - 1;
  }
}

export const postgresEmploymentStores = (): EmploymentStores => ({
  employments: new EmploymentRepository(),
  assignments: new AssignmentRepository(),
  reportingLines: new ChildRepository(REPORTING_LINE_TABLE),
  contracts: new ChildRepository(CONTRACT_TABLE),
  statusHistory: new StatusRecordRepository(),
  numbers: new NumberSequenceRepository(),
});
