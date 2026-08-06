/**
 * The public contract of People.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories,
 * its tables and its aggregates are private and stay private — and in this module that is not
 * merely tidiness. The boundary is where the permission check and the redaction live, so a
 * consumer that could reach past it would be a consumer reading national identifiers without one.
 *
 * Two entries carry more weight than the rest.
 *
 * `PersonView` is what every later phase resolves a human being through. It carries the legal name
 * **as at a date**, because a person's legal name has a history and a contract is signed on a date
 * (ADR-0037).
 *
 * `PersonProfileView` withholds by section rather than by field: a caller who may not read
 * identifiers receives no `identifiers` key at all, and `withheld` says so. An empty array would
 * assert that the person holds no documents, which is a different and false statement.
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
  AddressKind,
  CapabilityKind,
  ContactChannel,
  ContactPurpose,
  DuplicateStatus,
  HistoryKind,
  LanguageProficiency,
  PersonStatus,
  SkillLevel,
} from '../domain/people-vocabulary.js';

export type { MatchReason } from '../domain/duplicate-matching.js';

export type {
  DuplicateCandidateView,
  DuplicateWarningView,
  LocalizedName,
  PeopleSnapshot,
  PersonAddressView,
  PersonCapabilityView,
  PersonContactView,
  PersonEmergencyContactView,
  PersonHistoryView,
  PersonIdentifierView,
  PersonNameView,
  PersonNationalityView,
  PersonNoteView,
  PersonPreferenceView,
  PersonProfileView,
  PersonTagView,
  PersonView,
} from './views.js';
