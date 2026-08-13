import type {
  AssessmentResultView,
  AssignmentView,
  CertificationView,
  CourseVersionView,
  CourseView,
  EnrolmentView,
  InstructorView,
  LearningHistoryView,
  MandatoryRuleView,
} from '@work/learning/contracts';

/**
 * The published views these render suites feed the sections, one builder each.
 *
 * Shared rather than duplicated across the two suites because they are the *contract's* shapes: a
 * field the module adds or removes breaks compilation here once, in the place that describes what
 * the API actually sends, instead of in a dozen literals that drifted apart.
 *
 * Every builder returns a complete, valid view and takes overrides. An optional field is absent
 * rather than `undefined` where a suite needs it missing — `exactOptionalPropertyTypes` makes those
 * different shapes, and only the first is what the API sends.
 */

export const aCourse = (overrides: Partial<CourseView> = {}): CourseView => ({
  courseId: '01930000-0000-7000-8000-000000000001',
  code: 'fire-safety',
  name: { en: 'Fire safety', ar: 'السلامة من الحرائق' },
  delivery: 'classroom',
  status: 'published',
  currentVersionId: '01930000-0000-7000-8000-000000000002',
  versionCount: 2,
  version: 3,
  ...overrides,
});

export const aVersion = (overrides: Partial<CourseVersionView> = {}): CourseVersionView => ({
  courseVersionId: '01930000-0000-7000-8000-000000000002',
  courseId: '01930000-0000-7000-8000-000000000001',
  versionNumber: 1,
  title: { en: 'Fire safety v1', ar: 'السلامة ١' },
  requiresAssessment: true,
  certificationValidMonths: 12,
  publishedAt: '2026-01-01T09:00:00.000Z',
  publishedBy: 'user:learning-hr',
  ...overrides,
});

export const aRule = (overrides: Partial<MandatoryRuleView> = {}): MandatoryRuleView => ({
  mandatoryRuleId: '01930000-0000-7000-8000-000000000004',
  courseId: '01930000-0000-7000-8000-000000000001',
  name: { en: 'Annual fire safety', ar: 'السلامة السنوية' },
  kind: 'safety',
  audience: 'organization_unit',
  organizationUnitId: '01930000-0000-7000-8000-00000000000e',
  effectiveFrom: '2024-01-01',
  recurrenceMonths: 12,
  dueWithinDays: 30,
  active: true,
  version: 1,
  ...overrides,
});

export const anAssignment = (overrides: Partial<AssignmentView> = {}): AssignmentView => ({
  assignmentId: '01930000-0000-7000-8000-000000000005',
  employmentId: '01930000-0000-7000-8000-000000000006',
  courseId: '01930000-0000-7000-8000-000000000001',
  source: 'mandatory_rule',
  mandatoryRuleId: '01930000-0000-7000-8000-000000000004',
  occurrenceKey: '2024-01-01',
  status: 'assigned',
  dueOn: '2026-09-30',
  overdue: true,
  assignedBy: 'user:learning-hr',
  version: 1,
  ...overrides,
});

export const anEnrolment = (overrides: Partial<EnrolmentView> = {}): EnrolmentView => ({
  enrolmentId: '01930000-0000-7000-8000-000000000007',
  employmentId: '01930000-0000-7000-8000-000000000006',
  courseId: '01930000-0000-7000-8000-000000000001',
  courseVersionId: '01930000-0000-7000-8000-000000000002',
  status: 'completed',
  completedOn: '2026-08-12',
  completedBy: 'user:learning-hr',
  version: 3,
  ...overrides,
});

export const aCertificate = (overrides: Partial<CertificationView> = {}): CertificationView => ({
  certificationId: '01930000-0000-7000-8000-000000000008',
  employmentId: '01930000-0000-7000-8000-000000000006',
  title: 'Fire safety',
  source: 'learning_completion',
  status: 'active',
  issuedOn: '2026-08-12',
  validUntil: '2027-08-12',
  validity: 'valid',
  evidenceDocumentId: '01930000-0000-7000-8000-000000000009',
  issuedBy: 'user:learning-hr',
  version: 1,
  ...overrides,
});

export const aResult = (overrides: Partial<AssessmentResultView> = {}): AssessmentResultView => ({
  resultId: '01930000-0000-7000-8000-00000000000a',
  assessmentId: '01930000-0000-7000-8000-00000000000b',
  enrolmentId: '01930000-0000-7000-8000-000000000007',
  outcome: 'passed',
  rawMark: '18.50',
  rawMarkScale: 'out of 20',
  assessedOn: '2026-08-12',
  assessedBy: 'user:learning-hr',
  ...overrides,
});

export const anInstructor = (overrides: Partial<InstructorView> = {}): InstructorView => ({
  instructorId: '01930000-0000-7000-8000-00000000000c',
  externalName: { en: 'Civil Defence Academy', ar: 'أكاديمية الدفاع المدني' },
  externalOrganization: 'Civil Defence',
  active: true,
  version: 1,
  ...overrides,
});

export const aHistory = (): LearningHistoryView => ({
  employmentId: '01930000-0000-7000-8000-000000000006',
  asOf: '2026-08-12',
  assignments: [anAssignment()],
  enrolments: [anEnrolment()],
  certifications: [aCertificate()],
  openAssignments: 1,
  overdueAssignments: 1,
  completedCourses: 1,
  activeCertifications: 1,
  expiringCertifications: 0,
});
