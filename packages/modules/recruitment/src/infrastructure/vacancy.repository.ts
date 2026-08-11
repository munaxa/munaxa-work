import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { VacancyState } from '../domain/vacancy.js';
import type { Page, VacancyQuery, VacancyStore } from '../application/recruitment-ports.js';

import {
  VACANCY_COLUMNS,
  toVacancy,
  vacancyInsert,
  vacancyUpdate,
  type VacancyRow,
} from './recruitment-rows.js';
import { vacancyFilters } from './recruitment-search.js';
import { insertRow, pageOf } from './row-writer.js';

export class VacancyRepository
  extends Repository<{ id: string; version: number }>
  implements VacancyStore
{
  public constructor() {
    super('recruitment_vacancy');
  }

  public async byId(transaction: Transaction, id: string): Promise<VacancyState | undefined> {
    const rows = await transaction.execute<VacancyRow>(
      `select ${VACANCY_COLUMNS} from recruitment_vacancy v
        where v.id = $1 and v.tenant_id = $2 and v.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toVacancy(row);
  }

  public async forRequisition(
    transaction: Transaction,
    requisitionId: string,
  ): Promise<readonly VacancyState[]> {
    const rows = await transaction.execute<VacancyRow>(
      `select ${VACANCY_COLUMNS} from recruitment_vacancy v
        where v.tenant_id = $1 and v.requisition_id = $2 and v.deleted_at is null
        order by v.created_at`,
      [transaction.tenantId, requisitionId],
    );
    return rows.map(toVacancy);
  }

  public search(transaction: Transaction, query: VacancyQuery): Promise<Page<VacancyState>> {
    const { where, parameters } = vacancyFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<VacancyRow, VacancyState>(
      transaction,
      {
        select: `select ${VACANCY_COLUMNS} from recruitment_vacancy v where ${where}
                 order by v.created_at desc limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from recruitment_vacancy v where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toVacancy,
    );
  }

  public async all(transaction: Transaction): Promise<readonly VacancyState[]> {
    const rows = await transaction.execute<VacancyRow>(
      `select ${VACANCY_COLUMNS} from recruitment_vacancy v
        where v.tenant_id = $1 and v.deleted_at is null order by v.created_at`,
      [transaction.tenantId],
    );
    return rows.map(toVacancy);
  }

  public async insert(transaction: Transaction, state: VacancyState): Promise<void> {
    await insertRow(transaction, this.table, vacancyInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: VacancyState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, vacancyUpdate(state));
  }
}
