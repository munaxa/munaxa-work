import { beforeEach, describe, expect, it } from 'vitest';

import type { AssignmentView } from '../contracts/views.js';
import {
  HR,
  ask,
  attempt,
  harnessFor,
  reasonOf,
  send,
  type Harness,
} from './learning-test-harness.js';
import {
  EMPLOYMENT,
  OTHER_EMPLOYMENT,
  UNIT,
  aCompletedCourse,
  aMandatoryRule,
  aPublishedCourse,
  reconcile,
  withWorkforce,
} from './learning-scenarios.js';

/**
 * Recurring mandatory training, computed rather than scheduled (ADR-0071).
 *
 * **Nothing fires this.** Every case below is an administrator running the command, which is what
 * production has: `JobPort` has no adapter, so scheduled execution is `NOT VERIFIED` and no test
 * here pretends otherwise.
 *
 * The properties that matter are the boundaries: an occurrence opens the day the interval elapses
 * and not the day before, a completion inside the interval means nothing is due, and no future
 * occurrence is ever created — a calendar of them would be state nothing owns.
 */

describe('reconciling a recurring requirement', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
    withWorkforce(harness);
  });

  it('generates the current occurrence with the rule’s own due window', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId, {
        effectiveFrom: '2024-01-01',
        dueWithinDays: 30,
      });

      const run = await reconcile(harness, ruleId);

      expect(run).toMatchObject({ examined: 2, generated: 2, alreadyPresent: 0, notDue: 0 });

      const assignments = await ask<{ readonly items: readonly AssignmentView[] }>(harness, {
        queryName: 'learning.search-assignments',
        employmentId: EMPLOYMENT,
      });
      const generated = assignments.items[0];

      expect(generated?.source).toBe('mandatory_rule');
      // Nobody has ever done it, so the occurrence is the one that opened when the rule took effect.
      expect(generated?.occurrenceKey).toBe('2024-01-01');
      expect(generated?.dueOn).toBe('2024-01-31');
      // Overdue is derived, not stored: it is true because that date has passed, not because a
      // sweep ran.
      expect(generated?.overdue).toBe(true);
    });
  });

  it('creates nothing for somebody whose completion is still inside the interval', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await aCompletedCourse(harness, course, '2026-03-01', EMPLOYMENT);

      const ruleId = await aMandatoryRule(harness, course.courseId, { recurrenceMonths: 12 });
      const run = await reconcile(harness, ruleId);

      // One person is covered until March 2027; the other has never done it.
      expect(run).toMatchObject({ generated: 1, notDue: 1 });
    });
  });

  it('opens the next occurrence the day the interval elapses, and not the day before', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await aCompletedCourse(harness, course, '2025-08-12', EMPLOYMENT);

      const ruleId = await aMandatoryRule(harness, course.courseId, { recurrenceMonths: 12 });

      harness.clock.advanceTo(new Date('2026-08-11T09:00:00Z'));
      expect((await reconcile(harness, ruleId)).notDue).toBe(1);

      harness.clock.advanceTo(new Date('2026-08-12T09:00:00Z'));

      const due = await reconcile(harness, ruleId);
      const generated = [...harness.stores.tables.assignments.values()].filter(
        (held) => held.employmentId === EMPLOYMENT,
      );

      expect(due.generated).toBe(1);
      expect(generated[0]?.occurrenceKey).toBe('2026-08-12');
    });
  });

  it('never creates a future occurrence, however far the clock is wound back', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId, {
        effectiveFrom: '2030-01-01',
      });

      const run = await reconcile(harness, ruleId);

      expect(run).toMatchObject({ generated: 0, notDue: 2 });
      expect(harness.stores.tables.assignments.size).toBe(0);
    });
  });

  it('treats a rule that never repeats as satisfied forever by one completion', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);

      await aCompletedCourse(harness, course, '2024-06-01', EMPLOYMENT);

      const ruleId = await aMandatoryRule(harness, course.courseId, { recurrenceMonths: 0 });

      harness.clock.advanceTo(new Date('2099-01-01T09:00:00Z'));

      const run = await reconcile(harness, ruleId);
      const theirs = [...harness.stores.tables.assignments.values()].filter(
        (held) => held.employmentId === EMPLOYMENT,
      );

      expect(theirs).toHaveLength(0);
      expect(run.notDue).toBe(1);
    });
  });

  it('resolves the audience from Employment at the moment it runs, not from a stored list', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId, {
        audience: 'organization_unit',
        organizationUnitId: UNIT,
      });

      expect((await reconcile(harness, ruleId)).generated).toBe(2);

      // Somebody joins the unit afterwards. Nobody edits the rule.
      harness.employment.add({
        employmentId: 'employment-new',
        status: 'active',
        active: true,
        organizationUnitId: UNIT,
      });

      const later = await reconcile(harness, ruleId);

      expect(later).toMatchObject({ examined: 3, generated: 1, alreadyPresent: 2 });
    });
  });

  it('skips somebody whose employment has ended rather than obliging them', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      harness.employment.end(OTHER_EMPLOYMENT);

      const run = await reconcile(harness, ruleId);

      expect(run.generated).toBe(1);
      expect(
        [...harness.stores.tables.assignments.values()].some(
          (held) => held.employmentId === OTHER_EMPLOYMENT,
        ),
      ).toBe(false);
    });
  });

  it('bounds the run and says so, rather than truncating quietly', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      const first = await reconcile(harness, ruleId, 1);

      expect(first).toMatchObject({ examined: 1, generated: 1, more: true });
    });
  });

  it('refuses to reconcile a retired rule instead of quietly generating nothing', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      await send(harness, {
        commandName: 'learning.retire-mandatory-rule',
        mandatoryRuleId: ruleId,
        expectedVersion: 1,
      });

      const run = await attempt(harness, {
        commandName: 'learning.reconcile-requirements',
        mandatoryRuleId: ruleId,
      });

      expect(reasonOf(run)).toBe('learning.rejection.reconcile-rule-retired');
    });
  });

  it('leaves what a retired rule already asked of people exactly as it was', async () => {
    await harness.as(HR, async () => {
      const course = await aPublishedCourse(harness);
      const ruleId = await aMandatoryRule(harness, course.courseId);

      await reconcile(harness, ruleId);
      await send(harness, {
        commandName: 'learning.retire-mandatory-rule',
        mandatoryRuleId: ruleId,
        expectedVersion: 1,
      });

      // The compliance trail survives the policy change: "was this person asked in 2024" still
      // has an answer.
      expect(harness.stores.tables.assignments.size).toBe(2);
    });
  });

  it('refuses a requirement pointing at a course nobody can enrol into', async () => {
    await harness.as(HR, async () => {
      const { courseId } = await send<{ courseId: string }>(harness, {
        commandName: 'learning.create-course',
        code: 'draft-course',
        name: { en: 'Draft', ar: 'مسودة' },
        delivery: 'virtual',
      });

      const refused = await attempt(harness, {
        commandName: 'learning.define-mandatory-rule',
        courseId,
        name: { en: 'x', ar: 'س' },
        kind: 'safety',
        audience: 'everybody',
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      });

      expect(reasonOf(refused)).toBe('learning.rejection.rule-course-not-published');
    });
  });
});
