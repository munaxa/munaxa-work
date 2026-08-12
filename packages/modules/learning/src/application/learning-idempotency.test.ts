import { beforeEach, describe, expect, it } from 'vitest';

import {
  HR,
  TODAY,
  attempt,
  harnessFor,
  reasonOf,
  send,
  type Harness,
} from './learning-test-harness.js';
import {
  EMPLOYMENT,
  aCompletedCourse,
  aMandatoryRule,
  aPublishedCourse,
  reconcile,
  withWorkforce,
} from './learning-scenarios.js';

/**
 * What happens when the same request arrives twice — from a retry, a double click, or two
 * administrators at once.
 *
 * Every case here converges on **one logical record**, and the decision is made by the uniqueness
 * guarantee rather than by a read-then-write check. A handler that read first and wrote second would
 * pass these tests single-threaded and fail in production, which is exactly the class of bug this
 * suite exists to prevent — so the in-memory stores enforce the same partial unique indexes the
 * schema carries, and `insertIfAbsent` is what every one of these paths goes through.
 *
 * Two cases converge on a **deterministic refusal** rather than a silent success: completing an
 * enrolment twice and moving anything out of a terminal state. That is the honest answer — the second
 * caller is told the record already ended, rather than being handed a second completion.
 */

describe('sending the same thing twice', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('assigns once, and the second attempt returns the assignment that exists', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const command = {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
        dueOn: '2026-09-30',
      };

      const first = await send<{ assignmentId: string; created: boolean }>(harness, command);
      const second = await send<{ assignmentId: string; created: boolean }>(harness, command);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.assignmentId).toBe(first.assignmentId);
      expect(harness.stores.tables.assignments.size).toBe(1);
    });
  });

  it('records one notification intent for one assignment, not one per attempt', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const command = {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      };

      await send(harness, command);
      await send(harness, command);

      // Intent, not delivery. Nothing in this product tells anybody anything.
      expect(harness.notifications.recorded).toHaveLength(1);
    });
  });

  it('enrols once, and the second attempt returns the open enrolment', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const command = {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      };

      const first = await send<{ enrolmentId: string; created: boolean }>(harness, command);
      const second = await send<{ enrolmentId: string; created: boolean }>(harness, command);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.enrolmentId).toBe(first.enrolmentId);
      expect(harness.stores.tables.enrolments.size).toBe(1);
    });
  });

  it('completes once, and refuses the second deterministically rather than completing again', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const completed = await aCompletedCourse(harness, course, TODAY);
      const again = await attempt(harness, {
        commandName: 'learning.complete-enrolment',
        enrolmentId: completed.enrolmentId,
        expectedVersion: 3,
        completedOn: TODAY,
      });

      // The transition table refuses it. The completion that stands is the first one, with the
      // first one's date and the first one's name against it.
      expect(reasonOf(again)).toBe('learning.rejection.enrolment-transition-refused');

      const held = harness.stores.tables.enrolments.get(completed.enrolmentId);

      expect(held?.status).toBe('completed');
      expect(held?.completedOn).toBe(TODAY);
    });
  });

  it('issues one certification per completion, and the second attempt returns it', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness, { certificationValidMonths: 12 });
      const completed = await aCompletedCourse(harness, course, TODAY);
      const command = {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        enrolmentId: completed.enrolmentId,
        courseId: course.courseId,
        title: 'Fire safety',
        source: 'learning_completion',
        issuedOn: TODAY,
      };

      const first = await send<{ certificationId: string; created: boolean }>(harness, command);
      const second = await send<{ certificationId: string; created: boolean }>(harness, command);

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      expect(second.certificationId).toBe(first.certificationId);
      expect(harness.stores.tables.certifications.size).toBe(1);
    });
  });

  it('generates a requirement once, however many times reconciliation runs', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      const first = await reconcile(harness, ruleId);
      const second = await reconcile(harness, ruleId);
      const third = await reconcile(harness, ruleId);

      expect(first.generated).toBe(2);
      expect(second).toMatchObject({ generated: 0, alreadyPresent: 2 });
      expect(third).toMatchObject({ generated: 0, alreadyPresent: 2 });
      expect(harness.stores.tables.assignments.size).toBe(2);
    });
  });

  it('produces exactly one occurrence when two administrators reconcile at the same moment', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      // Both start before either finishes. The index — not a prior read — decides which one writes.
      const [first, second] = await Promise.all([
        reconcile(harness, ruleId),
        reconcile(harness, ruleId),
      ]);

      expect(first.generated + second.generated).toBe(2);
      expect(first.alreadyPresent + second.alreadyPresent).toBe(2);
      expect(harness.stores.tables.assignments.size).toBe(2);
    });
  });

  it('produces exactly one assignment when two callers assign the same course at once', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const command = {
        commandName: 'learning.assign',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      };

      const outcomes = await Promise.all([
        send<{ assignmentId: string; created: boolean }>(harness, command),
        send<{ assignmentId: string; created: boolean }>(harness, command),
      ]);

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      expect(outcomes[0]?.assignmentId).toBe(outcomes[1]?.assignmentId);
      expect(harness.stores.tables.assignments.size).toBe(1);
    });
  });

  it('produces exactly one enrolment when two callers enrol the same person at once', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const command = {
        commandName: 'learning.enrol',
        employmentId: EMPLOYMENT,
        courseId: course.courseId,
      };

      const outcomes = await Promise.all([
        send<{ enrolmentId: string; created: boolean }>(harness, command),
        send<{ enrolmentId: string; created: boolean }>(harness, command),
      ]);

      expect(outcomes.filter((outcome) => outcome.created)).toHaveLength(1);
      expect(harness.stores.tables.enrolments.size).toBe(1);
    });
  });
});
