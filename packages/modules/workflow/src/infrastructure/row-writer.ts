import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Compensation's, Leave's, Attendance's, Onboarding's, Recruitment's, Payroll's,
 * Documents', Performance's, Learning's and Career's file rather than an import of one: a module may
 * not reach into another module's internals, and hoisting it into `@work/persistence` is a change to
 * a package every phase depends on, recorded as debt rather than made inside a business phase.
 * **This is the eleventh copy**, and the debt is restated in this phase's report.
 *
 * **Workflow holds no `bigint`, no `numeric`, no money column and nothing a tenant types as a
 * number.** Two numbers exist — a version number and a step ordinal — and both are `integer`
 * columns the schema bounds below at one and deliberately does not bound above (AD-004), plus the
 * `integer` optimistic-concurrency column every table carries. `asNumber` on an already-integral
 * column is therefore the only numeric conversion on this path.
 *
 * **There is no civil-date helper here, and its absence is deliberate.** Career needs one because a
 * target date is a day; Workflow has no `date` column at all, because a request, a decision and a
 * step becoming current are moments rather than days. Every temporal column on this path is a
 * `timestamptz`, which the driver returns as a `Date` carrying an absolute instant — no local
 * midnight is involved and there is no day to lose.
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

/** Postgres returns `count(*)` and some integral types as strings; a count must be a number. */
export const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

/**
 * A page of rows and the total behind it, counted with the same predicate.
 *
 * The count runs the *same* `where` and the same parameters as the page — a total computed from a
 * different predicate is the bug that shows "1 of 40" on a screen holding forty rows. It is also why
 * a `total` can never be `items.length`: that would be the size of the page, and an approver with
 * three hundred approvals waiting would be told they have fifty.
 *
 * **Both statements run in the database.** Nothing here reads a table and slices it in JavaScript,
 * which is the shape that turns a bounded read into a tenant-wide one the first time a tenant grows.
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

/** A value or SQL's `null`. One function rather than a `??` at every call site. */
export const orNull = <TValue>(value: TValue | undefined): TValue | null => value ?? null;

/**
 * A row's nullable columns as an object with the nulls dropped.
 *
 * `exactOptionalPropertyTypes` distinguishes "key absent" from "key present, value undefined", so a
 * mapper must not write `undefined` into an optional field. It drops `null` **and** `undefined`, and
 * nothing else: an ordinal of zero would survive — though the schema refuses one — and so do an
 * empty comment and `false`.
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
 * change. Building a second, hand-maintained list for updates is how a column comes to be written on
 * insert and silently ignored on update.
 */
export const mutable = (values: RowValues): RowValues => {
  const { id: _id, tenant_id: _tenantId, ...rest } = values;

  return rest;
};

/** One optional filter: a column, the value the caller gave (or nothing), and an optional operator. */
export interface Filter {
  readonly column: string;
  readonly value: string | undefined;
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
