import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * This supplies the rest — the audit columns and the parameter placeholders — so six repositories do
 * not each write `created_at, created_by, updated_at, updated_by, version` and each get one chance
 * to omit one.
 *
 * It is a near-copy of Recruitment's file rather than an import of it: a module may not reach into
 * another module's internals, and hoisting this into `@work/persistence` is a change to a package
 * every phase depends on, recorded as debt rather than made inside a business phase.
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

/** Postgres returns `numeric`-adjacent types as strings; `version` must be a number. */
export const asVersion = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

/**
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so a
 * due date read on a server west of UTC comes back as the previous day — which is a task that looks
 * overdue on the morning it is due. Every date column in this module is selected with
 * `to_char(..., 'YYYY-MM-DD')` so the value that leaves the database is the value that was stored.
 *
 * The alias is separate from the expression because a qualified column (`t.due_on`) cannot be its
 * own alias — `as t.due_on` is a syntax error, and the one that reads as a mystery.
 */
export const civilDateColumn = (column: string, alias: string): string =>
  `to_char(${column}, 'YYYY-MM-DD') as ${alias}`;

/**
 * A page of rows and the total behind it, counted with the same predicate.
 *
 * The count runs the *same* `where` and the same parameters as the page — a total computed from a
 * different predicate is the bug that shows "1 of 40" on a screen holding forty rows. The paging
 * parameters are passed separately rather than trimmed off the list, so the two queries cannot drift
 * apart by an off-by-one.
 */
export const pageOf = async <TRow, TState>(
  transaction: Transaction,
  sql: {
    readonly select: string;
    readonly count: string;
    readonly parameters: readonly unknown[];
    readonly limit: number;
    readonly offset: number;
  },
  toState: (row: TRow) => TState,
): Promise<{ readonly items: readonly TState[]; readonly total: number }> => {
  const rows = await transaction.execute<TRow>(sql.select, [
    ...sql.parameters,
    sql.limit,
    sql.offset,
  ]);
  const counted = await transaction.execute<{ total: string }>(sql.count, sql.parameters);

  return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
};
