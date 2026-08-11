import { normalizeEmail, normalizeTelephone } from '../domain/recruitment-vocabulary.js';
import type {
  ApplicationQuery,
  CandidateQuery,
  RequisitionQuery,
  VacancyQuery,
} from '../application/recruitment-ports.js';

/**
 * The `where` clauses this module's searches compile to, and the parameters that go with them.
 *
 * Apart from the repositories for the reason every other module's filters are: a repository's
 * complexity budget is five, and seven optional filters exceed it by construction. This is assembly
 * rather than logic — no rule here decides anything.
 *
 * **Every filter is parameterised.** Nothing a caller sends is concatenated into SQL. The tenant
 * predicate is written even though row-level security would refuse the query anyway: two independent
 * guarantees rather than one, which is the whole shape of ADR-0030.
 *
 * **The candidate name search is a sequential scan, and that is stated rather than hidden.**
 * `ilike` is not leakproof, so PostgreSQL will not evaluate a trigram index ahead of the row-level
 * security qualifier; the policy is applied first and the pattern match runs over what survives.
 * The approved decision is to accept it, measure it and record the cause (A-9) — not to weaken
 * isolation to make a search look fast.
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

  public addTwo(clause: (first: string, second: string) => string, value: unknown): void {
    this.values.push(value);

    const placeholder = `$${String(this.values.length)}`;

    this.clauses.push(clause(placeholder, placeholder));
  }

  public compiled(): CompiledQuery {
    return { where: this.clauses.join(' and '), parameters: this.values };
  }
}

export const requisitionFilters = (tenantId: string, query: RequisitionQuery): CompiledQuery => {
  const clauses = new Clauses('r', tenantId);

  if (query.term !== undefined) {
    clauses.add((value) => `r.requisition_number ilike ${value}`, `%${query.term}%`);
  }
  if (query.status !== undefined) clauses.add((value) => `r.status = ${value}`, query.status);
  if (query.positionId !== undefined) {
    clauses.add((value) => `r.position_id = ${value}::uuid`, query.positionId);
  }
  if (query.unitId !== undefined)
    clauses.add((value) => `r.unit_id = ${value}::uuid`, query.unitId);
  if (query.hiringManagerEmploymentId !== undefined) {
    clauses.add(
      (value) => `r.hiring_manager_employment_id = ${value}::uuid`,
      query.hiringManagerEmploymentId,
    );
  }
  return clauses.compiled();
};

export const vacancyFilters = (tenantId: string, query: VacancyQuery): CompiledQuery => {
  const clauses = new Clauses('v', tenantId);

  if (query.status !== undefined) clauses.add((value) => `v.status = ${value}`, query.status);
  if (query.requisitionId !== undefined) {
    clauses.add((value) => `v.requisition_id = ${value}::uuid`, query.requisitionId);
  }
  return clauses.compiled();
};

/**
 * The candidate filters.
 *
 * `email` and `phone` are **normalized before they are compared**, exactly as they were normalized
 * before they were stored — a search for `Noura@Example.com ` that missed the row stored as
 * `noura@example.com` would send a recruiter on to create the duplicate this module exists to
 * prevent.
 */
export const candidateFilters = (tenantId: string, query: CandidateQuery): CompiledQuery => {
  const clauses = new Clauses('c', tenantId);

  if (query.term !== undefined) {
    clauses.addTwo(
      (first, second) =>
        `(c.candidate_number ilike ${first} or c.display_name->>'en' ilike ${second}
          or c.display_name->>'ar' ilike ${second})`,
      `%${query.term}%`,
    );
  }
  if (query.status !== undefined) clauses.add((value) => `c.status = ${value}`, query.status);
  if (query.email !== undefined) {
    clauses.add((value) => `c.email = ${value}`, normalizeEmail(query.email));
  }
  if (query.phone !== undefined) {
    clauses.add((value) => `c.phone = ${value}`, normalizeTelephone(query.phone));
  }
  if (query.sourceCode !== undefined) {
    clauses.add((value) => `c.source_code = ${value}`, query.sourceCode);
  }
  if (query.personId !== undefined) {
    clauses.add((value) => `c.person_id = ${value}::uuid`, query.personId);
  }
  if (query.profileCode !== undefined) {
    // `exists` rather than a join, so a candidate holding the same code twice appears once — a join
    // would return them twice, and a paged list whose totals count duplicates is a list nobody can
    // reconcile.
    clauses.add(
      (value) => `exists (
         select 1 from recruitment_candidate_profile_entry p
          where p.candidate_id = c.id and p.tenant_id = c.tenant_id and p.deleted_at is null
            and p.code = ${value})`,
      query.profileCode,
    );
  }
  return clauses.compiled();
};

export const applicationFilters = (tenantId: string, query: ApplicationQuery): CompiledQuery => {
  const clauses = new Clauses('a', tenantId);

  if (query.term !== undefined) {
    clauses.add((value) => `a.application_number ilike ${value}`, `%${query.term}%`);
  }
  if (query.status !== undefined) clauses.add((value) => `a.status = ${value}`, query.status);
  if (query.vacancyId !== undefined) {
    clauses.add((value) => `a.vacancy_id = ${value}::uuid`, query.vacancyId);
  }
  if (query.candidateId !== undefined) {
    clauses.add((value) => `a.candidate_id = ${value}::uuid`, query.candidateId);
  }
  if (query.stageCode !== undefined) {
    clauses.add((value) => `a.stage_code = ${value}`, query.stageCode);
  }
  if (query.unfinishedHire === true) {
    // The reconciliation query, and the reason `hire_state` exists at all: a hire that started and
    // did not finish is a row somebody must act on rather than a mystery (ADR-0046).
    return {
      where: `${clauses.compiled().where} and a.hire_state is not null
        and a.hire_state <> 'completed' and a.status <> 'hired'`,
      parameters: clauses.compiled().parameters,
    };
  }
  return clauses.compiled();
};
