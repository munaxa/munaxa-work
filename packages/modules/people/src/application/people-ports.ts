import type { Transaction } from '@work/kernel';

import type { DuplicateCandidateState } from '../domain/duplicate-candidate.js';
import type { PersonState } from '../domain/person.js';
import type { PersonAddressState } from '../domain/person-address.js';
import type { PersonCapabilityState } from '../domain/person-capability.js';
import type { PersonContactState } from '../domain/person-contact.js';
import type { PersonEmergencyContactState } from '../domain/person-emergency-contact.js';
import type { PersonHistoryState } from '../domain/person-history.js';
import type { PersonIdentifierState } from '../domain/person-identifier.js';
import type { PersonNameState } from '../domain/person-name.js';
import type { PersonNationalityState } from '../domain/person-nationality.js';
import type { PersonNoteState, PersonTagState } from '../domain/person-annotation.js';
import type { PersonPreferenceState } from '../domain/person-preference.js';

/**
 * What the application layer needs from persistence and from the platform, stated as interfaces it
 * owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Declaring these in infrastructure would invert that and make a duplicate-
 * detection test need PostgreSQL.
 *
 * Every method takes the `Transaction`, so a use case cannot accidentally read outside the unit of
 * work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

/**
 * What a search may filter on.
 *
 * `term` matches the person number and the name in *either* language, which is what a receptionist
 * with a half-remembered name actually types. The identifier filter takes a **digest**, never a
 * number: the caller supplies a value, the application digests it, and the query compares keys —
 * so searching for a passport never puts one in a query log.
 */
export interface PersonQuery extends Paged {
  readonly term?: string;
  readonly status?: string;
  readonly tagCode?: string;
  readonly capabilityCode?: string;
  readonly nationality?: string;
  readonly identifierMatchKey?: string;
  readonly contactValue?: string;
  /** Which date the name and other effective-dated data are resolved as at. */
  readonly asOf: Date;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface PersonStore {
  byId(transaction: Transaction, id: string): Promise<PersonState | undefined>;
  byNumber(transaction: Transaction, personNumber: string): Promise<PersonState | undefined>;
  byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly PersonState[]>;
  search(transaction: Transaction, query: PersonQuery): Promise<Page<PersonState>>;
  /**
   * People born on a date, bounded.
   *
   * The candidate set for the weakest duplicate signal. Bounded because in a register of a
   * hundred thousand people roughly three hundred share any given date of birth, and a create
   * that read all of them to compare names would be the slowest write in the product.
   */
  byDateOfBirth(
    transaction: Transaction,
    dateOfBirth: string,
    limit: number,
  ): Promise<readonly PersonState[]>;
  /** Every person in the tenant, for export and for whole-register duplicate sweeps. */
  all(transaction: Transaction): Promise<readonly PersonState[]>;
  insert(transaction: Transaction, state: PersonState): Promise<void>;
  update(transaction: Transaction, state: PersonState, expected: number): Promise<void>;
}

/** The shape every child store shares: read one, read a person's, read many people's, write. */
export interface ChildStore<TState> {
  byId(transaction: Transaction, id: string): Promise<TState | undefined>;
  forPerson(transaction: Transaction, personId: string): Promise<readonly TState[]>;
  forPeople(transaction: Transaction, personIds: readonly string[]): Promise<readonly TState[]>;
  all(transaction: Transaction): Promise<readonly TState[]>;
  insert(transaction: Transaction, state: TState): Promise<void>;
  update(transaction: Transaction, state: TState, expected: number): Promise<void>;
}

export interface IdentifierStore extends ChildStore<PersonIdentifierState> {
  /**
   * Who already holds any of these digests. The query duplicate detection runs, and the reason
   * the column is a digest: finding the person who holds a number never reads the number.
   */
  byMatchKeys(
    transaction: Transaction,
    matchKeys: readonly string[],
  ): Promise<readonly PersonIdentifierState[]>;
}

export interface ContactStore extends ChildStore<PersonContactState> {
  /** Who already holds any of these normalized values. The second duplicate signal. */
  byValues(
    transaction: Transaction,
    values: readonly string[],
  ): Promise<readonly PersonContactState[]>;
}

export interface DuplicateStore {
  byId(transaction: Transaction, id: string): Promise<DuplicateCandidateState | undefined>;
  /** The pair, ordered, so detecting A against B twice does not queue two decisions. */
  byPair(
    transaction: Transaction,
    personId: string,
    duplicateOfPersonId: string,
  ): Promise<DuplicateCandidateState | undefined>;
  forPerson(
    transaction: Transaction,
    personId: string,
  ): Promise<readonly DuplicateCandidateState[]>;
  list(
    transaction: Transaction,
    query: Paged & { readonly status?: string },
  ): Promise<Page<DuplicateCandidateState>>;
  insert(transaction: Transaction, state: DuplicateCandidateState): Promise<void>;
  update(transaction: Transaction, state: DuplicateCandidateState, expected: number): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface PeopleStores {
  readonly people: PersonStore;
  readonly names: ChildStore<PersonNameState>;
  readonly identifiers: IdentifierStore;
  readonly nationalities: ChildStore<PersonNationalityState>;
  readonly contacts: ContactStore;
  readonly addresses: ChildStore<PersonAddressState>;
  readonly emergencyContacts: ChildStore<PersonEmergencyContactState>;
  readonly preferences: ChildStore<PersonPreferenceState>;
  readonly capabilities: ChildStore<PersonCapabilityState>;
  readonly history: ChildStore<PersonHistoryState>;
  readonly tags: ChildStore<PersonTagState>;
  readonly notes: ChildStore<PersonNoteState>;
  readonly duplicates: DuplicateStore;
}

/**
 * How an identifier value becomes something safe to index and compare.
 *
 * A port rather than a function, because the digest needs a per-deployment key and the domain
 * reads no configuration. The adapter this module ships is an HMAC; the key is validated
 * configuration (`PII_MATCH_SECRET`), and a deployment running the development default in
 * production fails at startup rather than shipping the same key as everybody else.
 */
export interface IdentifierDigestPort {
  digest(identifierType: string, normalizedValue: string): string;
}

/**
 * Where the module records that somebody was shown a government identifier's value.
 *
 * Reading a passport number is not the same event as reading a person's name, and a system that
 * cannot say who read one cannot answer the question an investigation actually asks. The default
 * adapter writes a structured record; a durable, queryable disclosure ledger belongs to Phase 21,
 * which owns temporal audit generally, and that limitation is stated in the debt register rather
 * than implied.
 *
 * It takes the *kind* of identifier and the person, never the value. A disclosure log that held
 * the numbers would be a second copy of the thing it exists to protect.
 */
export interface DisclosurePort {
  recordDisclosure(disclosure: {
    readonly tenantId: string;
    readonly actor: string;
    readonly personId: string;
    readonly identifierType: string;
    readonly at: Date;
  }): void;
}

/** The clock, injected so effective dates and audit instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
