import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * **No score passes through a floating-point value on this path.**
 *
 * Every score in this module is an integer column holding hundredths, and every weight is an
 * integer column holding basis points, so the only conversion is `asNumber` on an already-integral
 * value. `parseFloat` appears nowhere in this module, and `Number()` is applied to counts, versions
 * and integer scores — never to a `numeric` column, because there is no `numeric` column to apply
 * it to. That is the whole of the exactness guarantee, and it is a property of the schema rather
 * than of anybody remembering.
 */

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Compensation's, Leave's, Attendance's, Onboarding's, Recruitment's and Payroll's
 * file rather than an import of one: a module may not reach into another module's internals, and
 * hoisting it into `@work/persistence` is a change to a package every phase depends on, recorded as
 * debt rather than made inside a business phase. **This is the eighth copy**, and the debt is
 * restated in the Phase 13 report.
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
export const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

/**
 * An observed value, as an exact `bigint`.
 *
 * The driver returns `bigint` columns as **strings** by default, precisely so nothing above 2^53 is
 * silently mangled. A recorded measurement can exceed what a double represents exactly, and one that rounded
 * would make a key result unfalsifiable.
 */
export const asBigInt = (value: unknown): bigint =>
  typeof value === 'bigint' ? value : BigInt(String(value));

/**
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so
 * a due date read on a server west of UTC comes back as the previous day — which would report a
 * goal as overdue a day early. Every date column here is selected with `to_char(..., 'YYYY-MM-DD')`
 * so the value that leaves the database is the value that was stored.
 *
 * The alias is separate from the expression because a qualified column cannot be its own alias —
 * `as d.expiry_date` is a syntax error, and the one that reads as a mystery.
 */
export const civilDateColumn = (column: string, alias: string): string =>
  `to_char(${column}, 'YYYY-MM-DD') as ${alias}`;

/**
 * A page of rows and the total behind it, counted with the same predicate.
 *
 * The count runs the *same* `where` and the same parameters as the page — a total computed from a
 * different predicate is the bug that shows "1 of 40" on a screen holding forty rows. In this
 * module it would be worse than cosmetic: the count is what tells a caller how many out-of-scope
 * reviews were withheld, and it must agree with the rows.
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
 * mapper for a table with twenty nullable columns is twenty branches, which exceeds every
 * complexity budget the standards set and reads as a wall. The branch belongs here, once.
 */
export const orNull = <TValue>(value: TValue | undefined): TValue | null => value ?? null;

export const orUndefined = <TValue>(value: TValue | null): TValue | undefined =>
  value === null ? undefined : value;

/**
 * The columns an update may set: everything except the identity and the tenant.
 *
 * The same values object serves the insert and the update, minus the two columns nothing may ever
 * change. Building a second, hand-maintained list for updates is how a column comes to be written
 * on insert and silently ignored on update.
 */
export const mutable = (values: RowValues): RowValues => {
  const { id: _id, tenant_id: _tenantId, ...rest } = values;
  return rest;
};

/**
 * A row's nullable columns as an object with the nulls dropped.
 *
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", so a
 * mapper must not write `undefined` into an optional field. Spelling that out per column produces a
 * mapper with twenty conditional spreads, which exceeds every complexity budget the standards set
 * and reads as a wall. The branch belongs here, once.
 *
 * It drops `null` **and** `undefined`, and nothing else. A zero score, an empty string and `false`
 * all survive — which matters, because a final score of zero is a legitimate score and a mapper
 * that treated it as absent would quietly lose it.
 */
export type Defined<TShape> = {
  [TKey in keyof TShape]?: Exclude<TShape[TKey], null | undefined>;
};

export const presentOf = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== null && value !== undefined),
  ) as Defined<TShape>;

/** One optional filter: a column, the value the caller gave (or nothing), and an optional operator. */
export interface Filter {
  readonly column: string;
  readonly value: string | undefined;
  /** `=` unless a comparison is wanted — an expiry window needs `<=`. */
  readonly operator?: string;
}

export interface Predicate {
  readonly clause: string;
  readonly parameters: readonly unknown[];
  /** The next free placeholder, for the `limit` and `offset` a paged query appends. */
  readonly next: number;
}

/**
 * A `where` built from the filters that were actually given.
 *
 * The tenant clause and the soft-delete clause are **not** optional and are not part of the list: a
 * filter list that could omit the tenant is a filter list that eventually does.
 */
export const predicateFor = (
  alias: string,
  tenantId: string,
  filters: readonly Filter[],
): Predicate => {
  const clauses = [`${alias}.tenant_id = $1`, `${alias}.deleted_at is null`];
  const parameters: unknown[] = [tenantId];

  for (const filter of filters) {
    if (filter.value === undefined) continue;

    parameters.push(filter.value);
    clauses.push(`${filter.column} ${filter.operator ?? '='} $${String(parameters.length)}`);
  }
  return { clause: clauses.join(' and '), parameters, next: parameters.length + 1 };
};
