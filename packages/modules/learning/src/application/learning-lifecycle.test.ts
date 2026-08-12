import { beforeEach, describe, expect, it } from 'vitest';

import { ConcurrencyException } from '@work/kernel';

import {
  HR,
  TODAY,
  attempt,
  harnessFor,
  reasonOf,
  send,
  type Harness,
} from './learning-test-harness.js';
import { EMPLOYMENT, aPublishedCourse, withWorkforce } from './learning-scenarios.js';

/**
 * Lifecycles, and the six ways a caller can try to break one.
 *
 * **Every transition is its own command.** There is no `set-status` anywhere in this module, so the
 * cases below are the only routes between states, and each one asks the aggregate rather than
 * writing a string.
 *
 * The optimistic version is what settles two callers moving the same record at the same moment. A
 * stale write raises `ConcurrencyException` from the store, exactly as
 * `update ... where version = $expected` affecting no rows does — and every module since Phase 2 lets
 * that travel to the edge, where it becomes a 409.
 */

describe('enrolment lifecycle', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  const anEnrolment = async (): Promise<{ enrolmentId: string; courseId: string }> => {
    const course = await aPublishedCourse(harness);
    const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
      commandName: 'learning.enrol',
      employmentId: EMPLOYMENT,
      courseId: course.courseId,
    });

    return { enrolmentId, courseId: course.courseId };
  };

  it('allows the valid transition and refuses the one the table forbids', async () => {
    await harness.as(HR, async () => {
      const { enrolmentId } = await anEnrolment();

      // Enrolled is not in progress: completing without starting is refused.
      const early = await attempt(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 1,
        completedOn: TODAY,
      });

      expect(reasonOf(early)).toBe('learning.rejection.enrolment-transition-refused');

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
    });
  });

  it('refuses a repeated transition and any transition out of a terminal state', async () => {
    await harness.as(HR, async () => {
      const { enrolmentId } = await anEnrolment();

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });

      const again = await attempt(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 2,
      });

      expect(reasonOf(again)).toBe('learning.rejection.enrolment-transition-refused');

      await send(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });

      for (const commandName of [
        'learning.withdraw-enrolment',
        'learning.fail-enrolment',
        'learning.start-enrolment',
      ]) {
        const refused = await attempt(harness, {
          commandName,
          enrolmentId,
          expectedVersion: 3,
          completedOn: TODAY,
        });

        expect([commandName, reasonOf(refused)]).toEqual([
          commandName,
          'learning.rejection.enrolment-transition-refused',
        ]);
      }
    });
  });

  it('refuses a stale write, which is what settles two callers moving one record at once', async () => {
    await harness.as(HR, async () => {
      const { enrolmentId } = await anEnrolment();

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });

      // The second caller read version 1 before the first moved it, and writes with what it read.
      await expect(
        send(harness, {
          commandName: 'learning.withdraw-enrolment',
          enrolmentId,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ConcurrencyException);
    });
  });

  it('keeps failing and withdrawing apart, because they describe different people', async () => {
    await harness.as(HR, async () => {
      const first = await anEnrolment();

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId: first.enrolmentId,
        expectedVersion: 1,
      });

      const failed = await send<{ status: string }>(harness, {
        commandName: 'learning.fail-enrolment',
        enrolmentId: first.enrolmentId,
        expectedVersion: 2,
        note: 'Did not pass the practical',
      });

      expect(failed.status).toBe('failed');

      // A retake is a new enrolment, because the ended one no longer holds the open slot.
      const retake = await send<{ enrolmentId: string; created: boolean }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: first.courseId,
      });

      expect(retake.created).toBe(true);
      expect(retake.enrolmentId).not.toBe(first.enrolmentId);
    });
  });

  it('refuses completion where the tenant requires an assessment and none has passed', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness, { requiresAssessment: true });
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: course.courseVersionId,
        title: { en: 'Practical', ar: 'عملي' },
        kind: 'practical',
        required: true,
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      await send(harness, {
        commandName: 'learning.start-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });

      const blocked = await attempt(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });

      expect(reasonOf(blocked)).toBe('learning.rejection.completion-requires-assessment');

      // A failed outcome does not unblock it either — only a passed one does.
      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'failed',
        assessedOn: TODAY,
      });
      expect(
        reasonOf(
          await attempt(harness, {
            commandName: 'learning.complete-enrolment',
            enrolmentId,
            expectedVersion: 2,
            completedOn: TODAY,
          }),
        ),
      ).toBe('learning.rejection.completion-requires-assessment');

      await send(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'passed',
        assessedOn: TODAY,
      });
      await send(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId,
        expectedVersion: 2,
        completedOn: TODAY,
      });
    });
  });

  it('refuses an assessment result against an enrolment that has already ended', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness, { requiresAssessment: true });
      const { assessmentId } = await send<{ assessmentId: string }>(harness, {
        commandName: 'learning.define-assessment',
        courseVersionId: course.courseVersionId,
        title: { en: 'Quiz', ar: 'اختبار' },
        kind: 'quiz',
        required: false,
      });
      const { enrolmentId } = await send<{ enrolmentId: string }>(harness, {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      });

      await send(harness, {
        commandName: 'learning.withdraw-enrolment',
        enrolmentId,
        expectedVersion: 1,
      });

      const late = await attempt(harness, {
        commandName: 'learning.record-assessment-result',
        assessmentId,
        enrolmentId,
        outcome: 'passed',
        assessedOn: TODAY,
      });

      expect(reasonOf(late)).toBe('learning.rejection.assessment-enrolment-closed');
    });
  });
});

describe('assignment lifecycle', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  const anAssignment = async (): Promise<string> => {
    const course = await aPublishedCourse(harness);
    const { assignmentId } = await send<{ assignmentId: string }>(harness, {
      commandName: 'learning.assign',
      employmentId: EMPLOYMENT,
      courseId: course.courseId,
      dueOn: '2026-09-30',
    });

    return assignmentId;
  };

  it('waives with a reason, and refuses a waiver with none', async () => {
    await harness.as(HR, async () => {
      const assignmentId = await anAssignment();

      const empty = await attempt(harness, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: '   ',
      });

      expect(reasonOf(empty)).toBe('learning.rejection.assignment-waiver-reason-required');

      const waived = await send<{ status: string }>(harness, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: 'Holds an equivalent licence',
      });

      expect(waived.status).toBe('waived');
    });
  });

  it('makes every ending terminal, so a waived requirement cannot quietly reopen', async () => {
    await harness.as(HR, async () => {
      const assignmentId = await anAssignment();

      await send(harness, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: 'On long-term leave',
      });

      const cancelled = await attempt(harness, {
        commandName: 'learning.cancel-assignment',
        assignmentId,
        expectedVersion: 2,
      });

      expect(reasonOf(cancelled)).toBe('learning.rejection.assignment-transition-refused');
    });
  });

  it('answers a waiver of a cancelled requirement with the rule, not with a version error', async () => {
    await harness.as(HR, async () => {
      const assignmentId = await anAssignment();

      await send(harness, {
        commandName: 'learning.cancel-assignment',
        assignmentId,
        expectedVersion: 1,
      });

      // The aggregate is asked before the store is, so the caller is told *why* rather than being
      // handed a concurrency error that reads as "try again" for something that will never succeed.
      const late = await attempt(harness, {
        commandName: 'learning.waive-assignment',
        assignmentId,
        expectedVersion: 1,
        reason: 'Too late',
      });

      expect(reasonOf(late)).toBe('learning.rejection.assignment-transition-refused');
    });
  });
});

describe('catalogue concurrency', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('refuses the second of two administrators publishing from the same read', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const next = {
        commandName: 'learning.publish-course-version',
        courseId: course.courseId,
        expectedVersion: 2,
        title: { en: 'v2', ar: '٢' },
        requiresAssessment: false,
      };

      await send(harness, next);
      // Both read version 2; the loser writes with what it read and is refused.
      await expect(send(harness, next)).rejects.toThrow(ConcurrencyException);
    });
  });
});
