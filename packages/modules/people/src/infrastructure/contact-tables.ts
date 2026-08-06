import type { BilingualName } from '../domain/people-aggregate.js';
import type { AddressKind, ContactChannel, ContactPurpose } from '../domain/people-vocabulary.js';
import type { PersonAddressState } from '../domain/person-address.js';
import type { PersonContactState } from '../domain/person-contact.js';
import type { PersonEmergencyContactState } from '../domain/person-emergency-contact.js';
import type { PersonNameState } from '../domain/person-name.js';
import type { PersonPreferenceState } from '../domain/person-preference.js';

import type { ChildTable } from './child.repository.js';
import { asVersion, optional } from './row-writer.js';

/**
 * The row shapes and mappings for the versioned children: names, contacts, addresses, emergency
 * contacts and preferences.
 *
 * Each definition is three things — a column list, a row-to-state function and a state-to-row
 * function — and nothing else. Every rule about what may be written lives in the aggregate; a
 * repository that decided anything would be a business rule that cannot be tested without a
 * database.
 *
 * `toUpdate` is deliberately narrower than `toInsert` on every one of these. What an update may
 * change is the *end* of a period, because a versioned child is never edited: a change closes one
 * period and opens another. A `toUpdate` that carried the value columns would make an in-place
 * edit possible, and the pattern's whole guarantee is that it is not.
 */

const bilingual = (value: BilingualName): string => JSON.stringify(value);

interface VersionedRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_id: string;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const versionedState = (
  row: VersionedRow,
): {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
} => ({
  id: row.id,
  tenantId: row.tenant_id,
  personId: row.person_id,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

const versionedRow = (state: {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}): Record<string, unknown> => ({
  id: state.id,
  tenant_id: state.tenantId,
  person_id: state.personId,
  effective_from: state.effectiveFrom,
  effective_to: state.effectiveTo ?? null,
});

interface NameRow extends VersionedRow {
  readonly legal_name: BilingualName;
  readonly preferred_name: BilingualName | null;
}

export const NAME_TABLE: ChildTable<PersonNameState, NameRow> = {
  table: 'person_name',
  columns:
    'id, tenant_id, person_id, legal_name, preferred_name, effective_from, effective_to, version',
  order: 'effective_from',
  toState: (row) => ({
    ...versionedState(row),
    legalName: row.legal_name,
    ...(row.preferred_name === null ? {} : { preferredName: row.preferred_name }),
  }),
  toInsert: (state) => ({
    ...versionedRow(state),
    legal_name: bilingual(state.legalName),
    preferred_name: state.preferredName === undefined ? null : bilingual(state.preferredName),
  }),
  toUpdate: (state) => ({ effective_to: state.effectiveTo ?? null }),
};

export interface ContactRow extends VersionedRow {
  readonly channel: string;
  readonly purpose: string;
  readonly value: string;
  readonly display_value: string;
  readonly is_primary: boolean;
}

export const CONTACT_TABLE: ChildTable<PersonContactState, ContactRow> = {
  table: 'person_contact',
  columns:
    'id, tenant_id, person_id, channel, purpose, value, display_value, is_primary, effective_from, effective_to, version',
  order: 'channel, purpose, effective_from',
  toState: (row) => ({
    ...versionedState(row),
    channel: row.channel as ContactChannel,
    purpose: row.purpose as ContactPurpose,
    value: row.value,
    displayValue: row.display_value,
    isPrimary: row.is_primary,
  }),
  toInsert: (state) => ({
    ...versionedRow(state),
    channel: state.channel,
    purpose: state.purpose,
    value: state.value,
    display_value: state.displayValue,
    is_primary: state.isPrimary,
  }),
  toUpdate: (state) => ({ effective_to: state.effectiveTo ?? null }),
};

interface AddressRow extends VersionedRow {
  readonly kind: string;
  readonly lines: readonly BilingualName[];
  readonly city: BilingualName;
  readonly region: BilingualName | null;
  readonly postal_code: string | null;
  readonly country_code: string;
}

export const ADDRESS_TABLE: ChildTable<PersonAddressState, AddressRow> = {
  table: 'person_address',
  columns:
    'id, tenant_id, person_id, kind, lines, city, region, postal_code, country_code, effective_from, effective_to, version',
  order: 'kind, effective_from',
  toState: (row) => ({
    ...versionedState(row),
    kind: row.kind as AddressKind,
    lines: row.lines,
    city: row.city,
    ...(row.region === null ? {} : { region: row.region }),
    ...(row.postal_code === null ? {} : { postalCode: row.postal_code }),
    countryCode: row.country_code,
  }),
  toInsert: (state) => ({
    ...versionedRow(state),
    kind: state.kind,
    lines: JSON.stringify(state.lines),
    city: bilingual(state.city),
    region: state.region === undefined ? null : bilingual(state.region),
    postal_code: state.postalCode ?? null,
    country_code: state.countryCode,
  }),
  toUpdate: (state) => ({ effective_to: state.effectiveTo ?? null }),
};

interface EmergencyContactRow extends VersionedRow {
  readonly name: BilingualName;
  readonly relationship_code: string;
  readonly telephone: string;
  readonly alternate_telephone: string | null;
  readonly email: string | null;
  readonly priority: number | string;
}

export const EMERGENCY_CONTACT_TABLE: ChildTable<PersonEmergencyContactState, EmergencyContactRow> =
  {
    table: 'person_emergency_contact',
    columns:
      'id, tenant_id, person_id, name, relationship_code, telephone, alternate_telephone, email, priority, effective_from, effective_to, version',
    order: 'priority, effective_from',
    toState: (row) => ({
      ...versionedState(row),
      name: row.name,
      relationshipCode: row.relationship_code,
      telephone: row.telephone,
      ...(row.alternate_telephone === null ? {} : { alternateTelephone: row.alternate_telephone }),
      ...(row.email === null ? {} : { email: row.email }),
      priority: asVersion(row.priority),
    }),
    toInsert: (state) => ({
      ...versionedRow(state),
      name: bilingual(state.name),
      relationship_code: state.relationshipCode,
      telephone: state.telephone,
      alternate_telephone: state.alternateTelephone ?? null,
      email: state.email ?? null,
      priority: state.priority,
    }),
    toUpdate: (state) => ({ effective_to: state.effectiveTo ?? null }),
  };

interface PreferenceRow extends VersionedRow {
  readonly preference_key: string;
  readonly value: string;
}

export const PREFERENCE_TABLE: ChildTable<PersonPreferenceState, PreferenceRow> = {
  table: 'person_preference',
  columns: 'id, tenant_id, person_id, preference_key, value, effective_from, effective_to, version',
  order: 'preference_key, effective_from',
  toState: (row) => ({
    ...versionedState(row),
    preferenceKey: row.preference_key,
    value: row.value,
  }),
  toInsert: (state) => ({
    ...versionedRow(state),
    preference_key: state.preferenceKey,
    value: state.value,
  }),
  toUpdate: (state) => ({ effective_to: state.effectiveTo ?? null }),
};

/** Re-exported so the profile tables file can use the same null convention. */
export { optional };
