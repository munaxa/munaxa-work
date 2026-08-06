import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ChildStore } from '../application/people-ports.js';

import { insertRow, type RowValues } from './row-writer.js';

/**
 * One repository for every child table of the Person aggregate.
 *
 * Ten tables — names, nationalities, contacts, addresses, emergency contacts, preferences,
 * capabilities, history, tags, notes — share exactly one access pattern: read one by identity,
 * read a person's, read several people's, insert, update. Ten hand-written repositories differing
 * only in a column list would be ten chances to omit `deleted_at is null` from a query, and the
 * one that omitted it would quietly serve withdrawn records for the rest of the product's life.
 *
 * What is genuinely per-table — the columns, and the two functions that convert a row to domain
 * state and back — is supplied as a `ChildTable`. What is not is written once, here.
 *
 * Two repositories do *not* use this base, and both for a real reason: identifiers and contacts
 * each carry an extra lookup that duplicate detection depends on.
 */

export interface ChildTable<TState, TRow> {
  readonly table: string;
  /** The select list, including any `to_char` casts a date column needs. */
  readonly columns: string;
  /** Column to sort by when a person's records are listed. */
  readonly order: string;
  toState(row: TRow): TState;
  toInsert(state: TState): RowValues;
  toUpdate(state: TState): RowValues;
}

/**
 * What every child row has in common.
 *
 * `version` is `number | string` because the driver returns integer-adjacent types as strings on
 * some column types, and a base class that insisted on `number` would force every definition to
 * lie about what the database actually hands back.
 */
interface ChildRow {
  readonly id: string;
  readonly version: number | string;
}

export class ChildRepository<TState, TRow extends ChildRow>
  extends Repository<{ id: string; version: number }>
  implements ChildStore<TState>
{
  public constructor(private readonly definition: ChildTable<TState, TRow>) {
    super(definition.table);
  }

  public async byId(transaction: Transaction, id: string): Promise<TState | undefined> {
    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : this.definition.toState(row);
  }

  public async forPerson(transaction: Transaction, personId: string): Promise<readonly TState[]> {
    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where tenant_id = $1 and person_id = $2 and deleted_at is null
        order by ${this.definition.order}`,
      [transaction.tenantId, personId],
    );
    return rows.map((row) => this.definition.toState(row));
  }

  /**
   * Several people at once, so a list of twenty people is one query rather than twenty.
   *
   * The empty case short-circuits: `= any('{}')` is a valid query that reads the table and returns
   * nothing, and issuing it for every empty page is a read nobody needs.
   */
  public async forPeople(
    transaction: Transaction,
    personIds: readonly string[],
  ): Promise<readonly TState[]> {
    if (personIds.length === 0) return [];

    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where tenant_id = $1 and person_id = any($2::uuid[]) and deleted_at is null
        order by ${this.definition.order}`,
      [transaction.tenantId, [...personIds]],
    );
    return rows.map((row) => this.definition.toState(row));
  }

  public async all(transaction: Transaction): Promise<readonly TState[]> {
    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where tenant_id = $1 and deleted_at is null order by ${this.definition.order}`,
      [transaction.tenantId],
    );
    return rows.map((row) => this.definition.toState(row));
  }

  public async insert(transaction: Transaction, state: TState): Promise<void> {
    await insertRow(
      transaction,
      this.definition.table,
      this.definition.toInsert(state),
      new Date(),
    );
  }

  public async update(transaction: Transaction, state: TState, expected: number): Promise<void> {
    const row = this.definition.toInsert(state);

    await this.updateRow(transaction, String(row['id']), expected, this.definition.toUpdate(state));
  }
}
