import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CertificationState } from '../domain/certification.js';
import type { InstructorState } from '../domain/instructor.js';
import type {
  CertificationFilters,
  CertificationStore,
  InstructorStore,
  Page,
  Paged,
} from '../application/learning-ports.js';
import {
  INSTRUCTOR_COLUMNS,
  certificationColumns,
  certificationState,
  certificationValues,
  instructorState,
  instructorValues,
  type CertificationRow,
  type InstructorRow,
} from './learner-rows.js';
import {
  boundClause,
  insertRow,
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  type Filter,
} from './row-writer.js';

/**
 * Certifications and instructors.
 *
 * **There is no `expired` column and nothing here writes one** (ADR-0070). `valid_until` is the only
 * fact stored, and validity is derived on read against the day the caller asked about. The expiring
 * queue is therefore an indexed predicate over a date — `status = 'active' and valid_until <= $n`,
 * which `learning_certification_expiry_idx` covers — and it is correct at every instant rather than
 * as of whatever sweep last ran. There is no sweep.
 *
 * **Learning owns this expiry and duplicates nobody else's.** `evidence_document_id` is an
 * identifier and nothing more: no filename, no size, no hash, no URL and above all no second expiry
 * date. Documents keeps the validity of the scan; this keeps the validity of the qualification.
 */

export class PostgresCertificationRepository
  extends Repository<CertificationRow & { version: number }>
  implements CertificationStore
{
  public constructor() {
    super('learning_certification');
  }

  public async byId(transaction: Transaction, id: string): Promise<CertificationState | undefined> {
    const rows = await transaction.execute<CertificationRow>(
      `select ${certificationColumns('c')} from learning_certification c
         where c.id = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : certificationState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: CertificationFilters,
    paged: Paged,
  ): Promise<Page<CertificationState>> {
    const predicate = predicateFor('c', transaction.tenantId, certificationFilters(filters));
    const parameters = [...predicate.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'c.employment_id', parameters);
    const clauses = [predicate.clause];

    if (bound !== undefined) clauses.push(bound);
    // The expiring queue asks only about live certificates: a revoked one with a future date is not
    // "expiring soon", it is gone, and including it would inflate every renewal report.
    if (filters.validUntilOnOrBefore !== undefined) clauses.push(`c.status = 'active'`);

    const clause = clauses.join(' and ');
    const next = parameters.length + 1;

    return pageOf<CertificationRow, CertificationState>(
      transaction,
      {
        select: `select ${certificationColumns('c')} from learning_certification c
                   where ${clause}
                   order by c.valid_until nulls last, c.id
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from learning_certification c where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      certificationState,
    );
  }

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly CertificationState[]> {
    const rows = await transaction.execute<CertificationRow>(
      `select ${certificationColumns('c')} from learning_certification c
         where c.tenant_id = $1 and c.employment_id = $2 and c.deleted_at is null
         order by c.issued_on desc, c.id desc`,
      [transaction.tenantId, employmentId],
    );

    return rows.map(certificationState);
  }

  public async forEnrolment(
    transaction: Transaction,
    enrolmentId: string,
  ): Promise<CertificationState | undefined> {
    const rows = await transaction.execute<CertificationRow>(
      `select ${certificationColumns('c')} from learning_certification c
         where c.tenant_id = $1 and c.enrolment_id = $2 and c.deleted_at is null`,
      [transaction.tenantId, enrolmentId],
    );

    return rows[0] === undefined ? undefined : certificationState(rows[0]);
  }

  /**
   * Writes the certification unless one already exists for this enrolment.
   *
   * Only enrolment-backed certifications are covered by the index: an externally obtained one has no
   * natural key, because somebody may genuinely hold two licences from two issuers, and a uniqueness
   * rule invented for them would refuse a real record (D-2).
   */
  public insertIfAbsent(transaction: Transaction, state: CertificationState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      certificationValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: CertificationState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.certificationId,
      expected,
      mutable(certificationValues(state, transaction.tenantId)),
    );
  }
}

const certificationFilters = (filters: CertificationFilters): readonly Filter[] => [
  { column: 'c.employment_id', value: filters.employmentId },
  { column: 'c.course_id', value: filters.courseId },
  { column: 'c.status', value: filters.status },
  { column: 'c.valid_until', value: filters.validUntilOnOrBefore, operator: '<=' },
];

/**
 * Instructors: an identity, and only an identity (D-6).
 *
 * Nothing here schedules anybody — no availability, no calendar, no booking and no rate. An internal
 * instructor is an employment reference with no copied personal data; an external one is a
 * Learning-owned record, because manufacturing a `person` row for a visiting trainer would put a
 * non-employee into headcount reports and org charts.
 */
export class PostgresInstructorRepository
  extends Repository<InstructorRow & { version: number }>
  implements InstructorStore
{
  public constructor() {
    super('learning_instructor');
  }

  public async byId(transaction: Transaction, id: string): Promise<InstructorState | undefined> {
    const rows = await transaction.execute<InstructorRow>(
      `select ${INSTRUCTOR_COLUMNS} from learning_instructor
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : instructorState(rows[0]);
  }

  public all(
    transaction: Transaction,
    activeOnly: boolean,
    paged: Paged,
  ): Promise<Page<InstructorState>> {
    const activeClause = activeOnly ? ' and active' : '';

    return pageOf<InstructorRow, InstructorState>(
      transaction,
      {
        select: `select ${INSTRUCTOR_COLUMNS} from learning_instructor
                   where tenant_id = $1 and deleted_at is null${activeClause}
                   order by id
                   limit $2 offset $3`,
        count: `select count(*)::text as total from learning_instructor
                  where tenant_id = $1 and deleted_at is null${activeClause}`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      instructorState,
    );
  }

  public insert(transaction: Transaction, state: InstructorState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      instructorValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: InstructorState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.instructorId,
      expected,
      mutable(instructorValues(state, transaction.tenantId)),
    );
  }
}
