import type {
  AssignmentView,
  CertificationView,
  CourseView,
  EnrolmentView,
  InstructorView,
  MandatoryRuleView,
  PathView,
} from '@work/learning/contracts';

/**
 * Which actions a course's, a path's, a requirement's, an enrolment's or a certificate's state
 * permits, and which it does not.
 *
 * **This is not authorization.** The API is authoritative and refuses every one of these
 * independently — a stale version earns a 409, an invalid transition a 422, a missing permission a
 * 403 — and a caller with `curl` reaches the same handler this screen does. What this gives an HR
 * administrator is an interface that does not name an action the system is going to refuse, which
 * is a usability property rather than a security one. Hiding a control has never stopped anybody,
 * and nothing here relies on it having done so.
 *
 * Two of these actions stand on permissions the rest do not imply, and this file cannot know
 * whether the reader holds them: **waiving** excuses somebody from a compliance obligation, and
 * **revoking** takes a qualification away. Both are named where the record's state allows them and
 * both are refused by the API for a caller holding only `manage`.
 *
 * The rules are read straight off each record's own state, never recomputed from parts:
 *
 * - **An archived course or path offers nothing.** Archival is terminal and it is not deletion: a
 *   certificate issued from a 2023 version stays explainable, which is the whole reason the row is
 *   still there.
 * - **A draft course cannot be made mandatory.** It offers publication first, because a requirement
 *   pointing at a course nobody can enrol into obliges people to do something impossible.
 * - **A path with no steps publishes nothing** — anybody could satisfy it by doing nothing at all —
 *   so publication is offered only once it has one.
 * - **A closed assignment is terminal**, whichever way it closed. Satisfied, waived and cancelled
 *   are all endings, and none of them reopens.
 * - **There is no satisfy action.** An assignment is satisfied by a completion or by a certificate
 *   issued against it, in the same transaction as the act that earned it. Naming a standalone
 *   satisfy would offer to close a compliance obligation with no evidence behind it, and the API
 *   has no route for it.
 * - **There is no supersede action.** Superseding is what issuing the *next* certificate does; an
 *   action that superseded without issuing would leave somebody holding nothing.
 * - **A completed enrolment offers issuance, not editing.** What somebody finished is a thing that
 *   happened, and a trigger refuses the update that would rewrite it.
 */

export const COURSE_ACTIONS = ['update', 'publish', 'defineAssessment', 'archive'] as const;
export type CourseAction = (typeof COURSE_ACTIONS)[number];

export const PATH_ACTIONS = ['addStep', 'removeStep', 'publish', 'archive'] as const;
export type PathAction = (typeof PATH_ACTIONS)[number];

export const RULE_ACTIONS = ['reconcile', 'retire'] as const;
export type RuleAction = (typeof RULE_ACTIONS)[number];

export const ASSIGNMENT_ACTIONS = ['enrol', 'waive', 'cancel'] as const;
export type AssignmentAction = (typeof ASSIGNMENT_ACTIONS)[number];

export const ENROLMENT_ACTIONS = [
  'start',
  'recordResult',
  'complete',
  'fail',
  'withdraw',
  'issue',
] as const;
export type EnrolmentAction = (typeof ENROLMENT_ACTIONS)[number];

export const CERTIFICATION_ACTIONS = ['revoke'] as const;
export type CertificationAction = (typeof CERTIFICATION_ACTIONS)[number];

export const INSTRUCTOR_ACTIONS = ['deactivate'] as const;
export type InstructorAction = (typeof INSTRUCTOR_ACTIONS)[number];

const CLOSED_ASSIGNMENTS = new Set(['satisfied', 'waived', 'cancelled']);
const ENDED_ENROLMENTS = new Set(['failed', 'withdrawn']);

export const courseActionsFor = (course: CourseView | undefined): ReadonlySet<CourseAction> => {
  const permitted = new Set<CourseAction>();

  if (course === undefined || course.status === 'archived') return permitted;

  permitted.add('update');
  permitted.add('publish');
  permitted.add('archive');

  // An assessment belongs to a version, so there is nothing to attach one to until one exists.
  if (course.currentVersionId !== undefined) permitted.add('defineAssessment');
  return permitted;
};

export const pathActionsFor = (path: PathView | undefined): ReadonlySet<PathAction> => {
  const permitted = new Set<PathAction>();

  if (path === undefined || path.status === 'archived') return permitted;

  permitted.add('addStep');
  permitted.add('archive');

  if (path.stepCount === 0) return permitted;

  permitted.add('removeStep');
  // Only a draft publishes. A published path is already published, and republishing is not an act.
  if (path.status === 'draft') permitted.add('publish');
  return permitted;
};

export const ruleActionsFor = (rule: MandatoryRuleView | undefined): ReadonlySet<RuleAction> => {
  const permitted = new Set<RuleAction>();

  // A retired rule implies nothing new, so there is nothing left to reconcile and nothing to retire.
  if (rule === undefined || !rule.active) return permitted;

  permitted.add('reconcile');
  permitted.add('retire');
  return permitted;
};

export const assignmentActionsFor = (
  assignment: AssignmentView | undefined,
): ReadonlySet<AssignmentAction> => {
  const permitted = new Set<AssignmentAction>();

  if (assignment === undefined || CLOSED_ASSIGNMENTS.has(assignment.status)) return permitted;

  // Enrolling is how it is satisfied. There is no action that satisfies it directly — see above.
  permitted.add('enrol');
  permitted.add('waive');
  permitted.add('cancel');
  return permitted;
};

export const enrolmentActionsFor = (
  enrolment: EnrolmentView | undefined,
): ReadonlySet<EnrolmentAction> => {
  const permitted = new Set<EnrolmentAction>();

  if (enrolment === undefined || ENDED_ENROLMENTS.has(enrolment.status)) return permitted;

  if (enrolment.status === 'completed') {
    // Terminal but readable. A certificate is issued *from* it; the completion itself is immutable.
    permitted.add('issue');
    return permitted;
  }
  if (enrolment.status === 'enrolled') {
    permitted.add('start');
    permitted.add('withdraw');
    return permitted;
  }

  permitted.add('recordResult');
  permitted.add('complete');
  permitted.add('fail');
  permitted.add('withdraw');
  return permitted;
};

export const certificationActionsFor = (
  certification: CertificationView | undefined,
): ReadonlySet<CertificationAction> => {
  const permitted = new Set<CertificationAction>();

  // A revoked or superseded certificate is already gone. Revoking it again says nothing new.
  if (certification === undefined || certification.status !== 'active') return permitted;

  permitted.add('revoke');
  return permitted;
};

export const instructorActionsFor = (
  instructor: InstructorView | undefined,
): ReadonlySet<InstructorAction> => {
  const permitted = new Set<InstructorAction>();

  if (instructor === undefined || !instructor.active) return permitted;

  permitted.add('deactivate');
  return permitted;
};

/**
 * Why an action is not offered, as a catalogue key — never a blank, disabled control.
 *
 * A screen that simply omitted the controls would leave an administrator refreshing the page
 * wondering whether something had failed. Saying "an archived course is terminal" is the difference
 * between a rule and a bug.
 */
export const courseWithheldBecause = (course: CourseView | undefined): string | undefined =>
  course?.status === 'archived' ? 'learning.withheld.courseArchived' : undefined;

export const pathWithheldBecause = (path: PathView | undefined): string | undefined => {
  if (path === undefined) return undefined;
  if (path.status === 'archived') return 'learning.withheld.pathArchived';
  if (path.stepCount === 0) return 'learning.withheld.pathEmpty';
  return undefined;
};

export const ruleWithheldBecause = (rule: MandatoryRuleView | undefined): string | undefined =>
  rule !== undefined && !rule.active ? 'learning.withheld.ruleRetired' : undefined;

export const assignmentWithheldBecause = (
  assignment: AssignmentView | undefined,
): string | undefined =>
  assignment !== undefined && CLOSED_ASSIGNMENTS.has(assignment.status)
    ? 'learning.withheld.assignmentClosed'
    : undefined;

export const enrolmentWithheldBecause = (
  enrolment: EnrolmentView | undefined,
): string | undefined => {
  if (enrolment === undefined) return undefined;
  if (ENDED_ENROLMENTS.has(enrolment.status)) return 'learning.withheld.enrolmentEnded';
  if (enrolment.status === 'completed') return 'learning.withheld.enrolmentCompleted';
  return undefined;
};

export const certificationWithheldBecause = (
  certification: CertificationView | undefined,
): string | undefined => {
  if (certification === undefined) return undefined;
  if (certification.status === 'revoked') return 'learning.withheld.certificationRevoked';
  if (certification.status === 'superseded') return 'learning.withheld.certificationSuperseded';
  return undefined;
};
