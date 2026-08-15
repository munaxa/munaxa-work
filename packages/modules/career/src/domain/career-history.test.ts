import { describe, expect, it } from 'vitest';

import { isCivilDate } from './career-vocabulary.js';
import * as readiness from './readiness.js';
import { addToPool, removeFromPool, wasMemberOn } from './pool.js';
import { acknowledgeDevelopmentPlan, addDevelopmentItem, isOverdue } from './development.js';
import { reviewIsDue } from './succession.js';
import {
  aPlan,
  aPool,
  aSuccessionPlan,
  anItem,
  assertAccepted,
  reasonOf,
} from './career-fixtures.js';

/**
 * The facts this module keeps rather than overwrites, and the answers it works out rather than
 * stores.
 *
 * Two properties run through the file. **A historical fact is never edited** — a readiness statement
 * is appended, a membership period closes, an acknowledgement is recorded once. And **a derived
 * answer is computed against a day somebody named** — overdue, expired, in force, review due —
 * because `JobPort` has no adapter and a stored flag would need something to move it overnight.
 */

const at = (iso: string): Date => new Date(`${iso}T09:00:00.000Z`);

const stated = (
  overrides: Partial<Parameters<typeof readiness.recordReadiness>[0]> = {},
): readiness.ReadinessAssessmentState =>
  assertAccepted(
    readiness.recordReadiness({
      readinessAssessmentId: 'r1',
      employmentId: 'e1',
      readinessLevelId: 'ready-now',
      positionId: 'p1',
      assessedOn: '2026-08-01',
      assessedBy: 'user:director',
      at: at('2026-08-01'),
      ...overrides,
    }),
  );

describe('a readiness statement is appended, never amended', () => {
  it('offers no function that edits or transitions an assessment', () => {
    const surface = Object.keys(readiness);

    // A correction is a new assessment (D-14). There is nothing here that could rewrite one, and
    // the database refuses it too — the application layer is not the guarantee.
    for (const forbidden of ['amend', 'update', 'correct', 'revise', 'move']) {
      expect([forbidden, surface.some((name) => name.toLowerCase().includes(forbidden))]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it('keeps every statement and picks the most recent by the day it was made', () => {
    const first = stated({
      readinessAssessmentId: 'r1',
      readinessLevelId: 'not-ready',
      assessedOn: '2026-01-15',
    });
    const second = stated({
      readinessAssessmentId: 'r2',
      readinessLevelId: 'ready-soon',
      assessedOn: '2026-05-01',
    });
    const third = stated({
      readinessAssessmentId: 'r3',
      readinessLevelId: 'ready-now',
      assessedOn: '2026-08-01',
    });
    const latest = readiness.latestAssessment([second, third, first]);

    // The trail shows what was thought and when it changed, which is the point of appending.
    expect(latest?.readinessAssessmentId).toBe('r3');
    expect([first.readinessLevelId, second.readinessLevelId]).toEqual(['not-ready', 'ready-soon']);
  });

  it('breaks a same-day tie on when it was recorded, so a correction wins', () => {
    const morning = stated({
      readinessAssessmentId: 'a',
      assessedOn: '2026-08-01',
      at: at('2026-08-01'),
    });
    const correction = stated({
      readinessAssessmentId: 'b',
      assessedOn: '2026-08-01',
      readinessLevelId: 'not-ready',
      at: new Date('2026-08-01T16:00:00.000Z'),
    });

    expect(readiness.latestAssessment([morning, correction])?.readinessAssessmentId).toBe('b');
    expect(readiness.latestAssessment([correction, morning])?.readinessAssessmentId).toBe('b');
  });

  it('answers nothing for an employment nobody has assessed', () => {
    // Absent is not "not ready". A person nobody has assessed has no readiness, and inventing one
    // would be the derivation ADR-0074 refuses.
    expect(readiness.latestAssessment([])).toBeUndefined();
  });

  it('refuses a statement about nothing', () => {
    const nowhere = readiness.recordReadiness({
      readinessAssessmentId: 'r9',
      employmentId: 'e1',
      readinessLevelId: 'ready-now',
      assessedOn: '2026-08-01',
      assessedBy: 'user:director',
      at: at('2026-08-01'),
    });

    // "Ready" with no answer to "ready for what" is not a statement anybody can act on or challenge.
    expect(reasonOf(nowhere)).toBe('readiness-subject-required');
  });

  it('refuses a level ordinal outside its bounds and accepts both edges', () => {
    const level = (ordinal: number) =>
      readiness.defineReadinessLevel({
        readinessLevelId: 'l',
        code: 'ready-now',
        name: { en: 'Ready now', ar: 'جاهز الآن' },
        ordinal,
      });

    expect(reasonOf(level(0))).toBe('readiness-level-ordinal-invalid');
    expect(reasonOf(level(101))).toBe('readiness-level-ordinal-invalid');
    expect(assertAccepted(level(1)).ordinal).toBe(1);
    expect(assertAccepted(level(100)).ordinal).toBe(100);
  });

  it('deactivates a level rather than deleting it, once', () => {
    const active = assertAccepted(
      readiness.defineReadinessLevel({
        readinessLevelId: 'l',
        code: 'ready-now',
        name: { en: 'Ready now', ar: 'جاهز الآن' },
        ordinal: 4,
      }),
    );
    const retired = assertAccepted(readiness.deactivateReadinessLevel(active));

    // Assessments recorded at this level are historical statements; removing it would make them
    // unreadable.
    expect(retired.active).toBe(false);
    expect(reasonOf(readiness.deactivateReadinessLevel(retired))).toBe(
      'readiness-level-already-inactive',
    );
  });
});

describe('a pool membership is a period', () => {
  const open = () =>
    assertAccepted(
      addToPool(aPool(), { membershipId: 'pm', employmentId: 'e1', from: '2026-01-01', by: 'u' }),
    );

  it('refuses to end a membership that has already ended', () => {
    const ended = assertAccepted(removeFromPool(open(), { on: '2026-06-30', by: 'u' }));

    // A second removal would overwrite the day the first recorded, and that day is the fact.
    expect(reasonOf(removeFromPool(ended, { on: '2026-07-31', by: 'u' }))).toBe(
      'membership-already-ended',
    );
  });

  it('refuses an end before the beginning, and accepts the same day', () => {
    expect(reasonOf(removeFromPool(open(), { on: '2025-12-31', by: 'u' }))).toBe(
      'membership-ends-before-it-began',
    );

    const sameDay = assertAccepted(removeFromPool(open(), { on: '2026-01-01', by: 'u' }));

    // Somebody added and removed on one day was a member that day, and the period says so.
    expect(wasMemberOn(sameDay, '2026-01-01')).toBe(true);
    expect(wasMemberOn(sameDay, '2026-01-02')).toBe(false);
  });

  it('answers membership as of any day, from the period alone', () => {
    const membership = open();

    expect(wasMemberOn(membership, '2025-12-31')).toBe(false);
    expect(wasMemberOn(membership, '2026-01-01')).toBe(true);
    // An open membership has no end, so it is current whenever anybody asks.
    expect(wasMemberOn(membership, '2099-01-01')).toBe(true);
  });

  it('refuses a new membership on a closed pool', () => {
    const closed = aPool({ status: 'closed' });
    const added = addToPool(closed, {
      membershipId: 'pm2',
      employmentId: 'e2',
      from: '2026-01-01',
      by: 'u',
    });

    expect(reasonOf(added)).toBe('pool-closed');
  });
});

describe('an acknowledgement is recorded once, and claims nothing about who pressed a button', () => {
  it('records each party separately and refuses a repeat', () => {
    const byEmployee = assertAccepted(
      acknowledgeDevelopmentPlan(aPlan(), {
        by: 'employee',
        on: '2026-02-01',
        recordedBy: 'user:hr',
      }),
    );
    const both = assertAccepted(
      acknowledgeDevelopmentPlan(byEmployee, {
        by: 'manager',
        on: '2026-02-02',
        recordedBy: 'user:hr',
      }),
    );

    // The field names say an administrator recorded it, because neither party can sign in — there
    // is no principal → employment resolution (ADR-0032, D-9). Joint ownership is `NOT VERIFIED`.
    expect(both.employeeAcknowledgementRecordedBy).toBe('user:hr');
    expect(both.managerAcknowledgementRecordedBy).toBe('user:hr');
    expect(Object.keys(both)).not.toContain('employeeSignedBy');
    expect(Object.keys(both)).not.toContain('signature');

    expect(
      reasonOf(
        acknowledgeDevelopmentPlan(both, {
          by: 'employee',
          on: '2026-03-01',
          recordedBy: 'user:hr',
        }),
      ),
    ).toBe('already-acknowledged');
  });
});

describe('the answers nothing stores', () => {
  it('derives an item as overdue against the day asked, and never for a closed item', () => {
    const due = anItem({ targetDate: '2026-06-30' });

    expect(isOverdue(due, '2026-06-30')).toBe(false);
    expect(isOverdue(due, '2026-07-01')).toBe(true);
    // A completed or cancelled item is not overdue, whatever the date says.
    expect(isOverdue(anItem({ targetDate: '2026-06-30', status: 'completed' }), '2027-01-01')).toBe(
      false,
    );
    expect(isOverdue(anItem({ targetDate: '2026-06-30', status: 'cancelled' }), '2027-01-01')).toBe(
      false,
    );
    // An item with no target date is never overdue.
    expect(isOverdue(anItem(), '2099-01-01')).toBe(false);
  });

  it('derives a succession review as due, and tells nobody', () => {
    const active = aSuccessionPlan({ status: 'active', reviewOn: '2026-09-01' });

    expect(reviewIsDue(active, '2026-08-31')).toBe(false);
    expect(reviewIsDue(active, '2026-09-01')).toBe(true);
    // A draft or archived plan is not due for review, and a plan with no review day never is.
    expect(reviewIsDue(aSuccessionPlan({ reviewOn: '2026-01-01' }), '2099-01-01')).toBe(false);
    expect(reviewIsDue(aSuccessionPlan({ status: 'active' }), '2099-01-01')).toBe(false);
  });

  it('refuses an item on a closed development plan', () => {
    const closed = aPlan({ status: 'completed' });
    const added = addDevelopmentItem(closed, {
      developmentItemId: 'i',
      category: 'experience',
      kind: 'project',
      title: 'Too late',
    });

    expect(reasonOf(added)).toBe('development-plan-closed');
  });
});

describe('a civil date is a real day', () => {
  /**
   * The regression for the defect a Career domain test found.
   *
   * `pattern && !Number.isNaN(Date.parse(...))` — the shape five other modules use — accepts every
   * value below: V8 rolls an out-of-range day into the next month and returns a valid instant, so
   * only an out-of-range month yields `NaN`. Each of these is a day that does not exist.
   */
  it('refuses a day that rolls over into the next month', () => {
    for (const impossible of ['2026-02-30', '2026-04-31', '2025-02-29', '2026-06-31']) {
      expect([impossible, isCivilDate(impossible)]).toEqual([impossible, false]);
      // The clause that used to be the whole check. Proof the defect is real, not theoretical.
      expect([impossible, Number.isNaN(Date.parse(`${impossible}T00:00:00.000Z`))]).toEqual([
        impossible,
        false,
      ]);
    }
  });

  it('accepts a real leap day and the ordinary days around a month end', () => {
    for (const real of ['2028-02-29', '2026-02-28', '2026-04-30', '2026-12-31', '2026-01-01']) {
      expect([real, isCivilDate(real)]).toEqual([real, true]);
    }
  });

  it('still refuses a malformed shape and an instant', () => {
    for (const wrong of [
      '2026-1-1',
      '2026-13-01',
      '2026-00-10',
      '01-01-2026',
      '2026-01-01T00:00:00Z',
      '',
    ]) {
      expect([wrong, isCivilDate(wrong)]).toEqual([wrong, false]);
    }
  });
});
