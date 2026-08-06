import type { Metadata } from '../domain/people-aggregate.js';
import type { PersonStatus } from '../domain/people-vocabulary.js';
import type { PersonState } from '../domain/person.js';

import { asVersion, civilDateColumn, type RowValues } from './row-writer.js';

/**
 * The person row, and the two functions that convert it to domain state and back.
 *
 * Apart from the repository because a repository is held to a tighter complexity budget than the
 * rest of the codebase — five rather than ten — and a mapping with eleven optional columns exceeds
 * it by construction. The budget exists so that a repository which *needs* branching gets looked
 * at, and the honest answer here is that this is mapping rather than logic: no rule in this file
 * decides anything.
 *
 * Two columns are deliberately absent from the update set and their absence is the point:
 *
 * - `person_number` — a customer's own reference for a human being is what every other system of
 *   theirs joins on, and changing it silently breaks those joins.
 * - nothing about a name, because a person has no name column at all (ADR-0037).
 */

export interface PersonRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_number: string;
  readonly date_of_birth: string | null;
  readonly place_of_birth: string | null;
  readonly gender_code: string | null;
  readonly marital_status_code: string | null;
  readonly status: string;
  readonly photo_document_id: string | null;
  readonly merged_into_person_id: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const COLUMNS = `id, tenant_id, person_number, ${civilDateColumn('date_of_birth')}, place_of_birth, gender_code, marital_status_code, status, photo_document_id, merged_into_person_id, metadata, version`;

export const toState = (row: PersonRow): PersonState => ({
  id: row.id,
  tenantId: row.tenant_id,
  personNumber: row.person_number,
  ...(row.date_of_birth === null ? {} : { dateOfBirth: row.date_of_birth }),
  ...(row.place_of_birth === null ? {} : { placeOfBirth: row.place_of_birth }),
  ...(row.gender_code === null ? {} : { genderCode: row.gender_code }),
  ...(row.marital_status_code === null ? {} : { maritalStatusCode: row.marital_status_code }),
  status: row.status as PersonStatus,
  ...(row.photo_document_id === null ? {} : { photoDocumentId: row.photo_document_id }),
  ...(row.merged_into_person_id === null ? {} : { mergedIntoPersonId: row.merged_into_person_id }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** The mutable columns, shared by insert and update so the two cannot diverge. */
const mutableValues = (state: PersonState): RowValues => ({
  date_of_birth: state.dateOfBirth ?? null,
  place_of_birth: state.placeOfBirth ?? null,
  gender_code: state.genderCode ?? null,
  marital_status_code: state.maritalStatusCode ?? null,
  status: state.status,
  photo_document_id: state.photoDocumentId ?? null,
  merged_into_person_id: state.mergedIntoPersonId ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const toInsertValues = (state: PersonState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  person_number: state.personNumber,
  ...mutableValues(state),
});

export const toUpdateValues = (state: PersonState): RowValues => mutableValues(state);
