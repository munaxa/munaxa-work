import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ChildStore } from '../application/employment-ports.js';

import { insertRow, type RowValues } from './row-writer.js';

/**
 * One repository for every child table of the Employment aggregate.
 *
 * Assignments, reporting lines and contracts share exactly one access pattern: read one by
 * identity, read an employment's, read several employments', insert, update. Three hand-written
 * repositories differing only in a column list would be three chances to omit `deleted_at is null`
 * from a query, and the one that omitted it would quietly serve closed periods for the rest of the
 * product's life.
 *
 * What is genuinely per-table — the columns and the two conversions — is supplied as a
 * `ChildTable`. What is not is written once, here.
 *
 * `forEmployments` is the reason the batched read exists at all: a workforce list resolves every
 * row's placement in one query rather than one per row, which is the N+1 §45 forbids and the
 * easiest one in this module to write by accident.
 */

export interface ChildTable<TState, TRow> {
  readonly table: string;
  /** The select list, including any `to_char` casts a date column needs. */
  readonly columns: string;
  /** Column to sort by when an employment's records are listed. */
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

  public async forEmployment(
    transaction: Transaction,
    employmentId: string,
  ): Promise<readonly TState[]> {
    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where tenant_id = $1 and employment_id = $2 and deleted_at is null
        order by ${this.definition.order}`,
      [transaction.tenantId, employmentId],
    );
    return rows.map((row) => this.definition.toState(row));
  }

  public async forEmployments(
    transaction: Transaction,
    employmentIds: readonly string[],
  ): Promise<readonly TState[]> {
    if (employmentIds.length === 0) return [];

    const rows = await transaction.execute<TRow>(
      `select ${this.definition.columns} from ${this.definition.table}
        where tenant_id = $1 and employment_id = any($2::uuid[]) and deleted_at is null
        order by ${this.definition.order}`,
      [transaction.tenantId, [...employmentIds]],
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
    const row = state as unknown as { readonly id: string };

    await this.updateRow(transaction, row.id, expected, this.definition.toUpdate(state));
  }
}
