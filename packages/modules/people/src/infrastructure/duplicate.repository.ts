import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import { orderedPair, type DuplicateCandidateState } from '../domain/duplicate-candidate.js';
import type { MatchReason } from '../domain/duplicate-matching.js';
import type { DuplicateStatus } from '../domain/people-vocabulary.js';
import type { DuplicateStore, Page, Paged } from '../application/people-ports.js';

import { asVersion, insertRow } from './row-writer.js';

interface CandidateRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_id: string;
  readonly duplicate_of_person_id: string;
  readonly reason: string;
  readonly confidence: number | string;
  readonly status: string;
  readonly reviewed_by: string | null;
  readonly reviewed_at: Date | null;
  readonly review_note: string | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, person_id, duplicate_of_person_id, reason, confidence, status, reviewed_by, reviewed_at, review_note, version';

const toState = (row: CandidateRow): DuplicateCandidateState => ({
  id: row.id,
  tenantId: row.tenant_id,
  personId: row.person_id,
  duplicateOfPersonId: row.duplicate_of_person_id,
  reason: row.reason as MatchReason,
  confidence: asVersion(row.confidence),
  status: row.status as DuplicateStatus,
  ...(row.reviewed_by === null ? {} : { reviewedBy: row.reviewed_by }),
  ...(row.reviewed_at === null ? {} : { reviewedAt: row.reviewed_at }),
  ...(row.review_note === null ? {} : { reviewNote: row.review_note }),
  version: asVersion(row.version),
});

export class DuplicateRepository
  extends Repository<{ id: string; version: number }>
  implements DuplicateStore
{
  public constructor() {
    super('person_duplicate_candidate');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DuplicateCandidateState | undefined> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${COLUMNS} from person_duplicate_candidate
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  /**
   * The pair, ordered before it is looked up.
   *
   * The aggregate stores the lower identifier first and a check constraint enforces it, so
   * ordering here is what makes "have we already queued this decision" one question rather than
   * two — and what stops a reviewer's queue containing the same pair twice.
   */
  public async byPair(
    transaction: Transaction,
    personId: string,
    duplicateOfPersonId: string,
  ): Promise<DuplicateCandidateState | undefined> {
    const [first, second] = orderedPair(personId, duplicateOfPersonId);
    const rows = await transaction.execute<CandidateRow>(
      `select ${COLUMNS} from person_duplicate_candidate
        where tenant_id = $1 and person_id = $2 and duplicate_of_person_id = $3
          and deleted_at is null`,
      [transaction.tenantId, first, second],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  public async forPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<readonly DuplicateCandidateState[]> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${COLUMNS} from person_duplicate_candidate
        where tenant_id = $1 and (person_id = $2 or duplicate_of_person_id = $2)
          and deleted_at is null
        order by confidence desc`,
      [transaction.tenantId, personId],
    );
    return rows.map(toState);
  }

  public async list(
    transaction: Transaction,
    query: Paged & { readonly status?: string },
  ): Promise<Page<DuplicateCandidateState>> {
    const where =
      query.status === undefined
        ? 'tenant_id = $1 and deleted_at is null'
        : 'tenant_id = $1 and status = $2 and deleted_at is null';
    const parameters = [transaction.tenantId, query.status ?? null, query.limit, query.offset];

    const rows = await transaction.execute<CandidateRow>(
      `select ${COLUMNS} from person_duplicate_candidate where ${where}
        order by confidence desc, id limit $3 offset $4`,
      parameters,
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from person_duplicate_candidate where ${where}`,
      parameters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async insert(transaction: Transaction, state: DuplicateCandidateState): Promise<void> {
    await insertRow(
      transaction,
      'person_duplicate_candidate',
      {
        id: state.id,
        tenant_id: state.tenantId,
        person_id: state.personId,
        duplicate_of_person_id: state.duplicateOfPersonId,
        reason: state.reason,
        confidence: state.confidence,
        status: state.status,
        reviewed_by: state.reviewedBy ?? null,
        reviewed_at: state.reviewedAt ?? null,
        review_note: state.reviewNote ?? null,
      },
      new Date(),
    );
  }

  /** Only the decision is mutable. The pair and the reason are the finding, not a working note. */
  public async update(
    transaction: Transaction,
    state: DuplicateCandidateState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      status: state.status,
      reviewed_by: state.reviewedBy ?? null,
      reviewed_at: state.reviewedAt ?? null,
      review_note: state.reviewNote ?? null,
    });
  }
}
