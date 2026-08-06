import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PersonState } from '../domain/person.js';
import type { Page, PersonQuery, PersonStore } from '../application/people-ports.js';

import { COLUMNS, toInsertValues, toState, toUpdateValues, type PersonRow } from './person-row.js';
import { filtersFor } from './person-search.js';
import { insertRow } from './row-writer.js';

export class PersonRepository
  extends Repository<{ id: string; version: number }>
  implements PersonStore
{
  public constructor() {
    super('person');
  }

  public async byId(transaction: Transaction, id: string): Promise<PersonState | undefined> {
    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  /** Case-insensitive, matching the unique index rather than merely resembling it. */
  public async byNumber(
    transaction: Transaction,
    personNumber: string,
  ): Promise<PersonState | undefined> {
    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p
        where p.tenant_id = $1 and lower(p.person_number) = lower($2) and p.deleted_at is null`,
      [transaction.tenantId, personNumber],
    );
    const row = rows[0];

    return row === undefined ? undefined : toState(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly PersonState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p
        where p.tenant_id = $1 and p.id = any($2::uuid[]) and p.deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toState);
  }

  public async byDateOfBirth(
    transaction: Transaction,
    dateOfBirth: string,
    limit: number,
  ): Promise<readonly PersonState[]> {
    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p
        where p.tenant_id = $1 and p.date_of_birth = $2::date and p.deleted_at is null
        order by p.id limit $3`,
      [transaction.tenantId, dateOfBirth, limit],
    );
    return rows.map(toState);
  }

  public async search(transaction: Transaction, query: PersonQuery): Promise<Page<PersonState>> {
    const { where, parameters } = filtersFor(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;
    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p where ${where}
        order by p.person_number limit ${limit} offset ${offset}`,
      [...parameters, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from person p where ${where}`,
      parameters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async all(transaction: Transaction): Promise<readonly PersonState[]> {
    const rows = await transaction.execute<PersonRow>(
      `select ${COLUMNS} from person p
        where p.tenant_id = $1 and p.deleted_at is null order by p.person_number`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: PersonState): Promise<void> {
    await insertRow(transaction, 'person', toInsertValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PersonState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, toUpdateValues(state));
  }
}
