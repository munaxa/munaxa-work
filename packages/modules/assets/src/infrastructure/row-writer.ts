import { auditForInsert, type AuditColumns } from '@work/persistence';
import type { Transaction } from '@work/kernel';

/**
 * The insert half of persistence, which the shared `Repository` base deliberately does not provide:
 * it knows how to read, update, soft delete and restore any row, and stops short of insert because
 * the column list is the one thing that is genuinely per-table.
 *
 * A near-copy of Compensation's, Leave's, Attendance's, Onboarding's, Recruitment's, Payroll's,
 * Documents' and Relations' file rather than an import of one: a module may not reach into another
 * module's internals, and hoisting it into `@work/persistence` is a change to a package every phase
 * depends on, recorded as debt rather than made inside a business phase. **This is the ninth copy**,
 * and still the smallest — the helpers this module does not need are absent rather than carried
 * across, so nothing here is dead code waiting for a caller. `civilDateColumn` returned in Checkpoint
 * 2 because custody records days; `asBigInt` is still absent because nothing here holds a file.
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
 * A civil date, selected as text rather than as a `date`.
 *
 * The driver turns a `date` column into a JavaScript `Date` at the *process's* local midnight, so a
 * day read on a server west of UTC comes back as the previous one. Every date column here is selected
 * with `to_char(..., 'YYYY-MM-DD')` so the value that leaves the database is the value that was
 * stored — the defect Phase 5.2's Checkpoint 3 found after three checkpoints of not noticing.
 *
 * Checkpoint 1 omitted this helper because neither of its tables held a date. `asset_custody` holds
 * two, so it is back, and it is back *before* there is a defect rather than after one.
 *
 * The alias is separate from the expression because a qualified column cannot be its own alias —
 * `as c.issued_on` is a syntax error, and the one that reads as a mystery.
 */
export const civilDateColumn = (column: string, alias: string): string =>
  `to_char(${column}, 'YYYY-MM-DD') as ${alias}`;

/** Postgres returns `numeric`-adjacent types as strings; a count or a version must be a number. */
export const asNumber = (value: unknown): number =>
  typeof value === 'number' ? value : Number(value);

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
 * mapper for a table with several nullable columns is several branches, which walks toward the
 * complexity budget and reads as a wall. The branch belongs here, once.
 */
export const orNull = <TValue>(value: TValue | undefined): TValue | null => value ?? null;

export const orUndefined = <TValue>(value: TValue | null): TValue | undefined =>
  value === null ? undefined : value;

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

/** One optional filter: a column and the value the caller gave, or nothing. */
export interface Filter {
  readonly column: string;
  readonly value: string | undefined;
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
    clauses.push(`${filter.column} = $${String(parameters.length)}`);
  }
  return { clause: clauses.join(' and '), parameters, next: parameters.length + 1 };
};
