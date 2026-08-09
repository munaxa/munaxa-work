import type { OnboardingQuery, PlanQuery, TaskQuery } from '../application/onboarding-ports.js';

/**
 * The `where` clauses this module's searches compile to, and the parameters that go with them.
 *
 * Apart from the repositories for the reason every other module's filters are: a repository's
 * complexity budget is five, and eight optional filters exceed it by construction. This is assembly
 * rather than logic — no rule here decides anything.
 *
 * **Every filter is parameterised.** Nothing a caller sends is concatenated into SQL. The tenant
 * predicate is written even though row-level security would refuse the query anyway: two independent
 * guarantees rather than one, which is the whole shape of ADR-0030.
 *
 * **Overdue is a comparison, not a column.** Both compiled forms below take the caller's civil date
 * and compare `due_on` to it — they never reach for the database's `current_date`. A store that
 * asked the server what day it is would answer differently from the clock the handler injected, and
 * the disagreement would surface as a task that is overdue on one screen and not on another.
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

  /**
   * A clause that binds nothing.
   *
   * Separate from `add` because a parameter pushed and never referenced is not harmless: PostgreSQL
   * refuses a bind whose parameter count exceeds what the statement uses, so the query fails at the
   * driver with a message about counts rather than about the filter that caused it.
   */
  public addLiteral(clause: string): void {
    this.clauses.push(clause);
  }

  public compiled(): CompiledQuery {
    return { where: this.clauses.join(' and '), parameters: this.values };
  }
}

export const planFilters = (tenantId: string, query: PlanQuery): CompiledQuery => {
  const clauses = new Clauses('p', tenantId);

  if (query.status !== undefined) clauses.add((value) => `p.status = ${value}`, query.status);
  if (query.code !== undefined) clauses.add((value) => `p.code = ${value}`, query.code);
  return clauses.compiled();
};

/**
 * An onboarding search.
 *
 * `overdueAsOf` compiles to an `exists` over the instance's tasks rather than a join, so an instance
 * with twelve overdue tasks is still one row on the page — a join would return it twelve times and
 * the total beside it would be a number nobody could explain.
 */
export const onboardingFilters = (tenantId: string, query: OnboardingQuery): CompiledQuery => {
  const clauses = new Clauses('o', tenantId);

  if (query.state !== undefined) clauses.add((value) => `o.state = ${value}`, query.state);
  if (query.planId !== undefined) clauses.add((value) => `o.plan_id = ${value}::uuid`, query.planId);
  if (query.employmentId !== undefined) {
    clauses.add((value) => `o.employment_id = ${value}::uuid`, query.employmentId);
  }
  if (query.plannedStartFrom !== undefined) {
    clauses.add((value) => `o.planned_start_on >= ${value}::date`, query.plannedStartFrom);
  }
  if (query.plannedStartTo !== undefined) {
    clauses.add((value) => `o.planned_start_on <= ${value}::date`, query.plannedStartTo);
  }
  if (query.overdueAsOf !== undefined) {
    clauses.add(
      (value) => `exists (
        select 1 from onboarding_task d
         where d.tenant_id = o.tenant_id and d.onboarding_id = o.id and d.deleted_at is null
           and d.required and d.status not in ('done', 'waived', 'cancelled')
           and d.due_on is not null and d.due_on < ${value}::date)`,
      query.overdueAsOf,
    );
  }
  return clauses.compiled();
};

/** A task search: the queue an owner opens, and the overdue list HR opens. */
export const taskFilters = (tenantId: string, query: TaskQuery): CompiledQuery => {
  const clauses = new Clauses('k', tenantId);

  if (query.onboardingId !== undefined) {
    clauses.add((value) => `k.onboarding_id = ${value}::uuid`, query.onboardingId);
  }
  if (query.ownerKind !== undefined) {
    clauses.add((value) => `k.owner_kind = ${value}`, query.ownerKind);
  }
  if (query.ownerRef !== undefined) {
    clauses.add((value) => `k.owner_ref = ${value}::uuid`, query.ownerRef);
  }
  if (query.ownerRole !== undefined) {
    clauses.add((value) => `k.owner_role = ${value}`, query.ownerRole);
  }
  if (query.status !== undefined) clauses.add((value) => `k.status = ${value}`, query.status);
  if (query.kind !== undefined) clauses.add((value) => `k.kind = ${value}`, query.kind);
  if (query.requiredOnly === true) clauses.addLiteral('k.required');
  if (query.overdueAsOf !== undefined) {
    clauses.add(
      (value) =>
        `k.status not in ('done', 'waived', 'cancelled') and k.due_on is not null and k.due_on < ${value}::date`,
      query.overdueAsOf,
    );
  }
  return clauses.compiled();
};
