/**
 * What a caller must hold, and the separations that matter.
 *
 * **`catalogue.manage` and `assignment.manage` are separate.** Building a course catalogue is an
 * administrator's job; putting a named requirement on a named person's queue is a manager's. One
 * permission covering both would let whoever maintains the catalogue quietly oblige anybody.
 *
 * **`assignment.waive` is not implied by `assignment.manage`.** Waiving is the one act in this
 * module that excuses somebody from a compliance obligation, and it is the one an auditor asks
 * about a year later. It is granted deliberately or not at all.
 *
 * **`enrolment.complete` is separate from `enrolment.manage`.** Enrolling somebody on a course and
 * recording that they finished it are different statements: the second is evidence a certification
 * is issued from, and it is what a safety audit reads.
 *
 * **`certification.revoke` is separate from `certification.manage`.** Issuing is routine; taking a
 * qualification away from somebody is not, and it needs a reason and a name against it.
 *
 * **`assignment.read-team` and `assignment.read-all` are separate**, for the reason Performance
 * separates its own: a manager reading their reports is a different capability from HR reading the
 * organization. `read-team` is resolved from Employment's reporting line at the moment of the read
 * and never from an employment identifier the caller supplied, which would be an IDOR by another
 * name.
 *
 * **`assignment.read-own` and `certification.read-own` are declared and enforced nowhere**, exactly
 * as `read-own` is in Attendance, Compensation, Documents, Leave, Payroll and Performance. There is
 * no authenticated-principal-to-employment resolution in this repository (ADR-0032), so these name
 * a capability the platform cannot yet grant. They exist so the contract does; self-service routing
 * is `NOT VERIFIED`, and accepting an employment identifier from the client instead would let
 * anybody read anybody's training record by changing a number in a URL.
 */
export const LearningPermissions = {
  /** Courses, versions, assessments and the tenant's own course taxonomy. */
  catalogueRead: 'learning.catalogue.read',
  catalogueManage: 'learning.catalogue.manage',

  pathRead: 'learning.path.read',
  pathManage: 'learning.path.manage',

  /** What a tenant made mandatory, and of whom. */
  mandatoryRead: 'learning.mandatory.read',
  mandatoryManage: 'learning.mandatory.manage',

  assignmentRead: 'learning.assignment.read',
  /** A manager's own reports. Resolved from Employment, never from a supplied identifier. */
  assignmentReadTeam: 'learning.assignment.read-team',
  assignmentReadAll: 'learning.assignment.read-all',
  /** Declared; enforced nowhere. Self-service routing does not exist (ADR-0032). */
  assignmentReadOwn: 'learning.assignment.read-own',
  assignmentManage: 'learning.assignment.manage',
  /** Excusing somebody from a compliance obligation. Deliberately not implied by `manage`. */
  assignmentWaive: 'learning.assignment.waive',

  enrolmentRead: 'learning.enrolment.read',
  enrolmentManage: 'learning.enrolment.manage',
  /** Recording that somebody finished. What a certification is issued from. */
  enrolmentComplete: 'learning.enrolment.complete',

  assessmentRead: 'learning.assessment.read',
  /** Recording an outcome. This product computes none; an authorized assessor states one. */
  assessmentRecord: 'learning.assessment.record',

  certificationRead: 'learning.certification.read',
  /** Declared; enforced nowhere, for the same reason as `assignment.read-own`. */
  certificationReadOwn: 'learning.certification.read-own',
  certificationManage: 'learning.certification.manage',
  /** Taking a qualification away. Needs a reason and a name; never implied by `manage`. */
  certificationRevoke: 'learning.certification.revoke',

  instructorRead: 'learning.instructor.read',
  instructorManage: 'learning.instructor.manage',

  /** Running the requirement reconciliation. A list of who is out of compliance is worth guarding. */
  reconcile: 'learning.reconcile',
} as const;

export type LearningPermission = (typeof LearningPermissions)[keyof typeof LearningPermissions];

export const ALL_LEARNING_PERMISSIONS: readonly string[] = Object.values(LearningPermissions);

/**
 * The permissions that are declared but reach nothing, named once rather than remembered.
 *
 * The administration screen still offers them, because the contract is real and a tenant may want
 * to grant it in advance. Nothing routes on them, and the checkpoint report lists them as
 * `NOT VERIFIED` rather than as features.
 */
export const UNROUTED_LEARNING_PERMISSIONS: readonly string[] = [
  LearningPermissions.assignmentReadOwn,
  LearningPermissions.certificationReadOwn,
];
