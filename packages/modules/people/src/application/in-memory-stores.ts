import { ConcurrencyException, currentTenantId, type Transaction } from '@work/kernel';

import { normalizeName } from '../domain/duplicate-matching.js';
import { namesIn } from '../domain/person-name.js';
import type { DuplicateCandidateState } from '../domain/duplicate-candidate.js';
import type { PersonState } from '../domain/person.js';
import type { PersonIdentifierState } from '../domain/person-identifier.js';
import type { PersonContactState } from '../domain/person-contact.js';
import type { PersonNameState } from '../domain/person-name.js';

import type {
  ChildStore,
  ContactStore,
  DuplicateStore,
  IdentifierStore,
  PeopleStores,
  Page,
  PersonQuery,
  PersonStore,
} from './people-ports.js';

/**
 * In-memory stores for the application-service tests.
 *
 * They keep the guarantees the real repositories make and a naive fake would drop, because a fake
 * more permissive than production is worse than no fake — every test passes and the difference
 * shows up in production:
 *
 * - **Tenant scoping.** Every read filters by the tenant in context, exactly as both the query
 *   predicate and the row-level security policy do.
 * - **Optimistic concurrency.** A write asserting a stale version throws, and a row is stored at
 *   version 1 exactly as `auditForInsert` writes it — a fake that stored 0 would make every first
 *   update in every test pass a version production would reject.
 * - **The same search predicate.** Free text matches the person number and the name in *either*
 *   language, and an identifier is matched by digest. A fake that searched English only would let
 *   a search broken for Arabic users pass the whole suite.
 *
 * They live in `src` rather than a test folder so the module's own tests and the API's can share
 * them, and so they are typechecked by the same configuration as the code they stand in for.
 */

interface Stored {
  readonly id: string;
  readonly tenantId: string;
  readonly version: number;
}

class Table<TState extends Stored> {
  private readonly rows = new Map<string, TState>();

  public constructor(private readonly name: string) {}

  public all(): readonly TState[] {
    const tenantId = currentTenantId();
    return [...this.rows.values()].filter((row) => row.tenantId === tenantId);
  }

  public byId(id: string): TState | undefined {
    return this.all().find((row) => row.id === id);
  }

  public insert(state: TState): void {
    this.rows.set(state.id, { ...state, version: 1 });
  }

  public update(state: TState, expected: number): void {
    const existing = this.rows.get(state.id);

    if (existing === undefined || existing.version !== expected) {
      throw new ConcurrencyException(this.name, expected, existing?.version ?? -1);
    }
    this.rows.set(state.id, { ...state, version: expected + 1 });
  }
}

const page = <TState>(items: readonly TState[], limit: number, offset: number): Page<TState> => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
});

/** A child store over one table, keyed by `personId`. Every child in the module is this shape. */
const childStore = <TState extends Stored & { readonly personId: string }>(
  rows: Table<TState>,
): ChildStore<TState> => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forPerson: (_: Transaction, personId) =>
    Promise.resolve(rows.all().filter((row) => row.personId === personId)),
  forPeople: (_: Transaction, personIds) =>
    Promise.resolve(rows.all().filter((row) => personIds.includes(row.personId))),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

export const inMemoryPeopleStores = (): PeopleStores => {
  const people = new Table<PersonState>('person');
  const names = new Table<PersonNameState>('person_name');
  const identifiers = new Table<PersonIdentifierState>('person_identifier');
  const contacts = new Table<PersonContactState>('person_contact');
  const duplicates = new Table<DuplicateCandidateState>('person_duplicate_candidate');

  return {
    people: personStore(people, names),
    names: childStore(names),
    identifiers: identifierStore(identifiers),
    nationalities: childStore(new Table('person_nationality')),
    contacts: contactStore(contacts),
    addresses: childStore(new Table('person_address')),
    emergencyContacts: childStore(new Table('person_emergency_contact')),
    preferences: childStore(new Table('person_preference')),
    capabilities: childStore(new Table('person_capability')),
    history: childStore(new Table('person_history')),
    tags: childStore(new Table('person_tag')),
    notes: childStore(new Table('person_note')),
    duplicates: duplicateStore(duplicates),
  };
};

const personStore = (rows: Table<PersonState>, names: Table<PersonNameState>): PersonStore => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  byNumber: (_: Transaction, personNumber) =>
    Promise.resolve(
      rows.all().find((row) => row.personNumber.toLowerCase() === personNumber.toLowerCase()),
    ),
  byIds: (_: Transaction, ids) => Promise.resolve(rows.all().filter((row) => ids.includes(row.id))),
  byDateOfBirth: (_: Transaction, dateOfBirth, limit) =>
    Promise.resolve(
      rows
        .all()
        .filter((row) => row.dateOfBirth === dateOfBirth)
        .slice(0, limit),
    ),
  all: (_: Transaction) => Promise.resolve(rows.all()),
  search: (_: Transaction, query) => Promise.resolve(searchIn(rows, names, query)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const searchIn = (
  rows: Table<PersonState>,
  names: Table<PersonNameState>,
  query: PersonQuery,
): Page<PersonState> => {
  const matched = rows
    .all()
    .filter((row) => query.status === undefined || row.status === query.status)
    .filter((row) => matchesTerm(row, names.all(), query.term))
    .sort((left, right) => left.personNumber.localeCompare(right.personNumber));

  return page(matched, query.limit, query.offset);
};

/**
 * Free text against the person number and every recorded name, in either language.
 *
 * Names are compared through the same normalization duplicate matching uses, so a search for
 * `احمد` finds `أحمد` — which is one name typed on two keyboards, and the reason the register is
 * searched at all is that somebody half-remembers a spelling.
 */
const matchesTerm = (
  person: PersonState,
  names: readonly PersonNameState[],
  term: string | undefined,
): boolean => {
  if (term === undefined || term.trim() === '') return true;
  if (person.personNumber.toLowerCase().includes(term.trim().toLowerCase())) return true;

  const needle = normalizeName(term);

  return names
    .filter((name) => name.personId === person.id)
    .flatMap(namesIn)
    .some((value) => normalizeName(value).includes(needle));
};

const identifierStore = (rows: Table<PersonIdentifierState>): IdentifierStore => ({
  ...childStore(rows),
  byMatchKeys: (_: Transaction, matchKeys) =>
    Promise.resolve(
      rows.all().filter((row) => row.withdrawnAt === undefined && matchKeys.includes(row.matchKey)),
    ),
});

const contactStore = (rows: Table<PersonContactState>): ContactStore => ({
  ...childStore(rows),
  byValues: (_: Transaction, values) =>
    Promise.resolve(rows.all().filter((row) => values.includes(row.value))),
});

const duplicateStore = (rows: Table<DuplicateCandidateState>): DuplicateStore => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  // Order-insensitive, matching the ordered pair the aggregate stores: detecting A against B and
  // later B against A must find the one row rather than queue a second decision.
  byPair: (_: Transaction, personId, duplicateOfPersonId) =>
    Promise.resolve(
      rows
        .all()
        .find(
          (row) =>
            (row.personId === personId && row.duplicateOfPersonId === duplicateOfPersonId) ||
            (row.personId === duplicateOfPersonId && row.duplicateOfPersonId === personId),
        ),
    ),
  forPerson: (_: Transaction, personId) =>
    Promise.resolve(
      rows.all().filter((row) => row.personId === personId || row.duplicateOfPersonId === personId),
    ),
  list: (_: Transaction, query) =>
    Promise.resolve(
      page(
        rows.all().filter((row) => query.status === undefined || row.status === query.status),
        query.limit,
        query.offset,
      ),
    ),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});
