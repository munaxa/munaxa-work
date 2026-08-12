import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import type { InstructorState } from '../domain/instructor.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type {
  AssignmentSource,
  AssignmentStatus,
  AudienceKind,
  CertificationSource,
  CertificationStatus,
  EnrolmentStatus,
  MandatoryKind,
} from '../domain/learning-vocabulary.js';
import { localized } from './catalogue-rows.js';
import { asNumber, civilDateColumn, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Learner rows: requirements, queues, enrolments, certifications and instructors.
 *
 * **Six civil dates pass through here and not one becomes a `Date`.** `effective_from`, `due_on`,
 * `occurrence_key`, `completed_on`, `issued_on` and `valid_until` are all `YYYY-MM-DD` strings in
 * the domain and `to_char` aliases on the way out. A due date read as a `Date` at the process's
 * local midnight would report training overdue a day early on any server west of UTC, and an expiry
 * a day early on the same one — the Phase 8 defect this product has already paid for once.
 *
 * **Two columns that do not exist are the point.** There is no `overdue` on an assignment and no
 * `expired` on a certification: both are functions of a date and today, derived on read, because
 * nothing in this repository moves a flag overnight (ADR-0070, ADR-0071).
 */

// ------------------------------------------------------------------------------------------------
// Mandatory rules
// ------------------------------------------------------------------------------------------------

export interface RuleRow {
  readonly id: string;
  readonly course_id: string;
  readonly name: unknown;
  readonly kind: string;
  readonly audience: string;
  readonly organization_unit_id: string | null;
  readonly position_id: string | null;
  readonly effective_from: string;
  readonly recurrence_months: number;
  readonly due_within_days: number;
  readonly active: boolean;
  readonly retired_at: Date | null;
  readonly retired_by: string | null;
  readonly version: number;
}

export const ruleColumns = (alias: string): string => `
  ${alias}.id, ${alias}.course_id, ${alias}.name, ${alias}.kind, ${alias}.audience,
  ${alias}.organization_unit_id, ${alias}.position_id,
  ${civilDateColumn(`${alias}.effective_from`, 'effective_from')},
  ${alias}.recurrence_months, ${alias}.due_within_days, ${alias}.active,
  ${alias}.retired_at, ${alias}.retired_by, ${alias}.version`;

export const ruleState = (row: RuleRow): MandatoryRuleState => ({
  mandatoryRuleId: row.id,
  courseId: row.course_id,
  name: localized(row.name),
  kind: row.kind as MandatoryKind,
  audience: row.audience as AudienceKind,
  effectiveFrom: row.effective_from,
  recurrenceMonths: asNumber(row.recurrence_months),
  dueWithinDays: asNumber(row.due_within_days),
  active: row.active,
  version: asNumber(row.version),
  ...presentOf({
    organizationUnitId: row.organization_unit_id,
    positionId: row.position_id,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
  }),
});

export const ruleValues = (state: MandatoryRuleState, tenantId: string): RowValues => ({
  id: state.mandatoryRuleId,
  tenant_id: tenantId,
  course_id: state.courseId,
  name: JSON.stringify(state.name),
  kind: state.kind,
  audience: state.audience,
  organization_unit_id: orNull(state.organizationUnitId),
  position_id: orNull(state.positionId),
  effective_from: state.effectiveFrom,
  recurrence_months: state.recurrenceMonths,
  due_within_days: state.dueWithinDays,
  active: state.active,
  retired_at: orNull(state.retiredAt),
  retired_by: orNull(state.retiredBy),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Assignments
// ------------------------------------------------------------------------------------------------

export interface AssignmentRow {
  readonly id: string;
  readonly employment_id: string;
  readonly course_id: string;
  readonly source: string;
  readonly mandatory_rule_id: string | null;
  readonly path_id: string | null;
  readonly occurrence_key: string | null;
  readonly status: string;
  readonly due_on: string | null;
  readonly assigned_at: Date;
  readonly assigned_by: string;
  readonly satisfied_by_enrolment_id: string | null;
  readonly satisfied_by_certification_id: string | null;
  readonly satisfied_at: Date | null;
  readonly waived_at: Date | null;
  readonly waived_by: string | null;
  readonly waiver_reason: string | null;
  readonly cancelled_at: Date | null;
  readonly cancelled_by: string | null;
  readonly version: number;
}

export const assignmentColumns = (alias: string): string => `
  ${alias}.id, ${alias}.employment_id, ${alias}.course_id, ${alias}.source,
  ${alias}.mandatory_rule_id, ${alias}.path_id,
  ${civilDateColumn(`${alias}.occurrence_key`, 'occurrence_key')},
  ${alias}.status, ${civilDateColumn(`${alias}.due_on`, 'due_on')},
  ${alias}.assigned_at, ${alias}.assigned_by, ${alias}.satisfied_by_enrolment_id,
  ${alias}.satisfied_by_certification_id, ${alias}.satisfied_at, ${alias}.waived_at,
  ${alias}.waived_by, ${alias}.waiver_reason, ${alias}.cancelled_at, ${alias}.cancelled_by,
  ${alias}.version`;

export const assignmentState = (row: AssignmentRow): AssignmentState => ({
  assignmentId: row.id,
  employmentId: row.employment_id,
  courseId: row.course_id,
  source: row.source as AssignmentSource,
  status: row.status as AssignmentStatus,
  assignedAt: row.assigned_at,
  assignedBy: row.assigned_by,
  version: asNumber(row.version),
  ...presentOf({
    mandatoryRuleId: row.mandatory_rule_id,
    pathId: row.path_id,
    occurrenceKey: row.occurrence_key,
    dueOn: row.due_on,
    satisfiedByEnrolmentId: row.satisfied_by_enrolment_id,
    satisfiedByCertificationId: row.satisfied_by_certification_id,
    satisfiedAt: row.satisfied_at,
    waivedAt: row.waived_at,
    waivedBy: row.waived_by,
    waiverReason: row.waiver_reason,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
  }),
});

export const assignmentValues = (state: AssignmentState, tenantId: string): RowValues => ({
  id: state.assignmentId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  course_id: state.courseId,
  source: state.source,
  mandatory_rule_id: orNull(state.mandatoryRuleId),
  path_id: orNull(state.pathId),
  occurrence_key: orNull(state.occurrenceKey),
  status: state.status,
  due_on: orNull(state.dueOn),
  assigned_at: state.assignedAt,
  assigned_by: state.assignedBy,
  satisfied_by_enrolment_id: orNull(state.satisfiedByEnrolmentId),
  satisfied_by_certification_id: orNull(state.satisfiedByCertificationId),
  satisfied_at: orNull(state.satisfiedAt),
  waived_at: orNull(state.waivedAt),
  waived_by: orNull(state.waivedBy),
  waiver_reason: orNull(state.waiverReason),
  cancelled_at: orNull(state.cancelledAt),
  cancelled_by: orNull(state.cancelledBy),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Enrolments
// ------------------------------------------------------------------------------------------------

export interface EnrolmentRow {
  readonly id: string;
  readonly employment_id: string;
  readonly course_id: string;
  readonly course_version_id: string;
  readonly assignment_id: string | null;
  readonly status: string;
  readonly enrolled_at: Date;
  readonly enrolled_by: string;
  readonly started_at: Date | null;
  readonly completed_at: Date | null;
  readonly completed_by: string | null;
  readonly completed_on: string | null;
  readonly outcome_note: string | null;
  readonly version: number;
}

export const enrolmentColumns = (alias: string): string => `
  ${alias}.id, ${alias}.employment_id, ${alias}.course_id, ${alias}.course_version_id,
  ${alias}.assignment_id, ${alias}.status, ${alias}.enrolled_at, ${alias}.enrolled_by,
  ${alias}.started_at, ${alias}.completed_at, ${alias}.completed_by,
  ${civilDateColumn(`${alias}.completed_on`, 'completed_on')},
  ${alias}.outcome_note, ${alias}.version`;

export const enrolmentState = (row: EnrolmentRow): EnrolmentState => ({
  enrolmentId: row.id,
  employmentId: row.employment_id,
  courseId: row.course_id,
  courseVersionId: row.course_version_id,
  status: row.status as EnrolmentStatus,
  enrolledAt: row.enrolled_at,
  enrolledBy: row.enrolled_by,
  version: asNumber(row.version),
  ...presentOf({
    assignmentId: row.assignment_id,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    completedOn: row.completed_on,
    outcomeNote: row.outcome_note,
  }),
});

export const enrolmentValues = (state: EnrolmentState, tenantId: string): RowValues => ({
  id: state.enrolmentId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  course_id: state.courseId,
  course_version_id: state.courseVersionId,
  assignment_id: orNull(state.assignmentId),
  status: state.status,
  enrolled_at: state.enrolledAt,
  enrolled_by: state.enrolledBy,
  started_at: orNull(state.startedAt),
  completed_at: orNull(state.completedAt),
  completed_by: orNull(state.completedBy),
  completed_on: orNull(state.completedOn),
  outcome_note: orNull(state.outcomeNote),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Certifications and instructors
// ------------------------------------------------------------------------------------------------

export interface CertificationRow {
  readonly id: string;
  readonly employment_id: string;
  readonly enrolment_id: string | null;
  readonly course_id: string | null;
  readonly title: string;
  readonly source: string;
  readonly status: string;
  readonly issued_on: string;
  readonly valid_until: string | null;
  readonly supersedes_certification_id: string | null;
  readonly evidence_document_id: string | null;
  readonly revoked_at: Date | null;
  readonly revoked_by: string | null;
  readonly revocation_reason: string | null;
  readonly issued_by: string;
  readonly version: number;
}

export const certificationColumns = (alias: string): string => `
  ${alias}.id, ${alias}.employment_id, ${alias}.enrolment_id, ${alias}.course_id, ${alias}.title,
  ${alias}.source, ${alias}.status, ${civilDateColumn(`${alias}.issued_on`, 'issued_on')},
  ${civilDateColumn(`${alias}.valid_until`, 'valid_until')},
  ${alias}.supersedes_certification_id, ${alias}.evidence_document_id, ${alias}.revoked_at,
  ${alias}.revoked_by, ${alias}.revocation_reason, ${alias}.issued_by, ${alias}.version`;

export const certificationState = (row: CertificationRow): CertificationState => ({
  certificationId: row.id,
  employmentId: row.employment_id,
  title: row.title,
  source: row.source as CertificationSource,
  status: row.status as CertificationStatus,
  issuedOn: row.issued_on,
  issuedBy: row.issued_by,
  version: asNumber(row.version),
  ...presentOf({
    enrolmentId: row.enrolment_id,
    courseId: row.course_id,
    validUntil: row.valid_until,
    supersedesCertificationId: row.supersedes_certification_id,
    evidenceDocumentId: row.evidence_document_id,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
    revocationReason: row.revocation_reason,
  }),
});

export const certificationValues = (state: CertificationState, tenantId: string): RowValues => ({
  id: state.certificationId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  enrolment_id: orNull(state.enrolmentId),
  course_id: orNull(state.courseId),
  title: state.title,
  source: state.source,
  status: state.status,
  issued_on: state.issuedOn,
  valid_until: orNull(state.validUntil),
  supersedes_certification_id: orNull(state.supersedesCertificationId),
  evidence_document_id: orNull(state.evidenceDocumentId),
  revoked_at: orNull(state.revokedAt),
  revoked_by: orNull(state.revokedBy),
  revocation_reason: orNull(state.revocationReason),
  issued_by: state.issuedBy,
  metadata: '{}',
});

export interface InstructorRow {
  readonly id: string;
  readonly employment_id: string | null;
  readonly external_name: unknown;
  readonly external_organization: string | null;
  readonly external_contact: string | null;
  readonly active: boolean;
  readonly version: number;
}

export const INSTRUCTOR_COLUMNS = `id, employment_id, external_name, external_organization,
  external_contact, active, version`;

export const instructorState = (row: InstructorRow): InstructorState => ({
  instructorId: row.id,
  active: row.active,
  version: asNumber(row.version),
  ...presentOf({
    employmentId: row.employment_id,
    externalName: row.external_name === null ? null : localized(row.external_name),
    externalOrganization: row.external_organization,
    externalContact: row.external_contact,
  }),
});

export const instructorValues = (state: InstructorState, tenantId: string): RowValues => ({
  id: state.instructorId,
  tenant_id: tenantId,
  employment_id: orNull(state.employmentId),
  external_name: state.externalName === undefined ? null : JSON.stringify(state.externalName),
  external_organization: orNull(state.externalOrganization),
  external_contact: orNull(state.externalContact),
  active: state.active,
  metadata: '{}',
});
