import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { CourseState, CourseVersionState } from '../domain/course.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import type { InstructorState } from '../domain/instructor.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type { PathState, PathStepState } from '../domain/path.js';
import { isOverdue } from '../domain/assignment.js';
import { validityOf } from '../domain/certification.js';
import { definedOf } from '../domain/defined.js';
import type {
  AssessmentResultView,
  AssessmentView,
  AssignmentView,
  CertificationView,
  CourseVersionView,
  CourseView,
  EnrolmentView,
  InstructorView,
  MandatoryRuleView,
  PathStepView,
  PathView,
} from '../contracts/views.js';

/**
 * Domain state into published views.
 *
 * One direction only. Nothing here reads a view and produces state: a view is what this module
 * promises a consumer, and a mapper that ran backwards would let a consumer's shape decide the
 * domain's.
 *
 * **The two derived fields are computed here and stored nowhere.** `overdue` and `validity` are
 * functions of a date and the day the caller asked about, which is the whole of ADR-0070 and
 * ADR-0071 expressed at the boundary: no column holds them, so nothing has to move one overnight,
 * and the answer is correct at every instant rather than as of the last sweep that ran.
 */

export const courseView = (state: CourseState): CourseView => ({
  courseId: state.courseId,
  code: state.code,
  name: state.name,
  delivery: state.delivery,
  status: state.status,
  versionCount: state.versionCount,
  version: state.version,
  ...definedOf({
    description: state.description,
    categoryId: state.categoryId,
    currentVersionId: state.currentVersionId,
  }),
});

export const courseVersionView = (state: CourseVersionState): CourseVersionView => ({
  courseVersionId: state.courseVersionId,
  courseId: state.courseId,
  versionNumber: state.versionNumber,
  title: state.title,
  requiresAssessment: state.requiresAssessment,
  publishedAt: state.publishedAt.toISOString(),
  publishedBy: state.publishedBy,
  ...definedOf({
    objectives: state.objectives,
    durationMinutes: state.durationMinutes,
    certificationValidMonths: state.certificationValidMonths,
  }),
});

export const assessmentView = (state: AssessmentDefinitionState): AssessmentView => ({
  assessmentId: state.assessmentId,
  courseVersionId: state.courseVersionId,
  title: state.title,
  kind: state.kind,
  required: state.required,
});

/**
 * A result, with its raw mark passed through untouched.
 *
 * The mark is the tenant's own string and it leaves as the tenant's own string. It is not parsed,
 * not rounded, not compared with a threshold and not added to anything, because the specification
 * defines none of those — aggregate scoring is `NOT VERIFIED`.
 */
export const assessmentResultView = (state: AssessmentResultState): AssessmentResultView => ({
  resultId: state.resultId,
  assessmentId: state.assessmentId,
  enrolmentId: state.enrolmentId,
  outcome: state.outcome,
  assessedOn: state.assessedOn,
  assessedBy: state.assessedBy,
  ...definedOf({ rawMark: state.rawMark, rawMarkScale: state.rawMarkScale }),
});

export const pathView = (state: PathState): PathView => ({
  pathId: state.pathId,
  code: state.code,
  name: state.name,
  kind: state.kind,
  status: state.status,
  stepCount: state.stepCount,
  version: state.version,
});

export const pathStepView = (state: PathStepState): PathStepView => ({
  stepId: state.stepId,
  courseId: state.courseId,
  sequence: state.sequence,
  optional: state.optional,
});

export const mandatoryRuleView = (state: MandatoryRuleState): MandatoryRuleView => ({
  mandatoryRuleId: state.mandatoryRuleId,
  courseId: state.courseId,
  name: state.name,
  kind: state.kind,
  audience: state.audience,
  effectiveFrom: state.effectiveFrom,
  recurrenceMonths: state.recurrenceMonths,
  dueWithinDays: state.dueWithinDays,
  active: state.active,
  version: state.version,
  ...definedOf({
    organizationUnitId: state.organizationUnitId,
    positionId: state.positionId,
  }),
});

/** `overdue` is derived against the day asked about. No column holds it (ADR-0071). */
export const assignmentView = (state: AssignmentState, asOf: string): AssignmentView => ({
  assignmentId: state.assignmentId,
  employmentId: state.employmentId,
  courseId: state.courseId,
  source: state.source,
  status: state.status,
  overdue: isOverdue(state, asOf),
  assignedBy: state.assignedBy,
  version: state.version,
  ...definedOf({
    mandatoryRuleId: state.mandatoryRuleId,
    pathId: state.pathId,
    occurrenceKey: state.occurrenceKey,
    dueOn: state.dueOn,
  }),
});

export const enrolmentView = (state: EnrolmentState): EnrolmentView => ({
  enrolmentId: state.enrolmentId,
  employmentId: state.employmentId,
  courseId: state.courseId,
  courseVersionId: state.courseVersionId,
  status: state.status,
  version: state.version,
  ...definedOf({
    assignmentId: state.assignmentId,
    completedOn: state.completedOn,
    completedBy: state.completedBy,
  }),
});

/** `validity` is derived against the day asked about, with the caller's notice window (ADR-0070). */
export const certificationView = (
  state: CertificationState,
  asOf: string,
  noticeDays = 0,
): CertificationView => ({
  certificationId: state.certificationId,
  employmentId: state.employmentId,
  title: state.title,
  source: state.source,
  status: state.status,
  issuedOn: state.issuedOn,
  validity: validityOf(state, asOf, noticeDays),
  issuedBy: state.issuedBy,
  version: state.version,
  ...definedOf({
    enrolmentId: state.enrolmentId,
    courseId: state.courseId,
    validUntil: state.validUntil,
    evidenceDocumentId: state.evidenceDocumentId,
  }),
});

export const instructorView = (state: InstructorState): InstructorView => ({
  instructorId: state.instructorId,
  active: state.active,
  version: state.version,
  ...definedOf({
    employmentId: state.employmentId,
    externalName: state.externalName,
    externalOrganization: state.externalOrganization,
  }),
});
