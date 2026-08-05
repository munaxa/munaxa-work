import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not
 * provide: it knows how to read, update, soft delete and restore any row, and stops short of
 * insert because the column list is the one thing that is genuinely per-table.
 *
 * This supplies the rest — the audit columns and the parameter placeholders — so that eight
 * repositories do not each write `created_at, created_by, updated_at, updated_by, deleted_at,
 * deleted_by, version` and each get one chance to omit one.
 */

export interface RowValues {
  readonly [column: string]: unknown;
}

/** Audit values, written by infrastructure. A caller cannot supply or override them. */
export const insertRow = async (
  transaction: Transaction,
  table: string,
  values: RowValues,
  now: Date,
): Promise<void> => {
  const audit: AuditColumns = auditForInsert(now);
  const row: RowValues = { ...values, ...audit };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`).join(', ');

  await transaction.execute(
    `insert into ${table} (${columns.join(', ')}) values (${placeholders})`,
    columns.map((column) => row[column]),
  );
};

/** `null` in a column, `undefined` in a domain state. Converted here rather than at eight sites. */
export const optional = <TValue>(value: TValue | null): TValue | undefined =>
  value === null ? undefined : value;

/** Postgres returns `numeric`-adjacent types as strings; `version` must be a number. */
export const asVersion = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);
