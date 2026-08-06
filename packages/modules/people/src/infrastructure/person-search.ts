import type { PersonQuery } from '../application/people-ports.js';

/**
 * The `where` clause and its parameters, built together.
 *
 * Built together rather than as a fixed placeholder list with nulls for the unused filters,
 * because PostgreSQL refuses a statement carrying a parameter the query never references — it
 * cannot infer a type for something that appears nowhere. An unfiltered search is the *ordinary*
 * case, so that shape would have failed on the first page of the register. The integration suite
 * caught it.
 *
 * Two of these filters are the reason this module's PII protections are not merely a view
 * concern. The identifier filter takes a **digest**, computed by the application before the query
 * is issued, so a search for a passport number never reaches a query plan, a slow-query log or a
 * monitoring trace. The contact filter takes a normalized value, for the same reason.
 */
interface Filter {
  readonly value: unknown;
  clause(placeholder: string): string;
}

const filtersOf = (query: PersonQuery): readonly Filter[] =>
  [
    { value: query.status, clause: (p: string) => `p.status = ${p}` },
    {
      value: query.term === undefined ? undefined : `%${query.term}%`,
      clause: (p: string) => `(p.person_number ilike ${p} or exists (
         select 1 from person_name n
          where n.tenant_id = p.tenant_id and n.person_id = p.id and n.deleted_at is null
            and (n.legal_name->>'en' ilike ${p} or n.legal_name->>'ar' ilike ${p}
                 or n.preferred_name->>'en' ilike ${p} or n.preferred_name->>'ar' ilike ${p})))`,
    },
    {
      value: query.identifierMatchKey,
      clause: (p: string) => `exists (select 1 from person_identifier i
         where i.tenant_id = p.tenant_id and i.person_id = p.id and i.deleted_at is null
           and i.withdrawn_at is null and i.match_key = ${p})`,
    },
    {
      value: query.contactValue,
      clause: (p: string) => `exists (select 1 from person_contact c
         where c.tenant_id = p.tenant_id and c.person_id = p.id and c.deleted_at is null
           and c.value = ${p})`,
    },
    {
      value: query.tagCode,
      clause: (p: string) => `exists (select 1 from person_tag t
         where t.tenant_id = p.tenant_id and t.person_id = p.id and t.deleted_at is null
           and t.withdrawn_at is null and lower(t.tag_code) = lower(${p}))`,
    },
    {
      value: query.capabilityCode,
      clause: (p: string) => `exists (select 1 from person_capability k
         where k.tenant_id = p.tenant_id and k.person_id = p.id and k.deleted_at is null
           and k.withdrawn_at is null and k.capability_code = ${p})`,
    },
    {
      value: query.nationality,
      clause: (p: string) => `exists (select 1 from person_nationality na
         where na.tenant_id = p.tenant_id and na.person_id = p.id and na.deleted_at is null
           and na.withdrawn_at is null and na.country_code = ${p})`,
    },
  ].filter((filter) => filter.value !== undefined);

export interface Filtered {
  readonly where: string;
  readonly parameters: readonly unknown[];
}

export const filtersFor = (tenantId: string, query: PersonQuery): Filtered => {
  const parameters: unknown[] = [tenantId];
  const clauses = ['p.tenant_id = $1', 'p.deleted_at is null'];

  for (const filter of filtersOf(query)) {
    parameters.push(filter.value);
    clauses.push(filter.clause(`$${String(parameters.length)}`));
  }
  return { where: clauses.join(' and '), parameters };
};
