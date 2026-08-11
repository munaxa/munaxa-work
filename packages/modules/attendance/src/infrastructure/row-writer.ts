import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Onboarding's and Recruitment's file rather than an import of one: a module may not
 * reach into another module's internals, and hoisting it into `@work/persistence` is a change to a
 * package every phase depends on, recorded as debt rather than made inside a business phase.
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

/** Postgres returns `numeric`-adjacent types as strings; a count or a version must be a number. */
export const asVersion = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

/**
 * A `numeric` column, as a number or nothing.
 *
 * The driver returns `numeric` as a string to avoid losing precision, which is right for money and
 * wrong for a latitude — a coordinate that arrives as `"24.713600"` and is compared as a string
 * sorts between 3 and 25.
 */
export const asCoordinate = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'number' ? value : Number(value);
};

/**
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so
 * an attendance date read on a server west of UTC comes back as the previous day — which is the
 * whole class of bug this module exists to avoid. Every date column here is selected with
 * `to_char(..., 'YYYY-MM-DD')` so the value that leaves the database is the value that was stored.
 *
 * The alias is separate from the expression because a qualified column (`d.attendance_date`) cannot
 * be its own alias — `as d.attendance_date` is a syntax error, and the one that reads as a mystery.
 */
export const civilDateColumn = (column: string, alias: string): string =>
  `to_char(${column}, 'YYYY-MM-DD') as ${alias}`;

/**
 * A page of rows and the total behind it, counted with the same predicate.
 *
 * The count runs the *same* `where` and the same parameters as the page — a total computed from a
 * different predicate is the bug that shows "1 of 40" on a screen holding forty rows.
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

/**
 * A value or SQL's `null`, and a column or `undefined`.
 *
 * Two one-line functions rather than a `??` at every call site, and the reason is measurable: a
 * mapper for a table with thirty nullable columns is thirty branches, which exceeds every
 * complexity budget the standards set and reads as a wall. The branch belongs here, once.
 */
export const orNull = <TValue>(value: TValue | undefined): TValue | null => value ?? null;

export const orUndefined = <TValue>(value: TValue | null): TValue | undefined =>
  value === null ? undefined : value;
