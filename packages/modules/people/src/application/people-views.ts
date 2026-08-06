import { inForceOn } from '../domain/versioned-child.js';
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
import type {
  DuplicateCandidateView,
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
  PersonTagView,
  PersonView,
} from '../contracts/views.js';

/**
 * Turning stored state into the published contracts — including the redaction.
 *
 * The redaction is here, in one place, rather than in each query handler. A module that masked an
 * identifier in the read-one endpoint and forgot to in the search endpoint would have masked
 * nothing, and the endpoint nobody checked is always the one that leaks.
 */

const asDate = (value: Date): string => value.toISOString();

/**
 * How much of a document a caller who may not read it still sees.
 *
 * The last four characters, and never fewer than four asterisks regardless of how short the value
 * is — so a two-character value does not reveal itself, and the length of the masked prefix does
 * not report the length of the document number.
 */
const MASK_VISIBLE = 4;

export const maskIdentifier = (value: string): string =>
  value.length <= MASK_VISIBLE ? '••••' : `••••${value.slice(-MASK_VISIBLE)}`;

export interface PersonVisibility {
  readonly sensitive: boolean;
  readonly identifierValues: boolean;
}

/**
 * A person, resolved as at a date and redacted to what this caller may see.
 *
 * A withheld field is **absent** rather than null. A consumer receiving `dateOfBirth: null` cannot
 * tell "we do not know" from "you may not see it", and the two lead to different behaviour — one
 * prompts for the value, the other must not.
 */
export const personView = (
  state: PersonState,
  names: readonly PersonNameState[],
  asOf: Date,
  visibility: PersonVisibility,
): PersonView => {
  const name = inForceOn(names, asOf)?.value ?? latestName(names);

  return {
    personId: state.id,
    personNumber: state.personNumber,
    legalName: name?.legalName ?? { en: '', ar: '' },
    ...(name?.preferredName === undefined ? {} : { preferredName: name.preferredName }),
    status: state.status,
    asOf: asDate(asOf),
    ...(state.mergedIntoPersonId === undefined
      ? {}
      : { mergedIntoPersonId: state.mergedIntoPersonId }),
    ...(state.photoDocumentId === undefined ? {} : { photoDocumentId: state.photoDocumentId }),
    metadata: state.metadata,
    version: state.version,
    ...(visibility.sensitive ? sensitiveFields(state) : {}),
    sensitiveWithheld: !visibility.sensitive,
  };
};

/**
 * A person created before the date asked about still has a name.
 *
 * `asOf` earlier than the first recorded name — a migration that dated every name from the day it
 * ran, then a query about last year — would otherwise render a person with a blank name, which
 * looks like corrupt data rather than a question asked about a date before the record began.
 */
const latestName = (names: readonly PersonNameState[]): PersonNameState | undefined =>
  [...names].sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())[0];

const sensitiveFields = (
  state: PersonState,
): {
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
} => ({
  ...(state.dateOfBirth === undefined ? {} : { dateOfBirth: state.dateOfBirth }),
  ...(state.placeOfBirth === undefined ? {} : { placeOfBirth: state.placeOfBirth }),
  ...(state.genderCode === undefined ? {} : { genderCode: state.genderCode }),
  ...(state.maritalStatusCode === undefined ? {} : { maritalStatusCode: state.maritalStatusCode }),
});

export const nameView = (state: PersonNameState): PersonNameView => ({
  nameId: state.id,
  legalName: state.legalName,
  ...(state.preferredName === undefined ? {} : { preferredName: state.preferredName }),
  effectiveFrom: asDate(state.effectiveFrom),
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: asDate(state.effectiveTo) }),
});

export const identifierView = (
  state: PersonIdentifierState,
  showValue: boolean,
): PersonIdentifierView => ({
  identifierId: state.id,
  identifierType: state.identifierType,
  maskedValue: maskIdentifier(state.value),
  ...(showValue ? { value: state.value } : {}),
  ...(state.issuingCountry === undefined ? {} : { issuingCountry: state.issuingCountry }),
  ...(state.issuedOn === undefined ? {} : { issuedOn: state.issuedOn }),
  ...(state.expiresOn === undefined ? {} : { expiresOn: state.expiresOn }),
  isPrimary: state.isPrimary,
  withdrawn: state.withdrawnAt !== undefined,
  version: state.version,
});

export const nationalityView = (state: PersonNationalityState): PersonNationalityView => ({
  nationalityId: state.id,
  countryCode: state.countryCode,
  isPrimary: state.isPrimary,
  ...(state.acquiredOn === undefined ? {} : { acquiredOn: state.acquiredOn }),
  withdrawn: state.withdrawnAt !== undefined,
  version: state.version,
});

export const contactView = (state: PersonContactState): PersonContactView => ({
  contactId: state.id,
  channel: state.channel,
  purpose: state.purpose,
  value: state.displayValue,
  isPrimary: state.isPrimary,
  effectiveFrom: asDate(state.effectiveFrom),
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: asDate(state.effectiveTo) }),
  version: state.version,
});

export const addressView = (state: PersonAddressState): PersonAddressView => ({
  addressId: state.id,
  kind: state.kind,
  lines: state.lines,
  city: state.city,
  ...(state.region === undefined ? {} : { region: state.region }),
  ...(state.postalCode === undefined ? {} : { postalCode: state.postalCode }),
  countryCode: state.countryCode,
  effectiveFrom: asDate(state.effectiveFrom),
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: asDate(state.effectiveTo) }),
  version: state.version,
});

export const emergencyContactView = (
  state: PersonEmergencyContactState,
): PersonEmergencyContactView => ({
  emergencyContactId: state.id,
  name: state.name,
  relationshipCode: state.relationshipCode,
  telephone: state.telephone,
  ...(state.alternateTelephone === undefined
    ? {}
    : { alternateTelephone: state.alternateTelephone }),
  ...(state.email === undefined ? {} : { email: state.email }),
  priority: state.priority,
  effectiveFrom: asDate(state.effectiveFrom),
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: asDate(state.effectiveTo) }),
  version: state.version,
});

export const preferenceView = (state: PersonPreferenceState): PersonPreferenceView => ({
  preferenceId: state.id,
  preferenceKey: state.preferenceKey,
  value: state.value,
  effectiveFrom: asDate(state.effectiveFrom),
  ...(state.effectiveTo === undefined ? {} : { effectiveTo: asDate(state.effectiveTo) }),
  version: state.version,
});

export const capabilityView = (state: PersonCapabilityState): PersonCapabilityView => ({
  capabilityId: state.id,
  kind: state.kind,
  capabilityCode: state.capabilityCode,
  ...(state.title === undefined ? {} : { title: state.title }),
  level: state.level,
  ...(state.yearsOfExperience === undefined ? {} : { yearsOfExperience: state.yearsOfExperience }),
  ...(state.lastUsedOn === undefined ? {} : { lastUsedOn: state.lastUsedOn }),
  withdrawn: state.withdrawnAt !== undefined,
  version: state.version,
});

export const historyView = (state: PersonHistoryState): PersonHistoryView => ({
  historyId: state.id,
  kind: state.kind,
  organizationName: state.organizationName,
  title: state.title,
  ...(state.fieldOfStudy === undefined ? {} : { fieldOfStudy: state.fieldOfStudy }),
  ...(state.countryCode === undefined ? {} : { countryCode: state.countryCode }),
  fromDate: state.fromDate,
  ...(state.toDate === undefined ? {} : { toDate: state.toDate }),
  ...(state.expiresOn === undefined ? {} : { expiresOn: state.expiresOn }),
  ...(state.reference === undefined ? {} : { reference: state.reference }),
  withdrawn: state.withdrawnAt !== undefined,
  version: state.version,
});

export const tagView = (state: PersonTagState): PersonTagView => ({
  tagId: state.id,
  tagCode: state.tagCode,
  withdrawn: state.withdrawnAt !== undefined,
  version: state.version,
});

export const noteView = (state: PersonNoteState): PersonNoteView => ({
  noteId: state.id,
  categoryCode: state.categoryCode,
  body: state.body,
  authoredBy: state.authoredBy,
  authoredAt: asDate(state.authoredAt),
  version: state.version,
});

export const duplicateView = (state: DuplicateCandidateState): DuplicateCandidateView => ({
  candidateId: state.id,
  personId: state.personId,
  duplicateOfPersonId: state.duplicateOfPersonId,
  reason: state.reason,
  confidence: state.confidence,
  status: state.status,
  ...(state.reviewedBy === undefined ? {} : { reviewedBy: state.reviewedBy }),
  ...(state.reviewedAt === undefined ? {} : { reviewedAt: asDate(state.reviewedAt) }),
  ...(state.reviewNote === undefined ? {} : { reviewNote: state.reviewNote }),
  version: state.version,
});
