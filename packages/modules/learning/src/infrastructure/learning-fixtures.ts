import { uuidV7 } from '@work/kernel';

import type { AssessmentDefinitionState, AssessmentResultState } from '../domain/assessment.js';
import type { AssignmentState } from '../domain/assignment.js';
import type { CertificationState } from '../domain/certification.js';
import type { CourseState, CourseVersionState } from '../domain/course.js';
import type { EnrolmentState } from '../domain/enrolment.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type { PathState, PathStepState } from '../domain/path.js';

/**
 * Domain states the persistence suites write and read back.
 *
 * They are **states, not rows**: every suite goes in through the repository, so what is under test
 * is the mapping, the constraint and the policy — not a hand-written `insert` that happens to agree
 * with the mapper it was written beside.
 *
 * Identifiers are UUIDv7 because the columns are `uuid` and the schema means it. A fixture that
 * used `'course-1'` would fail at the type cast rather than at the assertion, and the failure would
 * name the wrong thing.
 */

export const EMPLOYMENT = uuidV7();
export const OTHER_EMPLOYMENT = uuidV7();
export const UNIT = uuidV7();
export const NOW = new Date('2026-08-12T09:00:00.000Z');
export const TODAY = '2026-08-12';

export const aCourse = (over: Partial<CourseState> = {}): CourseState => ({
  courseId: uuidV7(),
  code: `course-${uuidV7().slice(0, 8)}`,
  name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
  delivery: 'classroom',
  status: 'draft',
  versionCount: 0,
  version: 1,
  ...over,
});

export const aCourseVersion = (
  courseId: string,
  over: Partial<CourseVersionState> = {},
): CourseVersionState => ({
  courseVersionId: uuidV7(),
  courseId,
  versionNumber: 1,
  title: { en: 'Fire safety v1', ar: 'السلامة ١' },
  requiresAssessment: false,
  publishedAt: NOW,
  publishedBy: 'user:test',
  version: 1,
  ...over,
});

export const anAssessment = (
  courseVersionId: string,
  over: Partial<AssessmentDefinitionState> = {},
): AssessmentDefinitionState => ({
  assessmentId: uuidV7(),
  courseVersionId,
  title: { en: 'Practical', ar: 'عملي' },
  kind: 'practical',
  required: true,
  version: 1,
  ...over,
});

export const aResult = (
  assessmentId: string,
  enrolmentId: string,
  over: Partial<AssessmentResultState> = {},
): AssessmentResultState => ({
  resultId: uuidV7(),
  assessmentId,
  enrolmentId,
  employmentId: EMPLOYMENT,
  outcome: 'passed',
  assessedOn: TODAY,
  assessedBy: 'user:assessor',
  recordedAt: NOW,
  ...over,
});

export const aPath = (over: Partial<PathState> = {}): PathState => ({
  pathId: uuidV7(),
  code: `path-${uuidV7().slice(0, 8)}`,
  name: { en: 'Induction', ar: 'التعريف' },
  kind: 'role_based',
  status: 'draft',
  stepCount: 0,
  version: 1,
  ...over,
});

export const aPathStep = (
  pathId: string,
  courseId: string,
  over: Partial<PathStepState> = {},
): PathStepState => ({
  stepId: uuidV7(),
  pathId,
  courseId,
  sequence: 1,
  optional: false,
  version: 1,
  ...over,
});

export const aRule = (
  courseId: string,
  over: Partial<MandatoryRuleState> = {},
): MandatoryRuleState => ({
  mandatoryRuleId: uuidV7(),
  courseId,
  name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
  kind: 'safety',
  audience: 'everybody',
  effectiveFrom: '2024-01-01',
  recurrenceMonths: 12,
  dueWithinDays: 30,
  active: true,
  version: 1,
  ...over,
});

export const anAssignment = (
  courseId: string,
  over: Partial<AssignmentState> = {},
): AssignmentState => ({
  assignmentId: uuidV7(),
  employmentId: EMPLOYMENT,
  courseId,
  source: 'direct',
  status: 'assigned',
  assignedAt: NOW,
  assignedBy: 'user:test',
  version: 1,
  ...over,
});

export const anEnrolment = (
  courseId: string,
  courseVersionId: string,
  over: Partial<EnrolmentState> = {},
): EnrolmentState => ({
  enrolmentId: uuidV7(),
  employmentId: EMPLOYMENT,
  courseId,
  courseVersionId,
  status: 'enrolled',
  enrolledAt: NOW,
  enrolledBy: 'user:test',
  version: 1,
  ...over,
});

export const aCertification = (over: Partial<CertificationState> = {}): CertificationState => ({
  certificationId: uuidV7(),
  employmentId: EMPLOYMENT,
  title: 'Forklift licence',
  source: 'external',
  status: 'active',
  issuedOn: '2026-01-15',
  issuedBy: 'user:test',
  version: 1,
  ...over,
});
