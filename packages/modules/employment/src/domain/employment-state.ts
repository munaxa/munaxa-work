import type { Metadata } from './employment-aggregate.js';
import type { EmploymentStatus } from './employment-vocabulary.js';

/**
 * The employment's state, and the three requests that change it.
 *
 * In their own file so that the aggregate and the checks it runs can both name them without
 * importing each other. A cycle between two files of one aggregate is harmless at runtime and
 * still worth removing: it makes the boundary meaningless to a reader and to a bundler, and the
 * dependency gate is right to refuse it.
 */

export interface EmploymentState {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  /** Generated, immutable and never reused. Not the person's identity (ADR-0039). */
  readonly employmentNumber: string;
  /** The customer's own number, carried through a migration. Never generated here. */
  readonly externalEmployeeNumber?: string;
  readonly status: EmploymentStatus;
  /** A tenant or country-pack code. Never a classification list this product ships (00B). */
  readonly employmentTypeCode: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  /**
   * The first day this human being ever worked for this tenant.
   *
   * Carried forward across a rehire rather than recomputed, because service-length entitlements in
   * several of this product's markets are measured from it and a rehire must not silently reset
   * somebody's accrued service to zero. Equal to `startDate` for a first employment.
   */
  readonly originalHireDate: string;
  /** The first day of *this* employment. */
  readonly startDate: string;
  readonly endDate?: string;
  /** A tenant-supplied code. Resignation and dismissal differ statutorily in every market (00B). */
  readonly endReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CreateEmployment {
  readonly tenantId: string;
  readonly personId: string;
  readonly employmentNumber: string;
  readonly externalEmployeeNumber?: string;
  readonly employmentTypeCode: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  readonly originalHireDate?: string;
  readonly startDate: string;
  readonly metadata?: Metadata;
}

export interface AmendEmployment {
  readonly employmentTypeCode?: string;
  readonly employmentCategoryCode?: string;
  readonly employmentClassCode?: string;
  readonly externalEmployeeNumber?: string;
  /** A correction, permitted only while the employment is not yet in force. See `amend`. */
  readonly startDate?: string;
}

export interface EndEmployment {
  readonly endDate: string;
  readonly endReasonCode: string;
  readonly note?: string;
}
