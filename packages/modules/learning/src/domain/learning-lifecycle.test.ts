import { describe, expect, it } from 'vitest';

import {
  archiveCourse,
  createCourse,
  isEnrollable,
  publishCourse,
  publishVersion,
} from './course.js';
import {
  completeEnrolment,
  enrol,
  failEnrolment,
  hasEnded,
  startEnrolment,
  withdrawEnrolment,
} from './enrolment.js';
import { type CourseState } from './course.js';
import { type EnrolmentState } from './enrolment.js';

/**
 * The lifecycles this module was told to use, and the edits it refuses.
 *
 * D-3 approved one vocabulary for each aggregate and forbade inventing a second. These are the cases
 * where a lifecycle either means something or is decoration: a course that cannot be enrolled into
 * before it publishes anything, an enrolment that never completes itself, and a completion nobody can
 * edit afterwards.
 */

const NAME = { en: 'Fire safety', ar: 'السلامة من الحرائق' };
const AT = new Date('2026-03-01T09:00:00.000Z');

const course = (): CourseState => {
  const created = createCourse({
    courseId: 'course-1',
    code: 'fire-safety',
    name: NAME,
    delivery: 'classroom',
  });

  if (!created.ok) throw new Error(created.error.reason);
  return created.value;
};

const enrolment = (): EnrolmentState => {
  const created = enrol({
    enrolmentId: 'enrolment-1',
    employmentId: 'employment-1',
    courseId: 'course-1',
    courseVersionId: 'version-3',
    at: AT,
    by: 'user-admin',
  });

  if (!created.ok) throw new Error(created.error.reason);
  return created.value;
};

describe('a course', () => {
  it('starts in draft with nothing published and cannot be enrolled into', () => {
    const state = course();

    expect(state.status).toBe('draft');
    expect(state.currentVersionId).toBeUndefined();
    expect(isEnrollable(state)).toBe(false);
  });

  it('refuses a code that is not the shape every module in this repository uses', () => {
    const created = createCourse({
      courseId: 'course-1',
      code: 'Fire Safety!',
      name: NAME,
      delivery: 'classroom',
    });

    expect(created.ok).toBe(false);
    if (!created.ok)
      expect(created.error.messageKey).toBe('learning.rejection.course-code-invalid');
  });

  it('refuses a name in one language only, because this product renders both', () => {
    const created = createCourse({
      courseId: 'course-1',
      code: 'fire-safety',
      name: { en: 'Fire safety', ar: '  ' },
      delivery: 'classroom',
    });

    expect(created.ok).toBe(false);
  });

  it('becomes enrollable only once a version exists behind it', () => {
    const published = publishCourse(course(), 'version-1', 1);

    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(isEnrollable(published.value)).toBe(true);
    expect(published.value.currentVersionId).toBe('version-1');
  });

  it('is archived rather than deleted, and archival is terminal', () => {
    const archived = archiveCourse(course(), AT, 'user-admin');

    expect(archived.ok).toBe(true);
    if (!archived.ok) return;

    const again = archiveCourse(archived.value, AT, 'user-admin');
    const republished = publishCourse(archived.value, 'version-2', 2);

    expect(again.ok).toBe(false);
    expect(republished.ok).toBe(false);
    if (!republished.ok) expect(republished.error.reason).toBe('course-archived');
  });
});

describe('a course version', () => {
  const request = {
    courseVersionId: 'version-1',
    courseId: 'course-1',
    versionNumber: 1,
    title: NAME,
    requiresAssessment: false,
    publishedAt: AT,
    publishedBy: 'user-admin',
  };

  it('records what the tenant configured and invents no assessment rule of its own', () => {
    const version = publishVersion(request);

    expect(version.ok).toBe(true);
    if (version.ok) expect(version.value.requiresAssessment).toBe(false);
  });

  it('refuses a validity period that is not whole months in a plausible range', () => {
    const fractional = publishVersion({ ...request, certificationValidMonths: 12.5 });
    const absurd = publishVersion({ ...request, certificationValidMonths: 9000 });

    expect(fractional.ok).toBe(false);
    expect(absurd.ok).toBe(false);
  });

  it('refuses a duration that is not a positive whole number of minutes', () => {
    expect(publishVersion({ ...request, durationMinutes: 0 }).ok).toBe(false);
    expect(publishVersion({ ...request, durationMinutes: -30 }).ok).toBe(false);
  });
});

describe('an enrolment', () => {
  const completion = {
    at: AT,
    by: 'user-manager',
    requiresAssessment: false,
    hasPassedAssessment: false,
  };

  it('pins the course version, so history stays readable after the syllabus is rewritten', () => {
    expect(enrolment().courseVersionId).toBe('version-3');
  });

  it('does not complete itself: enrolled is not in progress and in progress is not completed', () => {
    const enrolled = enrolment();

    expect(enrolled.status).toBe('enrolled');
    expect(completeEnrolment(enrolled, completion).ok).toBe(false);

    const started = startEnrolment(enrolled, AT);

    expect(started.ok).toBe(true);
    if (started.ok) expect(started.value.status).toBe('in_progress');
  });

  it('refuses a completion recorded by the auto-approver', () => {
    const started = startEnrolment(enrolment(), AT);

    if (!started.ok) throw new Error(started.error.reason);

    const completed = completeEnrolment(started.value, {
      ...completion,
      by: 'system:auto-approval',
    });

    expect(completed.ok).toBe(false);
    if (!completed.ok) expect(completed.error.reason).toBe('completion-not-human');
  });

  it('refuses completion where the tenant required an assessment and none passed', () => {
    const started = startEnrolment(enrolment(), AT);

    if (!started.ok) throw new Error(started.error.reason);

    const blocked = completeEnrolment(started.value, {
      ...completion,
      requiresAssessment: true,
      hasPassedAssessment: false,
    });
    const allowed = completeEnrolment(started.value, {
      ...completion,
      requiresAssessment: true,
      hasPassedAssessment: true,
    });

    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.reason).toBe('completion-requires-assessment');
    expect(allowed.ok).toBe(true);
  });

  it('treats a completion as immutable — a correction is a new enrolment', () => {
    const started = startEnrolment(enrolment(), AT);

    if (!started.ok) throw new Error(started.error.reason);

    const completed = completeEnrolment(started.value, completion);

    if (!completed.ok) throw new Error(completed.error.reason);

    expect(withdrawEnrolment(completed.value, AT).ok).toBe(false);
    expect(failEnrolment(completed.value, AT, 'user-manager').ok).toBe(false);
    expect(completeEnrolment(completed.value, completion).ok).toBe(false);
  });

  it('keeps withdrawing and failing apart, because they describe different people', () => {
    const started = startEnrolment(enrolment(), AT);

    if (!started.ok) throw new Error(started.error.reason);

    const failed = failEnrolment(started.value, AT, 'user-manager', 'Did not pass the practical');
    const withdrawn = withdrawEnrolment(started.value, AT, 'Left the organisation');

    expect(failed.ok && failed.value.status).toBe('failed');
    expect(withdrawn.ok && withdrawn.value.status).toBe('withdrawn');
    expect(failed.ok && hasEnded(failed.value)).toBe(true);
    expect(withdrawn.ok && hasEnded(withdrawn.value)).toBe(true);
  });

  it('cannot be withdrawn from twice, and every ending is terminal', () => {
    const withdrawn = withdrawEnrolment(enrolment(), AT);

    if (!withdrawn.ok) throw new Error(withdrawn.error.reason);
    expect(startEnrolment(withdrawn.value, AT).ok).toBe(false);
    expect(withdrawEnrolment(withdrawn.value, AT).ok).toBe(false);
  });
});
