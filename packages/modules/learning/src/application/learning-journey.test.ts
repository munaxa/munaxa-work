import { beforeEach, describe, expect, it } from 'vitest';

import type { CourseDetail } from './learning-queries.js';
import type {
  AssignmentView,
  CertificationView,
  EnrolmentView,
  PathDetailView,
} from '../contracts/views.js';
import {
  HR,
  TODAY,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  send,
  type Harness,
} from './learning-test-harness.js';
import {
  EMPLOYMENT,
  aCompletedCourse,
  aPublishedCourse,
  withWorkforce,
} from './learning-scenarios.js';

/**
 * The path this module exists for, end to end: a catalogue, a requirement, somebody doing the
 * course, and the certificate that comes out of it.
 *
 * Every step goes through the real dispatcher and the real handlers. Nothing is seeded into a store,
 * because a state the commands cannot produce is a state this product does not have.
 */

describe('the learning journey', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('takes a course from draft to published, keeping every version readable', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await send(harness, {
        commandName: 'learning.publish-course-version',
        courseId: course.courseId,
        expectedVersion: 2,
        title: { en: 'Fire safety v2', ar: 'السلامة ٢' },
        requiresAssessment: false,
      });

      const detail = await ask<CourseDetail>(harness, {
        queryName: 'learning.read-course',
        courseId: course.courseId,
      });

      expect(detail.course.status).toBe('published');
      expect(detail.course.versionCount).toBe(2);
      // AD-004: the first version is still there, and still says what it said.
      expect(detail.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
      expect(detail.course.currentVersionId).not.toBe(course.courseVersionId);
    });
  });

  it('refuses a second course with the same code rather than quietly making one', async () => {
    await harness.as(HR, async () => {
      await aPublishedCourse(harness);

      const again = await attempt(harness, {
        commandName: 'learning.create-course',
        code: 'fire-safety',
        name: { en: 'Fire safety', ar: 'السلامة' },
        delivery: 'virtual',
      });

      expect(reasonOf(again)).toBe('course_code_taken');
    });
  });

  it('assigns, enrols, completes, and closes the assignment the enrolment came from', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const assignment = await send<{ assignmentId: string }>(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
        dueOn: '2026-09-30',
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
        assignmentId: assignment.assignmentId,
      });

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });
      await send(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });

      const assignments = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYMENT,
      });

      expect(assignments.items[0]?.status).toBe('satisfied');
      expect(assignments.items[0]?.overdue).toBe(false);
    });
  });

  it('pins the version an enrolment was taken under, so a later rewrite does not move it', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      await send(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });
      await send(harness, {
        commandName: 'learning.publish-course-version',
        courseId: course.courseId,
        expectedVersion: 2,
        title: { en: 'Rewritten', ar: 'معاد كتابته' },
        requiresAssessment: false,
      });

      const enrolments = await ask<{ readonly items: readonly EnrolmentView[] }>(harness, {
        queryName: 'learning.search-enrolments',
        employmentId: EMPLOYMENT,
      });

      expect(enrolments.items[0]?.courseVersionId).toBe(course.courseVersionId);
    });
  });

  it('issues a certification from a completion, with the version’s configured validity', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness, { certificationValidMonths: 12 });
      const completed = await aCompletedCourse(harness, course, '2026-08-12');

      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        enrolmentId: completed.enrolmentId,
        courseId: course.courseId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: '2026-08-12',
      });

      const found = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
        queryName: 'learning.search-certifications',
        employmentId: EMPLOYMENT,
      });

      expect(found.items[0]?.validUntil).toBe('2027-08-12');
      expect(found.items[0]?.validity).toBe('valid');
    });
  });

  it('records a certification somebody already held, inventing no enrolment for it', async () => {
    await harness.as(HR, async () => {
      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        validUntil: '2029-01-15',
      });

      const found = await ask<{ readonly items: readonly CertificationView[] }>(harness, {
        queryName: 'learning.search-certifications',
        employmentId: EMPLOYMENT,
      });

      expect(found.items[0]?.source).toBe('external');
      expect(found.items[0]?.enrolmentId).toBeUndefined();
      expect(harness.stores.tables.enrolments.size).toBe(0);
    });
  });

  it('closes an open requirement with a certification the person already holds', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await send(harness, {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });
      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
        title: 'Fire safety, obtained elsewhere',
        source: 'external',
        issuedOn: '2026-08-01',
      });

      const assignments = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYMENT,
      });

      expect(assignments.items[0]?.status).toBe('satisfied');
    });
  });

  it('builds a path, refusing to publish one with nothing in it', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const { pathId } = await send<{ pathId: string }>(harness, {
        commandName: 'learning.create-path',
        code: 'induction',
        name: { en: 'Induction', ar: 'التعريف' },
        kind: 'role_based',
      });

      const empty = await attempt(harness, {
        commandName: 'learning.publish-path',
        pathId,
        expectedVersion: 1,
      });

      expect(reasonOf(empty)).toBe('learning.rejection.path-requires-steps');

      await send(harness, {
        commandName: 'learning.add-path-step',
        pathId,
        courseId: course.courseId,
        sequence: 1,
        optional: false,
      });
      await send(harness, { commandName: 'learning.publish-path', pathId, expectedVersion: 1 });

      const detail = await ask<PathDetailView>(harness, {
        queryName: 'learning.read-path',
        pathId,
      });

      expect(detail.status).toBe('published');
      expect(detail.steps).toHaveLength(1);
    });
  });

  it('refuses a second course at the same position in a path, and a duplicate course', async () => {
    await harness.as(HR, async () => {
      const first = await aPublishedCourse(harness);
      const second = await aPublishedCourse(harness, { code: 'manual-handling' });
      const { pathId } = await send<{ pathId: string }>(harness, {
        commandName: 'learning.create-path',
        code: 'induction',
        name: { en: 'Induction', ar: 'التعريف' },
        kind: 'custom',
      });
      const step = {
        commandName: 'learning.add-path-step',
        pathId,
        courseId: first.courseId,
        sequence: 1,
        optional: false,
      };

      await send(harness, step);
      expect(reasonOf(await attempt(harness, step))).toBe('path_step_course_taken');
      expect(reasonOf(await attempt(harness, { ...step, courseId: second.courseId }))).toBe(
        'path_step_sequence_taken',
      );
    });
  });
});
