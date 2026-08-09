import type {
  CorrectionQuery,
  DayQuery,
  EventQuery,
  ExceptionQuery,
} from '../application/attendance-ports.js';

/**
 * The `where` clauses this module's searches compile to, and the parameters that go with them.
 *
 * Apart from the repositories for the reason every other module's filters are: a repository's
 * complexity budget is five, and six optional filters exceed it by construction. This is assembly
 * rather than logic — no rule here decides anything.
 *
 * **Every filter is parameterised.** Nothing a caller sends is concatenated into SQL. The tenant
 * predicate is written even though row-level security would refuse the query anyway: two
 * independent guarantees rather than one, which is the whole shape of ADR-0030.
 *
 * **Every date filter compares against a `::date` cast of the caller's civil date**, never against
 * the database's `current_date`. A store that asked the server what day it is would answer
 * differently from the clock the handler injected, and the disagreement would surface as a day that
 * is late on one screen and not on another.
 */

export interface CompiledQuery {
  readonly where: string;
  readonly parameters: readonly unknown[];
}

/** Accumulates parameters so a filter cannot be written without binding its value. */
class Clauses {
  private readonly clauses: string[];

  private readonly values: unknown[];

  public constructor(alias: string, tenantId: string) {
    this.clauses = [`${alias}.tenant_id = $1`, `${alias}.deleted_at is null`];
    this.values = [tenantId];
  }

  public add(clause: (placeholder: string) => string, value: unknown): void {
    this.values.push(value);
    this.clauses.push(clause(`$${String(this.values.length)}`));
  }

  public compiled(): CompiledQuery {
    return { where: this.clauses.join(' and '), parameters: this.values };
  }
}

/** The window of dates every attendance search offers, written once. */
const withDates = (
  clauses: Clauses,
  alias: string,
  column: string,
  query: { readonly fromDate?: string; readonly toDate?: string },
): void => {
  if (query.fromDate !== undefined) {
    clauses.add((value) => `${alias}.${column} >= ${value}::date`, query.fromDate);
  }
  if (query.toDate !== undefined) {
    clauses.add((value) => `${alias}.${column} <= ${value}::date`, query.toDate);
  }
};

export const eventFilters = (tenantId: string, query: EventQuery): CompiledQuery => {
  const clauses = new Clauses('e', tenantId);

  if (query.employmentId !== undefined) {
    clauses.add((value) => `e.employment_id = ${value}::uuid`, query.employmentId);
  }
  if (query.source !== undefined) clauses.add((value) => `e.source = ${value}`, query.source);
  if (query.kind !== undefined) clauses.add((value) => `e.kind = ${value}`, query.kind);
  withDates(clauses, 'e', 'attendance_date', query);
  return clauses.compiled();
};

/**
 * A day search.
 *
 * `employmentIds` compiles to `= any(...)` rather than to a chain of `or`s, so the manager's view of
 * a team of forty is one predicate the index can use rather than forty the planner has to unpick.
 */
export const dayFilters = (tenantId: string, query: DayQuery): CompiledQuery => {
  const clauses = new Clauses('d', tenantId);

  if (query.employmentId !== undefined) {
    clauses.add((value) => `d.employment_id = ${value}::uuid`, query.employmentId);
  }
  if (query.employmentIds !== undefined) {
    clauses.add((value) => `d.employment_id = any(${value}::uuid[])`, [...query.employmentIds]);
  }
  if (query.state !== undefined) clauses.add((value) => `d.state = ${value}`, query.state);
  if (query.dayKind !== undefined) clauses.add((value) => `d.day_kind = ${value}`, query.dayKind);
  withDates(clauses, 'd', 'attendance_date', query);
  return clauses.compiled();
};

/** The queue an administrator lives in. Indexed on exactly the filters it offers. */
export const exceptionFilters = (tenantId: string, query: ExceptionQuery): CompiledQuery => {
  const clauses = new Clauses('x', tenantId);

  if (query.employmentId !== undefined) {
    clauses.add((value) => `x.employment_id = ${value}::uuid`, query.employmentId);
  }
  if (query.kind !== undefined) clauses.add((value) => `x.kind = ${value}`, query.kind);
  if (query.severity !== undefined) {
    clauses.add((value) => `x.severity = ${value}`, query.severity);
  }
  if (query.state !== undefined) clauses.add((value) => `x.state = ${value}`, query.state);
  withDates(clauses, 'x', 'attendance_date', query);
  return clauses.compiled();
};

export const correctionFilters = (tenantId: string, query: CorrectionQuery): CompiledQuery => {
  const clauses = new Clauses('n', tenantId);

  if (query.employmentId !== undefined) {
    clauses.add((value) => `n.employment_id = ${value}::uuid`, query.employmentId);
  }
  if (query.state !== undefined) clauses.add((value) => `n.state = ${value}`, query.state);
  if (query.kind !== undefined) clauses.add((value) => `n.kind = ${value}`, query.kind);
  return clauses.compiled();
};
