import { runWithServiceGrant, type HandlerFailure, type Query, type Result } from '@work/kernel';
import type { IdentifierFacts, OwnerDirectoryPort, PersonIdentifierPort } from '@work/documents';
import type { PersonProfileView, PersonView } from '@work/people';
import type { EmploymentView } from '@work/employment';
import type { LegalEntityView } from '@work/organization';

import type { Asking } from '../payroll/asking.js';

/**
 * Documents' two cross-module adapters, and the whole of its outward surface.
 *
 * Both reach the owning modules through their **published queries**, never their repositories, and
 * each call runs inside a **bounded service grant** (ADR-0043). Filing a document must not make
 * somebody a reader of the person register or the employment register: the user is checked for the
 * *documents* operation, and the module holds the narrow cross-domain read for the length of one
 * call.
 *
 * Each grant here permits an **explicit list** of permissions — never a wildcard, never a prefix —
 * cannot nest, leaves the tenant, actor and correlation identifier untouched, and is logged.
 *
 * **Neither adapter writes anything.** There is no `create` and no `update` on either, and no
 * method that could change a fact in another module. The dependency points one way and Documents
 * pulls (ADR-0058, ADR-0064).
 *
 * One absence is load-bearing: **`people.identifier.read-value` is never granted.** Documents needs
 * to know that an identifier exists and when it expires; it has no business reading the passport
 * number, and a grant that included it would make filing a document a way to read one.
 */

const PERSON_READ = 'people.person.read';
const IDENTIFIER_READ = 'people.identifier.read';
const EMPLOYMENT_READ = 'employment.employment.read';
const LEGAL_ENTITY_READ = 'organization.legal-entity.read';

/**
 * The queries these adapters send, typed rather than asserted.
 *
 * Typed because the alternative — an object literal cast to bare `Query` — is what let the Phase 8
 * defect through: a value of the wrong shape reached a contract and the compiler could not see it,
 * because the cast had already discarded the shape.
 */
/**
 * The dispatcher's `ask`, with the query's own shape kept.
 *
 * `Dispatcher.ask` takes a bare `Query`, so a literal passed to it directly loses everything the
 * interfaces below declare. Threading the query type through one helper keeps the compiler checking
 * what is sent — which is what the Phase 8 defect needed and did not have.
 */
const asking = <TResult, TQuery extends Query>(
  dispatcher: Asking,
  query: TQuery,
): Promise<Result<TResult, HandlerFailure>> => dispatcher.ask<TResult>(query);

interface ReadPersonQuery extends Query {
  readonly queryName: 'people.read-person';
  readonly personId: string;
}

interface ReadProfileQuery extends Query {
  readonly queryName: 'people.read-profile';
  readonly personId: string;
}

interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
}

interface ListLegalEntitiesQuery extends Query {
  readonly queryName: 'organization.list-legal-entities';
}

/**
 * Whether the owner a document was filed against actually exists.
 *
 * `owner_type` + `owner_id` carries **no foreign key** — a polymorphic reference cannot, and Phase
 * 11 established that a cross-module foreign key would not enforce tenant isolation anyway
 * (ADR-0042). So the check is a published contract read, and an owner nobody can confirm is a
 * refusal rather than a row somebody has to explain in a year.
 *
 * An owner type this adapter does not know is `false` rather than an exception: the domain has
 * already refused anything outside its own vocabulary, so reaching here with one would be a defect
 * in this module, not a caller's problem.
 */
export class DocumentsOwnerDirectory implements OwnerDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async exists(ownerType: string, ownerId: string): Promise<boolean> {
    if (ownerType === 'person') return this.personExists(ownerId);
    if (ownerType === 'employment') return this.employmentExists(ownerId);
    if (ownerType === 'legal_entity') return this.legalEntityExists(ownerId);
    return false;
  }

  private async personExists(personId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'documents',
        operation: 'documents.create-document',
        permits: [PERSON_READ],
        reason: 'Confirming that the person a document is filed against exists',
      },
      () =>
        asking<PersonView, ReadPersonQuery>(this.dispatcher, {
          queryName: 'people.read-person',
          personId,
        }),
    );

    return found.ok;
  }

  private async employmentExists(employmentId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'documents',
        operation: 'documents.create-document',
        permits: [EMPLOYMENT_READ],
        reason: 'Confirming that the employment a document is filed against exists',
      },
      () =>
        asking<EmploymentView, ReadEmploymentQuery>(this.dispatcher, {
          queryName: 'employment.read-employment',
          employmentId,
        }),
    );

    return found.ok;
  }

  /**
   * Legal entities are listed rather than read by identifier.
   *
   * Organization publishes no single-entity read that takes an identifier and this module may not
   * reach past its contracts to invent one. The list is small — a tenant has a handful of legal
   * entities, not a workforce of them — so scanning it is the honest shape of the contract that
   * exists rather than a performance compromise.
   */
  private async legalEntityExists(legalEntityId: string): Promise<boolean> {
    const found = await runWithServiceGrant(
      {
        module: 'documents',
        operation: 'documents.create-document',
        permits: [LEGAL_ENTITY_READ],
        reason: 'Confirming that the legal entity a document is filed against exists',
      },
      () =>
        asking<readonly LegalEntityView[], ListLegalEntitiesQuery>(this.dispatcher, {
          queryName: 'organization.list-legal-entities',
        }),
    );

    return found.ok && found.value.some((entity) => entity.id === legalEntityId);
  }
}

/**
 * What People says about an identifier a document evidences.
 *
 * This is the D-1a boundary in one class. Documents stores an identifier's **id and nothing else**;
 * the number, the issuing country and the expiry stay where People owns them, and are read at the
 * moment somebody asks. There is exactly one authoritative answer to when a passport expires, and
 * it is not in this module.
 *
 * The grant is `people.identifier.read` and **not** `people.identifier.read-value`. Documents needs
 * to know the identifier exists and when it expires; the number itself is another module's secret,
 * and every use of it is recorded through People's own disclosure log — a path this adapter
 * deliberately does not take.
 */
export class DocumentsPersonIdentifiers implements PersonIdentifierPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async factsFor(
    personId: string,
    personIdentifierId: string,
  ): Promise<IdentifierFacts | undefined> {
    const profile = await runWithServiceGrant(
      {
        module: 'documents',
        operation: 'documents.read-document',
        // Never `people.identifier.read-value`: this module needs the expiry, not the number.
        permits: [PERSON_READ, IDENTIFIER_READ],
        reason: 'Reading the expiry People holds for an identifier a document evidences',
      },
      () =>
        asking<PersonProfileView, ReadProfileQuery>(this.dispatcher, {
          queryName: 'people.read-profile',
          personId,
        }),
    );

    if (!profile.ok) return undefined;
    return factsOf(profile, personIdentifierId);
  }
}

/**
 * The one identifier asked about, mapped to the four facts this module uses.
 *
 * `identifiers` absent is not the same as empty — People withholds the whole section from a caller
 * who may not read it rather than returning a list that would falsely say "this person holds none".
 * Either way the answer here is `undefined`, which the domain turns into a refusal.
 */
const factsOf = (
  profile: Result<PersonProfileView, HandlerFailure>,
  personIdentifierId: string,
): IdentifierFacts | undefined => {
  if (!profile.ok) return undefined;

  const held = (profile.value.identifiers ?? []).find(
    (identifier) => identifier.identifierId === personIdentifierId,
  );

  if (held === undefined) return undefined;
  return {
    personIdentifierId: held.identifierId,
    identifierType: held.identifierType,
    // `value` is never read and never carried: it is not in `IdentifierFacts` at all.
    ...(held.issuingCountry === undefined ? {} : { issuingCountry: held.issuingCountry }),
    ...(held.issuedOn === undefined ? {} : { issuedOn: held.issuedOn }),
    ...(held.expiresOn === undefined ? {} : { expiresOn: held.expiresOn }),
  };
};
