import type {
  AddressKind,
  CapabilityKind,
  ContactChannel,
  ContactPurpose,
  DuplicateStatus,
  HistoryKind,
  PersonStatus,
} from '../domain/people-vocabulary.js';

/**
 * What People publishes.
 *
 * These are the shapes other modules, the API and the SDK depend on. The aggregates, the
 * repositories and the tables are private and stay private, because the moment Employment reads
 * `person_identifier` directly the boundary stops being a boundary — and this is the module where
 * that matters most, since the boundary is also where the permission check lives.
 *
 * **Every sensitive field in these views is optional, and its absence is meaningful.** A caller
 * without `people.person.read-sensitive` gets a `PersonView` with no `dateOfBirth` at all, rather
 * than a null or a zero. That is deliberate: a consumer that receives `dateOfBirth: null` cannot
 * tell "we do not know" from "you may not see it", and the two lead to different behaviour.
 *
 * `PersonIdentifierView.value` is absent unless the caller holds `people.identifier.read-value`;
 * `maskedValue` is always present, showing the last four characters so an administrator can
 * confirm they are looking at the right document without being shown the document.
 *
 * Contracts are versioned. A breaking change to anything in this file requires an ADR.
 */

export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

/**
 * A person, as at a date.
 *
 * `asOf` is part of the view rather than implied, because the name in it is the name **in force on
 * that date** and a consumer that assumed "current" would put last year's name on this year's
 * contract, or the reverse (ADR-0037).
 */
export interface PersonView {
  readonly personId: string;
  readonly personNumber: string;
  readonly legalName: LocalizedName;
  readonly preferredName?: LocalizedName;
  readonly status: PersonStatus;
  /** The date the effective-dated parts of this view were resolved at. */
  readonly asOf: string;
  /** Set when this record was merged into another. Consumers follow it. */
  readonly mergedIntoPersonId?: string;
  readonly photoDocumentId?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly version: number;

  /** Present only for a caller holding `people.person.read-sensitive`. */
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
  /**
   * Whether sensitive fields were withheld from this response. Stated rather than inferred, so a
   * screen can say "some fields are hidden" instead of showing a person with no date of birth.
   */
  readonly sensitiveWithheld: boolean;
}

export interface PersonNameView {
  readonly nameId: string;
  readonly legalName: LocalizedName;
  readonly preferredName?: LocalizedName;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface PersonIdentifierView {
  readonly identifierId: string;
  readonly identifierType: string;
  /** Always present. The last four characters, so a document can be confirmed but not read. */
  readonly maskedValue: string;
  /** Present only for a caller holding `people.identifier.read-value`. */
  readonly value?: string;
  readonly issuingCountry?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly isPrimary: boolean;
  readonly withdrawn: boolean;
  readonly version: number;
}

export interface PersonNationalityView {
  readonly nationalityId: string;
  readonly countryCode: string;
  readonly isPrimary: boolean;
  readonly acquiredOn?: string;
  readonly withdrawn: boolean;
  readonly version: number;
}

export interface PersonContactView {
  readonly contactId: string;
  readonly channel: ContactChannel;
  readonly purpose: ContactPurpose;
  readonly value: string;
  readonly isPrimary: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly version: number;
}

export interface PersonAddressView {
  readonly addressId: string;
  readonly kind: AddressKind;
  readonly lines: readonly LocalizedName[];
  readonly city: LocalizedName;
  readonly region?: LocalizedName;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly version: number;
}

export interface PersonEmergencyContactView {
  readonly emergencyContactId: string;
  readonly name: LocalizedName;
  readonly relationshipCode: string;
  readonly telephone: string;
  readonly alternateTelephone?: string;
  readonly email?: string;
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly version: number;
}

export interface PersonPreferenceView {
  readonly preferenceId: string;
  readonly preferenceKey: string;
  readonly value: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly version: number;
}

export interface PersonCapabilityView {
  readonly capabilityId: string;
  readonly kind: CapabilityKind;
  readonly capabilityCode: string;
  readonly title?: LocalizedName;
  readonly level: string;
  readonly yearsOfExperience?: number;
  readonly lastUsedOn?: string;
  readonly withdrawn: boolean;
  readonly version: number;
}

export interface PersonHistoryView {
  readonly historyId: string;
  readonly kind: HistoryKind;
  readonly organizationName: LocalizedName;
  readonly title: LocalizedName;
  readonly fieldOfStudy?: LocalizedName;
  readonly countryCode?: string;
  readonly fromDate: string;
  readonly toDate?: string;
  readonly expiresOn?: string;
  readonly reference?: string;
  readonly withdrawn: boolean;
  readonly version: number;
}

export interface PersonTagView {
  readonly tagId: string;
  readonly tagCode: string;
  readonly withdrawn: boolean;
  readonly version: number;
}

export interface PersonNoteView {
  readonly noteId: string;
  readonly categoryCode: string;
  readonly body: string;
  readonly authoredBy: string;
  readonly authoredAt: string;
  readonly version: number;
}

/**
 * Everything about one person a caller is entitled to see, in one response.
 *
 * Assembled per permission rather than filtered afterwards: a section the caller may not read is
 * **absent**, not empty. An empty `identifiers` array would tell a caller this person holds no
 * documents, which is a different and false statement.
 */
export interface PersonProfileView {
  readonly person: PersonView;
  readonly names: readonly PersonNameView[];
  readonly identifiers?: readonly PersonIdentifierView[];
  readonly nationalities?: readonly PersonNationalityView[];
  readonly contacts?: readonly PersonContactView[];
  readonly addresses?: readonly PersonAddressView[];
  readonly emergencyContacts?: readonly PersonEmergencyContactView[];
  readonly preferences?: readonly PersonPreferenceView[];
  readonly capabilities?: readonly PersonCapabilityView[];
  readonly history?: readonly PersonHistoryView[];
  readonly tags?: readonly PersonTagView[];
  readonly notes?: readonly PersonNoteView[];
  /** Which sections were withheld, so a screen can say so rather than imply absence. */
  readonly withheld: readonly string[];
}

export interface DuplicateCandidateView {
  readonly candidateId: string;
  readonly personId: string;
  readonly duplicateOfPersonId: string;
  readonly reason: string;
  readonly confidence: number;
  readonly status: DuplicateStatus;
  readonly reviewedBy?: string;
  readonly reviewedAt?: string;
  readonly reviewNote?: string;
  readonly version: number;
}

/**
 * What a create refused as a possible duplicate reports back.
 *
 * It names the *reason* and the person it matched, never the value that matched — a response
 * echoing a national identifier would put one into a browser's history.
 */
export interface DuplicateWarningView {
  readonly personId: string;
  readonly reason: string;
  readonly confidence: number;
}

/**
 * The register, exported.
 *
 * Deliberately narrower than the profile: an export leaves the product, and the fields that would
 * make a leaked file catastrophic — identifier values, notes, emergency contacts — are not in it.
 * Exporting those is a separate operation this phase does not ship, stated in the debt register
 * rather than quietly possible.
 */
export interface PeopleSnapshot {
  readonly asOf: string;
  readonly people: readonly PersonView[];
}
