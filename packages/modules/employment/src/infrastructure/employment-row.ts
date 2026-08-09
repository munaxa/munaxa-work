import type { EmploymentState } from '../domain/employment.js';
import type { EmploymentStatus } from '../domain/employment-vocabulary.js';
import type { Metadata } from '../domain/employment-aggregate.js';

import { asVersion, civilDateColumn, optional, type RowValues } from './row-writer.js';

/**
 * The employment row, and the two functions that convert it to domain state and back.
 *
 * Apart from the repository because a repository is held to a tighter complexity budget than the
 * rest of the codebase — five rather than ten — and a mapping with eight optional columns exceeds
 * it by construction. The budget exists so that a repository which *needs* branching gets looked
 * at, and the honest answer here is that this is mapping rather than logic: no rule in this file
 * decides anything.
 *
 * Three columns are deliberately absent from the update set, and their absence is the point:
 *
 * - `employment_number` — generated once, immutable, never reused (ADR-0039). A number that could
 *   be updated is a number a payroll file cannot be joined on.
 * - `person_id` — an employment is a relationship *with a person*. Repointing it at somebody else
 *   would move a career, silently.
 * - `original_hire_date` — the date service length is measured from. It is set at creation,
 *   carried forward across a rehire, and never recomputed.
 */

export interface EmploymentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly person_id: string;
  readonly employment_number: string;
  readonly external_employee_number: string | null;
  readonly status: string;
  readonly employment_type_code: string;
  readonly employment_category_code: string | null;
  readonly employment_class_code: string | null;
  readonly original_hire_date: string;
  readonly start_date: string;
  readonly end_date: string | null;
  readonly end_reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const COLUMNS = `e.id, e.tenant_id, e.person_id, e.employment_number, e.external_employee_number, e.status, e.employment_type_code, e.employment_category_code, e.employment_class_code, ${civilDateColumn('e.original_hire_date', 'original_hire_date')}, ${civilDateColumn('e.start_date', 'start_date')}, ${civilDateColumn('e.end_date', 'end_date')}, e.end_reason_code, e.metadata, e.version`;

export const toState = (row: EmploymentRow): EmploymentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  personId: row.person_id,
  employmentNumber: row.employment_number,
  ...(row.external_employee_number === null
    ? {}
    : { externalEmployeeNumber: row.external_employee_number }),
  status: row.status as EmploymentStatus,
  employmentTypeCode: row.employment_type_code,
  ...(row.employment_category_code === null
    ? {}
    : { employmentCategoryCode: row.employment_category_code }),
  ...(row.employment_class_code === null ? {} : { employmentClassCode: row.employment_class_code }),
  originalHireDate: row.original_hire_date,
  startDate: row.start_date,
  ...(optional(row.end_date) === undefined ? {} : { endDate: row.end_date as string }),
  ...(row.end_reason_code === null ? {} : { endReasonCode: row.end_reason_code }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** The mutable columns, shared by insert and update so the two cannot diverge. */
const mutableValues = (state: EmploymentState): RowValues => ({
  external_employee_number: state.externalEmployeeNumber ?? null,
  status: state.status,
  employment_type_code: state.employmentTypeCode,
  employment_category_code: state.employmentCategoryCode ?? null,
  employment_class_code: state.employmentClassCode ?? null,
  start_date: state.startDate,
  end_date: state.endDate ?? null,
  end_reason_code: state.endReasonCode ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const toInsertValues = (state: EmploymentState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  person_id: state.personId,
  employment_number: state.employmentNumber,
  original_hire_date: state.originalHireDate,
  ...mutableValues(state),
});

export const toUpdateValues = (state: EmploymentState): RowValues => mutableValues(state);
