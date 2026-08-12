import { beforeEach, describe, expect, it } from 'vitest';

import type { LearningHistoryView } from '../contracts/views.js';
import { HR, TODAY, ask, harnessFor, send, type Harness } from './learning-test-harness.js';
import {
  EMPLOYMENT,
  aCompletedCourse,
  aMandatoryRule,
  aPublishedCourse,
  reconcile,
  withWorkforce,
} from './learning-scenarios.js';

/**
 * One person's learning record, assembled on read (ADR-0008).
 *
 * The property worth protecting is that the header can never disagree with the list beneath it: the
 * counts are derived from the same rows the view renders, by the same functions, so there is nothing
 * to fall out of step. A materialized projection would have six writers and one of them would
 * eventually be missed.
 */

describe('the learning history projection', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('reports what the authoritative rows say, with every count derived the same way', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId, {
        effectiveFrom: '2024-01-01',
        dueWithinDays: 30,
      });

      await reconcile(harness, ruleId);
      await send(harness, {
        commandName: 'learning.issue-certification',
        employmentId: EMPLOYMENT,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        validUntil: '2026-09-01',
      });

      const history = await ask<LearningHistoryView>(harness, {
        queryName: 'learning.read-history',
        employmentId: EMPLOYMENT,
        noticeDays: 30,
      });

      expect(history.asOf).toBe(TODAY);
      expect(history.openAssignments).toBe(1);
      // The requirement opened in January 2024 with a 30-day window: long overdue, derived from the
      // date rather than read from a column.
      expect(history.overdueAssignments).toBe(1);
      expect(history.activeCertifications).toBe(1);
      expect(history.expiringCertifications).toBe(1);
      // The header can never disagree with the list beneath it: both come from the same rows.
      expect(history.assignments.filter((item) => item.overdue)).toHaveLength(
        history.overdueAssignments,
      );
    });
  });

  it('counts a completed course once it is completed, and not before', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await aCompletedCourse(harness, course, TODAY);

      const history = await ask<LearningHistoryView>(harness, {
        queryName: 'learning.read-history',
        employmentId: EMPLOYMENT,
      });

      expect(history.completedCourses).toBe(1);
      expect(history.enrolments[0]?.completedOn).toBe(TODAY);
      expect(history.enrolments[0]?.completedBy).toBe(HR);
    });
  });

  it('is a read and never a write path: nothing stores it', async () => {
    await harness.as(HR, async () => {
      await ask<LearningHistoryView>(harness, {
        queryName: 'learning.read-history',
        employmentId: EMPLOYMENT,
      });

      // No projection table, no cached row, nothing to fall out of step with the truth.
      expect(Object.keys(harness.stores.tables)).not.toContain('history');
    });
  });
});
