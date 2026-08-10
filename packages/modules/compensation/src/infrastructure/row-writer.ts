import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Leave's, Attendance's, Onboarding's and Recruitment's file rather than an import
 * of one: a module may not reach into another module's internals, and hoisting it into
 * `@work/persistence` is a change to a package every phase depends on, recorded as debt rather than
 * made inside a business phase.
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
 * A monetary column, as an exact `bigint`.
 *
 * The driver returns `bigint` columns as **strings** by default, precisely so nothing above 2^53 is
 * silently mangled. That is the behaviour this module wants and depends on: `BigInt(value)` is
 * exact, and there is no path anywhere in this module that turns an amount into a `number`.
 */
export const asBigInt = (value: unknown): bigint =>
  typeof value === 'bigint' ? value : BigInt(String(value));

/** A monetary value on its way into the database — a decimal string the driver stores exactly. */
export const asMinorUnits = (value: bigint): string => value.toString();

/**
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so an
 * effective-from read on a server west of UTC comes back as the previous day — which would move
 * somebody's raise to the wrong day. Every date column here is selected with
 * `to_char(..., 'YYYY-MM-DD')` so the value that leaves the database is the value that was stored.
 *
 * The alias is separate from the expression because a qualified column (`r.effective_from`) cannot
 * be its own alias — `as r.effective_from` is a syntax error, and the one that reads as a mystery.
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

/** A nullable monetary column on its way in: the minor units as a string, or SQL's `null`. */
export const orNullMinor = (value: bigint | undefined): string | null =>
  value === undefined ? null : value.toString();

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

/** One optional filter: a column, the value the caller gave (or nothing), and an optional cast. */
export interface Filter {
  readonly column: string;
  readonly value: string | undefined;
  readonly cast?: string;
  /** `=` unless a comparison is wanted — a date range needs `>=` and `<=`. */
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
 * filter list that could omit the tenant is a filter list that eventually does. In this module that
 * matters more than in any other — a compensation query that lost its tenant clause would put one
 * customer's salaries in front of another's.
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
    clauses.push(
      `${filter.column} ${filter.operator ?? '='} $${String(parameters.length)}${filter.cast ?? ''}`,
    );
  }
  return { clause: clauses.join(' and '), parameters, next: parameters.length + 1 };
};
