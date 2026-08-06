import type { PeopleStores } from '../application/people-ports.js';

import { ChildRepository } from './child.repository.js';
import {
  ADDRESS_TABLE,
  EMERGENCY_CONTACT_TABLE,
  NAME_TABLE,
  PREFERENCE_TABLE,
} from './contact-tables.js';
import { ContactRepository, IdentifierRepository } from './identifier.repository.js';
import { DuplicateRepository } from './duplicate.repository.js';
import { PersonRepository } from './person.repository.js';
import {
  CAPABILITY_TABLE,
  HISTORY_TABLE,
  NATIONALITY_TABLE,
  NOTE_TABLE,
  TAG_TABLE,
} from './profile-tables.js';

/**
 * The PostgreSQL implementation of every store the application declares.
 *
 * Assembled here so the composition root wires one thing rather than thirteen, and so that
 * swapping an implementation is one edit rather than a search.
 */
export const postgresPeopleStores = (): PeopleStores => ({
  people: new PersonRepository(),
  names: new ChildRepository(NAME_TABLE),
  identifiers: new IdentifierRepository(),
  nationalities: new ChildRepository(NATIONALITY_TABLE),
  contacts: new ContactRepository(),
  addresses: new ChildRepository(ADDRESS_TABLE),
  emergencyContacts: new ChildRepository(EMERGENCY_CONTACT_TABLE),
  preferences: new ChildRepository(PREFERENCE_TABLE),
  capabilities: new ChildRepository(CAPABILITY_TABLE),
  history: new ChildRepository(HISTORY_TABLE),
  tags: new ChildRepository(TAG_TABLE),
  notes: new ChildRepository(NOTE_TABLE),
  duplicates: new DuplicateRepository(),
});
