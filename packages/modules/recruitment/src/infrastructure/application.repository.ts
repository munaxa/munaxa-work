import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ApplicationState } from '../domain/application.js';
import type { ApplicationEventState } from '../domain/application-event.js';
import type {
  ApplicationEventStore,
  ApplicationQuery,
  ApplicationStore,
  Page,
} from '../application/recruitment-ports.js';

import {
  APPLICATION_COLUMNS,
  APPLICATION_EVENT_COLUMNS,
  applicationEventInsert,
  applicationInsert,
  applicationUpdate,
  toApplication,
  toApplicationEvent,
  type ApplicationEventRow,
  type ApplicationRow,
} from './pipeline-rows.js';
import { applicationFilters } from './recruitment-search.js';
import { insertRow, pageOf } from './row-writer.js';

export class ApplicationRepository
  extends Repository<{ id: string; version: number }>
  implements ApplicationStore
{
  public constructor() {
    super('recruitment_application');
  }

  public async byId(transaction: Transaction, id: string): Promise<ApplicationState | undefined> {
    const rows = await transaction.execute<ApplicationRow>(
      `select ${APPLICATION_COLUMNS} from recruitment_application a
        where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toApplication(row);
  }

  /** Reads the predicate the unique index is built on: one application per candidate per vacancy. */
  public async byCandidateAndVacancy(
    transaction: Transaction,
    candidateId: string,
    vacancyId: string,
  ): Promise<ApplicationState | undefined> {
    const rows = await transaction.execute<ApplicationRow>(
      `select ${APPLICATION_COLUMNS} from recruitment_application a
        where a.tenant_id = $1 and a.candidate_id = $2 and a.vacancy_id = $3
          and a.deleted_at is null`,
      [transaction.tenantId, candidateId, vacancyId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toApplication(row);
  }

  public async forCandidate(
    transaction: Transaction,
    candidateId: string,
  ): Promise<readonly ApplicationState[]> {
    const rows = await transaction.execute<ApplicationRow>(
      `select ${APPLICATION_COLUMNS} from recruitment_application a
        where a.tenant_id = $1 and a.candidate_id = $2 and a.deleted_at is null
        order by a.applied_on desc`,
      [transaction.tenantId, candidateId],
    );
    return rows.map(toApplication);
  }

  public search(
    transaction: Transaction,
    query: ApplicationQuery,
  ): Promise<Page<ApplicationState>> {
    const { where, parameters } = applicationFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<ApplicationRow, ApplicationState>(
      transaction,
      {
        select: `select ${APPLICATION_COLUMNS} from recruitment_application a where ${where}
                 order by a.applied_on desc, a.application_number limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from recruitment_application a where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toApplication,
    );
  }

  /**
   * The pipeline board, counted in the database.
   *
   * A vacancy with forty thousand applications has a summary that is one aggregate query rather than
   * forty thousand rows the API groups — the unbounded read is the failure a recruitment product
   * reaches first, and the covering index makes this one an index-only scan.
   */
  public async countByStatus(
    transaction: Transaction,
    vacancyId: string,
  ): Promise<Readonly<Record<string, number>>> {
    const rows = await transaction.execute<{ status: string; total: string }>(
      `select a.status, count(*)::text as total from recruitment_application a
        where a.tenant_id = $1 and a.vacancy_id = $2 and a.deleted_at is null
        group by a.status`,
      [transaction.tenantId, vacancyId],
    );
    const counts: Record<string, number> = {};

    for (const row of rows) counts[row.status] = Number(row.total);
    return counts;
  }

  public async all(transaction: Transaction): Promise<readonly ApplicationState[]> {
    const rows = await transaction.execute<ApplicationRow>(
      `select ${APPLICATION_COLUMNS} from recruitment_application a
        where a.tenant_id = $1 and a.deleted_at is null order by a.application_number`,
      [transaction.tenantId],
    );
    return rows.map(toApplication);
  }

  public async insert(transaction: Transaction, state: ApplicationState): Promise<void> {
    await insertRow(transaction, this.table, applicationInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: ApplicationState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, applicationUpdate(state));
  }
}

/**
 * The pipeline history: appended, never updated.
 *
 * No `update`, no delete. A history that could be rewritten is not evidence, and the cheapest way to
 * guarantee that is to give the code no way to do it.
 */
export class ApplicationEventRepository implements ApplicationEventStore {
  public async forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly ApplicationEventState[]> {
    const rows = await transaction.execute<ApplicationEventRow>(
      `select ${APPLICATION_EVENT_COLUMNS} from recruitment_application_event
        where tenant_id = $1 and application_id = $2 and deleted_at is null
        order by occurred_at, id`,
      [transaction.tenantId, applicationId],
    );
    return rows.map(toApplicationEvent);
  }

  public async insert(transaction: Transaction, state: ApplicationEventState): Promise<void> {
    await insertRow(
      transaction,
      'recruitment_application_event',
      applicationEventInsert(state),
      new Date(),
    );
  }
}
