import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import { normalizeEmail } from '../domain/recruitment-vocabulary.js';
import type { CandidateState } from '../domain/candidate.js';
import type { CandidateProfileEntryState } from '../domain/candidate-profile.js';
import type {
  CandidateQuery,
  CandidateStore,
  Page,
  ProfileEntryStore,
} from '../application/recruitment-ports.js';

import {
  CANDIDATE_COLUMNS,
  PROFILE_COLUMNS,
  candidateInsert,
  candidateUpdate,
  profileEntryInsert,
  profileEntryUpdate,
  toCandidate,
  toProfileEntry,
  type CandidateRow,
  type ProfileEntryRow,
} from './recruitment-rows.js';
import { candidateFilters } from './recruitment-search.js';
import { insertRow, pageOf } from './row-writer.js';

export class CandidateRepository
  extends Repository<{ id: string; version: number }>
  implements CandidateStore
{
  public constructor() {
    super('recruitment_candidate');
  }

  public async byId(transaction: Transaction, id: string): Promise<CandidateState | undefined> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${CANDIDATE_COLUMNS} from recruitment_candidate c
        where c.id = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toCandidate(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly CandidateState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<CandidateRow>(
      `select ${CANDIDATE_COLUMNS} from recruitment_candidate c
        where c.tenant_id = $1 and c.id = any($2::uuid[]) and c.deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toCandidate);
  }

  /** Compares the normalized address, which is what the create's duplicate check depends on. */
  public async byEmail(
    transaction: Transaction,
    email: string,
  ): Promise<CandidateState | undefined> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${CANDIDATE_COLUMNS} from recruitment_candidate c
        where c.tenant_id = $1 and c.email = $2 and c.deleted_at is null`,
      [transaction.tenantId, normalizeEmail(email)],
    );
    const row = rows[0];

    return row === undefined ? undefined : toCandidate(row);
  }

  /** Reads the predicate the partial unique index is built on: one candidate per Person. */
  public async byPersonId(
    transaction: Transaction,
    personId: string,
  ): Promise<CandidateState | undefined> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${CANDIDATE_COLUMNS} from recruitment_candidate c
        where c.tenant_id = $1 and c.person_id = $2 and c.deleted_at is null`,
      [transaction.tenantId, personId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toCandidate(row);
  }

  public search(transaction: Transaction, query: CandidateQuery): Promise<Page<CandidateState>> {
    const { where, parameters } = candidateFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<CandidateRow, CandidateState>(
      transaction,
      {
        select: `select ${CANDIDATE_COLUMNS} from recruitment_candidate c where ${where}
                 order by c.candidate_number limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from recruitment_candidate c where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toCandidate,
    );
  }

  public async all(transaction: Transaction): Promise<readonly CandidateState[]> {
    const rows = await transaction.execute<CandidateRow>(
      `select ${CANDIDATE_COLUMNS} from recruitment_candidate c
        where c.tenant_id = $1 and c.deleted_at is null order by c.candidate_number`,
      [transaction.tenantId],
    );
    return rows.map(toCandidate);
  }

  public async insert(transaction: Transaction, state: CandidateState): Promise<void> {
    await insertRow(transaction, this.table, candidateInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CandidateState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, candidateUpdate(state));
  }
}

export class ProfileEntryRepository
  extends Repository<{ id: string; version: number }>
  implements ProfileEntryStore
{
  public constructor() {
    super('recruitment_candidate_profile_entry');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CandidateProfileEntryState | undefined> {
    const rows = await transaction.execute<ProfileEntryRow>(
      `select ${PROFILE_COLUMNS} from recruitment_candidate_profile_entry p
        where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toProfileEntry(row);
  }

  public async forCandidate(
    transaction: Transaction,
    candidateId: string,
  ): Promise<readonly CandidateProfileEntryState[]> {
    const rows = await transaction.execute<ProfileEntryRow>(
      `select ${PROFILE_COLUMNS} from recruitment_candidate_profile_entry p
        where p.tenant_id = $1 and p.candidate_id = $2 and p.deleted_at is null
        order by p.kind, p.from_date desc nulls last`,
      [transaction.tenantId, candidateId],
    );
    return rows.map(toProfileEntry);
  }

  /** One query for a page of candidates rather than one per candidate — §45's N+1, refused. */
  public async forCandidates(
    transaction: Transaction,
    candidateIds: readonly string[],
  ): Promise<readonly CandidateProfileEntryState[]> {
    if (candidateIds.length === 0) return [];

    const rows = await transaction.execute<ProfileEntryRow>(
      `select ${PROFILE_COLUMNS} from recruitment_candidate_profile_entry p
        where p.tenant_id = $1 and p.candidate_id = any($2::uuid[]) and p.deleted_at is null
        order by p.kind`,
      [transaction.tenantId, [...candidateIds]],
    );
    return rows.map(toProfileEntry);
  }

  public async insert(transaction: Transaction, state: CandidateProfileEntryState): Promise<void> {
    await insertRow(transaction, this.table, profileEntryInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CandidateProfileEntryState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, profileEntryUpdate(state));
  }
}
