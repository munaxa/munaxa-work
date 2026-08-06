import type { BilingualName } from '../domain/people-aggregate.js';
import type { CapabilityKind, HistoryKind } from '../domain/people-vocabulary.js';
import type { PersonCapabilityState } from '../domain/person-capability.js';
import type { PersonHistoryState } from '../domain/person-history.js';
import type { PersonNationalityState } from '../domain/person-nationality.js';
import type { PersonNoteState, PersonTagState } from '../domain/person-annotation.js';

import type { ChildTable } from './child.repository.js';
import { asDecimal, asVersion, civilDateColumn } from './row-writer.js';

/**
 * The row shapes and mappings for the records that are claims rather than values: nationalities,
 * capabilities, history, tags and notes.
 *
 * Every one of these is **withdrawn, never deleted** (AD-009), so `toUpdate` carries exactly one
 * column: `withdrawn_at`. There is no path through this file that edits a claim in place, which
 * is what makes "a note cannot be amended" a property of the schema access rather than a promise.
 *
 * Every date column is selected through `to_char`. The driver would otherwise turn a `date` into a
 * JavaScript `Date` at the *process's* local midnight, so a certification expiring on the 1st,
 * read on a server west of UTC, comes back as the 31st.
 */

const bilingual = (value: BilingualName): string => JSON.stringify(value);

interface RecordRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_id: string;
  readonly withdrawn_at: Date | null;
  readonly version: number | string;
}

const recordState = (
  row: RecordRow,
): {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly withdrawnAt?: Date;
  readonly version: number;
} => ({
  id: row.id,
  tenantId: row.tenant_id,
  personId: row.person_id,
  ...(row.withdrawn_at === null ? {} : { withdrawnAt: row.withdrawn_at }),
  version: asVersion(row.version),
});

const recordRow = (state: {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly withdrawnAt?: Date;
}): Record<string, unknown> => ({
  id: state.id,
  tenant_id: state.tenantId,
  person_id: state.personId,
  withdrawn_at: state.withdrawnAt ?? null,
});

const withdrawalOnly = (state: { readonly withdrawnAt?: Date }): Record<string, unknown> => ({
  withdrawn_at: state.withdrawnAt ?? null,
});

interface NationalityRow extends RecordRow {
  readonly country_code: string;
  readonly is_primary: boolean;
  readonly acquired_on: string | null;
}

export const NATIONALITY_TABLE: ChildTable<PersonNationalityState, NationalityRow> = {
  table: 'person_nationality',
  columns: `id, tenant_id, person_id, country_code, is_primary, ${civilDateColumn('acquired_on')}, withdrawn_at, version`,
  order: 'is_primary desc, country_code',
  toState: (row) => ({
    ...recordState(row),
    countryCode: row.country_code,
    isPrimary: row.is_primary,
    ...(row.acquired_on === null ? {} : { acquiredOn: row.acquired_on }),
  }),
  toInsert: (state) => ({
    ...recordRow(state),
    country_code: state.countryCode,
    is_primary: state.isPrimary,
    acquired_on: state.acquiredOn ?? null,
  }),
  // The primary flag moves when another citizenship becomes the primary one, so it joins the
  // withdrawal as the only mutable column.
  toUpdate: (state) => ({ ...withdrawalOnly(state), is_primary: state.isPrimary }),
};

interface CapabilityRow extends RecordRow {
  readonly kind: string;
  readonly capability_code: string;
  readonly title: BilingualName | null;
  readonly level: string;
  readonly years_of_experience: string | number | null;
  readonly last_used_on: string | null;
}

export const CAPABILITY_TABLE: ChildTable<PersonCapabilityState, CapabilityRow> = {
  table: 'person_capability',
  columns: `id, tenant_id, person_id, kind, capability_code, title, level, years_of_experience, ${civilDateColumn('last_used_on')}, withdrawn_at, version`,
  order: 'kind, capability_code',
  toState: (row) => {
    const years = asDecimal(row.years_of_experience);

    return {
      ...recordState(row),
      kind: row.kind as CapabilityKind,
      capabilityCode: row.capability_code,
      ...(row.title === null ? {} : { title: row.title }),
      level: row.level,
      ...(years === undefined ? {} : { yearsOfExperience: years }),
      ...(row.last_used_on === null ? {} : { lastUsedOn: row.last_used_on }),
    };
  },
  toInsert: (state) => ({
    ...recordRow(state),
    kind: state.kind,
    capability_code: state.capabilityCode,
    title: state.title === undefined ? null : bilingual(state.title),
    level: state.level,
    years_of_experience: state.yearsOfExperience ?? null,
    last_used_on: state.lastUsedOn ?? null,
  }),
  toUpdate: withdrawalOnly,
};

interface HistoryRow extends RecordRow {
  readonly kind: string;
  readonly organization_name: BilingualName;
  readonly title: BilingualName;
  readonly field_of_study: BilingualName | null;
  readonly country_code: string | null;
  readonly from_date: string;
  readonly to_date: string | null;
  readonly expires_on: string | null;
  readonly reference: string | null;
}

export const HISTORY_TABLE: ChildTable<PersonHistoryState, HistoryRow> = {
  table: 'person_history',
  columns: `id, tenant_id, person_id, kind, organization_name, title, field_of_study, country_code, ${civilDateColumn('from_date')}, ${civilDateColumn('to_date')}, ${civilDateColumn('expires_on')}, reference, withdrawn_at, version`,
  order: 'from_date desc',
  toState: (row) => ({
    ...recordState(row),
    kind: row.kind as HistoryKind,
    organizationName: row.organization_name,
    title: row.title,
    ...(row.field_of_study === null ? {} : { fieldOfStudy: row.field_of_study }),
    ...(row.country_code === null ? {} : { countryCode: row.country_code }),
    fromDate: row.from_date,
    ...(row.to_date === null ? {} : { toDate: row.to_date }),
    ...(row.expires_on === null ? {} : { expiresOn: row.expires_on }),
    ...(row.reference === null ? {} : { reference: row.reference }),
  }),
  toInsert: (state) => ({
    ...recordRow(state),
    kind: state.kind,
    organization_name: bilingual(state.organizationName),
    title: bilingual(state.title),
    field_of_study: state.fieldOfStudy === undefined ? null : bilingual(state.fieldOfStudy),
    country_code: state.countryCode ?? null,
    from_date: state.fromDate,
    to_date: state.toDate ?? null,
    expires_on: state.expiresOn ?? null,
    reference: state.reference ?? null,
  }),
  toUpdate: withdrawalOnly,
};

interface TagRow extends RecordRow {
  readonly tag_code: string;
}

export const TAG_TABLE: ChildTable<PersonTagState, TagRow> = {
  table: 'person_tag',
  columns: 'id, tenant_id, person_id, tag_code, withdrawn_at, version',
  order: 'tag_code',
  toState: (row) => ({ ...recordState(row), tagCode: row.tag_code }),
  toInsert: (state) => ({ ...recordRow(state), tag_code: state.tagCode }),
  toUpdate: withdrawalOnly,
};

interface NoteRow extends RecordRow {
  readonly category_code: string;
  readonly body: string;
  readonly authored_by: string;
  readonly authored_at: Date;
}

export const NOTE_TABLE: ChildTable<PersonNoteState, NoteRow> = {
  table: 'person_note',
  columns:
    'id, tenant_id, person_id, category_code, body, authored_by, authored_at, withdrawn_at, version',
  order: 'authored_at desc',
  toState: (row) => ({
    ...recordState(row),
    categoryCode: row.category_code,
    body: row.body,
    authoredBy: row.authored_by,
    authoredAt: row.authored_at,
  }),
  toInsert: (state) => ({
    ...recordRow(state),
    category_code: state.categoryCode,
    body: state.body,
    authored_by: state.authoredBy,
    authored_at: state.authoredAt,
  }),
  // A note's body is not in the update set at all. An editable note evidences nothing.
  toUpdate: withdrawalOnly,
};
