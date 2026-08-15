import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Compensation's, Leave's, Attendance's, Onboarding's, Recruitment's, Payroll's,
 * Documents', Performance's and Learning's file rather than an import of one: a module may not reach
 * into another module's internals, and hoisting it into `@work/persistence` is a change to a package
 * every phase depends on, recorded as debt rather than made inside a business phase. **This is the
 * tenth copy**, and the debt is restated in this phase's report.
 *
 * **Career holds no `bigint`, no `numeric`, no money column and nothing a tenant types as a
 * number.** Every number here is a `smallint` the schema constrains — a stage's position, a
 * successor's rank, a readiness level's ordinal — plus the `integer` version column. `asNumber` on
 * an already-integral column is therefore the only numeric conversion on this path, and there is no
 * value anywhere in this module whose exactness a JavaScript `number` could lose.
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

/**
 * The same insert, yielding to a row the database already holds — **and saying which happened**.
 *
 * `on conflict do nothing` with `returning id`: zero rows back means a partial unique index refused
 * it, which is what makes a retried nomination or a retried pool assignment converge (§15). A
 * `select` followed by an `insert` would be two statements with a gap between them, and the gap is
 * exactly where two managers pressing the same button both find nothing and both write.
 *
 * It is deliberately **not** `on conflict do update`: converging on the row that exists is not the
 * same as overwriting it, and a retried "add to pool" must not restamp the day somebody joined.
 */
export const insertRowIfAbsent = async (
  transaction: Transaction,
  table: string,
  values: RowValues,
  now: Date,
): Promise<boolean> => {
  const audit: AuditColumns = auditForInsert(now);
  const row: RowValues = { ...values, ...audit };
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${String(index + 1)}`).join(', ');

  const written = await transaction.execute<{ id: string }>(
    `insert into ${table} (${columns.join(', ')}) values (${placeholders})
       on conflict do nothing returning id`,
    columns.map((column) => row[column]),
  );

  return written.length > 0;
};

/** Postgres returns `count(*)` and some integral types as strings; a count must be a number. */
export const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

/**
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so a
 * target date read on a server west of UTC comes back as the previous day — which would report a
 * development item overdue a day early and a mobility recommendation expired a day early. Every date
 * column in this module is selected with `to_char(..., 'YYYY-MM-DD')` so the value that leaves the
 * database is the value that was stored, and the domain compares the same strings it was given
 * (D-11).
 *
 * **There is no `Date` anywhere on a Career civil-date path**, in either direction: a string goes
 * in as a parameter against a `date` column, and a string comes back out of `to_char`. PostgreSQL
 * does the parsing, which is also what makes `2026-02-30` a refusal rather than a silent roll into
 * March — the defect Checkpoint 2 found in the repository's shared `isCivilDate`.
 *
 * The alias is separate from the expression because a qualified column cannot be its own alias —
 * `as p.started_on` is a syntax error, and the one that reads as a mystery.
 */
export const civilDateColumn = (column: string, alias: string): string =>
  `to_char(${column}, 'YYYY-MM-DD') as ${alias}`;

/**
 * A page of rows and the total behind it, counted with the same predicate.
 *
 * The count runs the *same* `where` and the same parameters as the page — a total computed from a
 * different predicate is the bug that shows "1 of 40" on a screen holding forty rows. It is also
 * why a `total` can never be `items.length`: that would be the size of the page, and a bench of
 * sixty successors would report as fifty.
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
 * mapper for a table with a dozen nullable columns is a dozen branches, which exceeds every
 * complexity budget the standards set and reads as a wall. The branch belongs here, once.
 */
export const orNull = <TValue>(value: TValue | undefined): TValue | null => value ?? null;

/**
 * A row's nullable columns as an object with the nulls dropped.
 *
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", so a
 * mapper must not write `undefined` into an optional field. It drops `null` **and** `undefined`, and
 * nothing else: a `rank` of zero would survive — though the schema refuses one — and so do an empty
 * note and `false`.
 */
export type Defined<TShape> = {
  [TKey in keyof TShape]?: Exclude<TShape[TKey], null | undefined>;
};

export const presentOf = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== null && value !== undefined),
  ) as Defined<TShape>;

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

/** One optional filter: a column, the value the caller gave (or nothing), and an optional operator. */
export interface Filter {
  readonly column: string;
  readonly value: string | undefined;
  /** `=` unless a comparison is wanted — a "reviews due" window needs `<=`. */
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
 * filter list that could omit the tenant is a filter list that eventually does. Row-level security
 * enforces the tenant again at the table; this makes the intent legible in the query plan, which is
 * also what makes a plan inspection worth reading.
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

/**
 * The authorization bound, as SQL.
 *
 * An empty bound is an empty array rather than an absent clause. `= any('{}')` is false for every
 * row, which is what "this caller may see nothing" has to mean; omitting the clause would silently
 * mean "this caller may see everything", and that is the shape of every scope bug this repository
 * has found so far.
 */
export const boundClause = (
  bound: readonly string[] | undefined,
  column: string,
  parameters: unknown[],
): string | undefined => {
  if (bound === undefined) return undefined;

  parameters.push([...bound]);
  return `${column} = any($${String(parameters.length)}::uuid[])`;
};

/** A clause appended to a predicate that was already built, keeping the placeholder count right. */
export const withClause = (predicate: Predicate, clause: string | undefined): Predicate =>
  clause === undefined ? predicate : { ...predicate, clause: `${predicate.clause} and ${clause}` };
