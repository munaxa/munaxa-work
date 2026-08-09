import type { EmploymentQuery } from '../application/employment-ports.js';

/**
 * The `where` clause a workforce search compiles to, and the parameters that go with it.
 *
 * Apart from the repository for the same reason People's search filters are: a repository's
 * complexity budget is five, and eight optional filters exceed it by construction. This is
 * assembly rather than logic — no rule here decides anything.
 *
 * **Every filter is parameterised.** Nothing a caller sends is concatenated into SQL, including
 * the sort. The tenant predicate is written even though row-level security would refuse the query
 * anyway: two independent guarantees rather than one, which is the whole shape of ADR-0030.
 *
 * **The organizational filters are subqueries against the assignment timeline, resolved at
 * `asOf`.** Filtering on a column of `employment` would be filtering on a cached placement, and
 * this module deliberately has no such column — asking the timeline is what makes "who was in this
 * department last March" a question the search can answer at all.
 */

export interface CompiledQuery {
  readonly where: string;
  readonly parameters: readonly unknown[];
}

export const filtersFor = (tenantId: string, query: EmploymentQuery): CompiledQuery => {
  const clauses = ['e.tenant_id = $1', 'e.deleted_at is null'];
  const parameters: unknown[] = [tenantId];
  const next = (value: unknown): string => {
    parameters.push(value);
    return `$${String(parameters.length)}`;
  };

  if (query.term !== undefined) {
    const term = next(`%${query.term}%`);

    clauses.push(`(e.employment_number ilike ${term} or e.external_employee_number ilike ${term})`);
  }
  if (query.status !== undefined) clauses.push(`e.status = ${next(query.status)}`);
  if (query.personId !== undefined) clauses.push(`e.person_id = ${next(query.personId)}::uuid`);
  if (query.employmentTypeCode !== undefined) {
    clauses.push(`e.employment_type_code = ${next(query.employmentTypeCode)}`);
  }

  const placements = assignmentFilters(query);

  // The date is bound only when something reads it. A parameter that appears in no clause is a
  // parameter PostgreSQL cannot infer a type for, and the error it raises names the placeholder
  // rather than the filter that was missing.
  if (placements.length > 0 || query.managerEmploymentId !== undefined) {
    const asOf = next(query.asOf);

    for (const [column, value] of placements) {
      clauses.push(assignmentExists(column, next(value), asOf));
    }
    if (query.managerEmploymentId !== undefined) {
      clauses.push(reportsTo(next(query.managerEmploymentId), asOf));
    }
  }
  return { where: clauses.join(' and '), parameters };
};

const assignmentFilters = (query: EmploymentQuery): readonly [string, string][] => {
  const candidates: readonly [string, string | undefined][] = [
    ['unit_id', query.unitId],
    ['position_id', query.positionId],
    ['cost_center_id', query.costCenterId],
  ];

  return candidates.flatMap(([column, value]) =>
    value === undefined ? [] : [[column, value] as [string, string]],
  );
};

/**
 * An employment whose assignment on a date matches.
 *
 * `exists` rather than a join, so an employment with two assignments in the same unit appears once
 * — a join would return it twice, and a paged list whose page size means something different per
 * row is a list whose totals are wrong.
 */
const assignmentExists = (column: string, value: string, asOf: string): string =>
  `exists (
     select 1 from employment_assignment a
      where a.employment_id = e.id and a.tenant_id = e.tenant_id and a.deleted_at is null
        and a.${column} = ${value}::uuid
        and a.effective_from <= ${asOf}
        and (a.effective_to is null or a.effective_to > ${asOf}))`;

const reportsTo = (managerEmploymentId: string, asOf: string): string =>
  `exists (
     select 1 from employment_reporting_line r
      where r.employment_id = e.id and r.tenant_id = e.tenant_id and r.deleted_at is null
        and r.manager_employment_id = ${managerEmploymentId}::uuid
        and r.line_type = 'primary'
        and r.effective_from <= ${asOf}
        and (r.effective_to is null or r.effective_to > ${asOf}))`;
