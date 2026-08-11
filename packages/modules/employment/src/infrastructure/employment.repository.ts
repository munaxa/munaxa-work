import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { EmploymentState } from '../domain/employment.js';
import type { EmploymentQuery, EmploymentStore, Page } from '../application/employment-ports.js';

import {
  COLUMNS,
  toInsertValues,
  toState,
  toUpdateValues,
  type EmploymentRow,
} from './employment-row.js';
import { filtersFor } from './employment-search.js';
import { insertRow } from './row-writer.js';

export class EmploymentRepository
  extends Repository<{ id: string; version: number }>
  implements EmploymentStore
{
  public constructor() {
    super('employment');
  }

  public async byId(transaction: Transaction, id: string): Promise<EmploymentState | undefined> {
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.id = $1 and e.tenant_id = $2 and e.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  /** Case-insensitive, matching the unique index rather than merely resembling it. */
  public async byNumber(
    transaction: Transaction,
    employmentNumber: string,
  ): Promise<EmploymentState | undefined> {
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.tenant_id = $1 and lower(e.employment_number) = lower($2) and e.deleted_at is null`,
      [transaction.tenantId, employmentNumber],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly EmploymentState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.tenant_id = $1 and e.id = any($2::uuid[]) and e.deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toState);
  }

  /** Newest first: a rehire history is read from the current employment backwards. */
  public async forPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<readonly EmploymentState[]> {
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.tenant_id = $1 and e.person_id = $2 and e.deleted_at is null
        order by e.start_date desc, e.id desc`,
      [transaction.tenantId, personId],
    );
    return rows.map(toState);
  }

  /**
   * The person's employment that is not ended.
   *
   * Reads the same predicate the partial unique index is built on, so the check the domain makes
   * and the constraint the database enforces cannot disagree about what "open" means.
   */
  public async openForPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<EmploymentState | undefined> {
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.tenant_id = $1 and e.person_id = $2
          and e.status <> 'ended' and e.deleted_at is null`,
      [transaction.tenantId, personId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  public async search(
    transaction: Transaction,
    query: EmploymentQuery,
  ): Promise<Page<EmploymentState>> {
    const { where, parameters } = filtersFor(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e where ${where}
        order by e.employment_number limit ${limit} offset ${offset}`,
      [...parameters, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from employment e where ${where}`,
      parameters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async all(transaction: Transaction): Promise<readonly EmploymentState[]> {
    const rows = await transaction.execute<EmploymentRow>(
      `select ${COLUMNS} from employment e
        where e.tenant_id = $1 and e.deleted_at is null order by e.employment_number`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: EmploymentState): Promise<void> {
    await insertRow(transaction, 'employment', toInsertValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: EmploymentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, toUpdateValues(state));
  }
}
