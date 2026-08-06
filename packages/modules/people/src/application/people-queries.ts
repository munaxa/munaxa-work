import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import { matchKeyFor } from '../domain/duplicate-matching.js';
import { normalizedFor } from '../domain/person-contact.js';
import type { ContactChannel } from '../domain/people-vocabulary.js';
import type { DuplicateCandidateView, PersonView } from '../contracts/views.js';

import { notFound } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { duplicateView, personView } from './people-views.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Reading the register.
 *
 * Two things here are worth reading closely.
 *
 * **Search never takes a plaintext identifier into a query.** A caller may search by passport
 * number; the handler digests it first and the query compares digests, so the number reaches the
 * database as a hash and never appears in a slow-query log, a query plan or a monitoring trace.
 * The same holds for a contact value, which is normalized before it is compared.
 *
 * **Every person in a result is redacted individually**, through the same `personView` the
 * single-person read uses. A search that returned unredacted rows while the detail endpoint masked
 * them would have masked nothing — and a list endpoint is the cheaper of the two to scrape.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

export interface SearchPeople extends Query {
  readonly queryName: 'people.search';
  /** Matches the person number and the name in either language. */
  readonly term?: string;
  readonly status?: string;
  readonly tagCode?: string;
  readonly capabilityCode?: string;
  readonly nationality?: string;
  /** A government identifier, digested before it reaches the database. */
  readonly identifierValue?: string;
  readonly identifierType?: string;
  /** An email address or telephone number, normalized before it is compared. */
  readonly contactValue?: string;
  readonly contactChannel?: ContactChannel;
  /** Which date the effective-dated parts of each result are resolved at. */
  readonly asOf?: Date;
  readonly page?: number;
  readonly size?: number;
}

export const searchPeopleHandler = (
  dependencies: PeopleDependencies,
): QueryHandler<SearchPeople, PagedResult<PersonView>> => ({
  queryName: 'people.search',
  permission: PeoplePermissions.personRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const asOf = query.asOf ?? dependencies.clock.now();
      const sensitive = await dependencies.permissions.holds(PeoplePermissions.sensitiveRead);

      const found = await dependencies.stores.people.search(transaction, {
        limit: size,
        offset: (page - 1) * size,
        asOf,
        ...(query.term === undefined ? {} : { term: query.term }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.tagCode === undefined ? {} : { tagCode: query.tagCode }),
        ...(query.capabilityCode === undefined ? {} : { capabilityCode: query.capabilityCode }),
        ...(query.nationality === undefined ? {} : { nationality: query.nationality }),
        ...identifierFilter(dependencies, query),
        ...contactFilter(query),
      });

      const names = await dependencies.stores.names.forPeople(
        transaction,
        found.items.map((person) => person.id),
      );

      const views = found.items.map((person) =>
        personView(
          person,
          names.filter((name) => name.personId === person.id),
          asOf,
          { sensitive, identifierValues: false },
        ),
      );

      return success(pagedResult(views, page, size, found.total));
    }),
});

/**
 * The identifier filter, digested.
 *
 * Without a type the digest cannot be computed — the key is over the type and the value together,
 * so that a passport and a national identifier that happen to share a number are two different
 * keys. A value with no type is dropped rather than guessed at.
 */
const identifierFilter = (
  dependencies: PeopleDependencies,
  query: SearchPeople,
): { readonly identifierMatchKey?: string } => {
  if (query.identifierValue === undefined || query.identifierType === undefined) return {};

  return {
    identifierMatchKey: matchKeyFor(
      query.identifierType,
      query.identifierValue,
      (type, normalized) => dependencies.digest.digest(type, normalized),
    ),
  };
};

const contactFilter = (query: SearchPeople): { readonly contactValue?: string } => {
  if (query.contactValue === undefined) return {};

  const normalized = normalizedFor(query.contactChannel ?? 'email', query.contactValue);

  return normalized.ok ? { contactValue: normalized.value } : {};
};

export interface ReadPerson extends Query {
  readonly queryName: 'people.read-person';
  readonly personId: string;
  readonly asOf?: Date;
}

export const readPersonHandler = (
  dependencies: PeopleDependencies,
): QueryHandler<ReadPerson, PersonView> => ({
  queryName: 'people.read-person',
  permission: PeoplePermissions.personRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const person = await dependencies.stores.people.byId(transaction, query.personId);

      if (person === undefined) return notFound('person');

      const asOf = query.asOf ?? dependencies.clock.now();
      const names = await dependencies.stores.names.forPerson(transaction, query.personId);
      const sensitive = await dependencies.permissions.holds(PeoplePermissions.sensitiveRead);

      return success(personView(person, names, asOf, { sensitive, identifierValues: false }));
    }),
});

export interface ListDuplicates extends Query {
  readonly queryName: 'people.list-duplicates';
  readonly status?: string;
  readonly page?: number;
  readonly size?: number;
}

export const listDuplicatesHandler = (
  dependencies: PeopleDependencies,
): QueryHandler<ListDuplicates, PagedResult<DuplicateCandidateView>> => ({
  queryName: 'people.list-duplicates',
  permission: PeoplePermissions.duplicateRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const found = await dependencies.stores.duplicates.list(transaction, {
        limit: size,
        offset: (page - 1) * size,
        ...(query.status === undefined ? {} : { status: query.status }),
      });

      return success(pagedResult(found.items.map(duplicateView), page, size, found.total));
    }),
});
