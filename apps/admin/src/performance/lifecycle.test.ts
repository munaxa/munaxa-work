import type { CycleView, GoalView, ReviewView } from '@work/performance/contracts';
import { describe, expect, it } from 'vitest';

import {
  cycleActionsFor,
  cycleWithheldBecause,
  goalActionsFor,
  goalWithheldBecause,
  reviewActionsFor,
  reviewWithheldBecause,
} from './lifecycle';

/**
 * The screen must not name an action the system is going to refuse.
 *
 * **This is a usability property, not a security one**, and the distinction is the reason these
 * tests exist separately from the API's. The API refuses every one of these independently — the
 * `performance.security.spec.ts` and `performance.lifecycle.spec.ts` suites prove that a caller with
 * `curl` gets 403, 409 and 422 regardless of what any screen rendered. Nothing here is relied on to
 * stop anybody.
 *
 * What these do check is that an HR administrator is never told a completed review can be scored
 * again, and that when an action is missing the screen says why rather than leaving a gap somebody
 * refreshes the page over.
 */

const aCycle = (status: string): CycleView => ({
  cycleId: '01930000-0000-7000-8000-000000000001',
  code: 'annual-2026',
  name: { en: 'Annual', ar: 'سنوي' },
  reviewTemplateId: '01930000-0000-7000-8000-000000000002',
  kind: 'annual',
  status,
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  participantCount: 0,
  version: 1,
});

const aReview = (overrides: Partial<ReviewView> = {}): ReviewView => ({
  reviewId: '01930000-0000-7000-8000-000000000003',
  cycleId: '01930000-0000-7000-8000-000000000001',
  employmentId: '01930000-0000-7000-8000-000000000004',
  ratingScaleId: '01930000-0000-7000-8000-000000000005',
  status: 'manager_assessment',
  calibrated: false,
  version: 1,
  ...overrides,
});

const aGoal = (status: string): GoalView => ({
  goalId: '01930000-0000-7000-8000-000000000006',
  scope: 'individual',
  title: 'A goal',
  measurement: 'percentage',
  weightBasisPoints: 10_000,
  status,
  startDate: '2026-01-01',
  dueDate: '2026-06-30',
  progressBasisPoints: 0,
  progress: [],
  version: 1,
});

describe('which actions a cycle permits', () => {
  it('offers nothing on a closed cycle, and says why', () => {
    // A closed cycle does not reopen. Its reviews are completed and immutable, and reopening the
    // container would imply they were not.
    expect(cycleActionsFor(aCycle('closed')).size).toBe(0);
    expect(cycleWithheldBecause(aCycle('closed'))).toBe('performance.withheld.cycleClosed');
  });

  it('offers nothing on a cancelled cycle', () => {
    expect(cycleActionsFor(aCycle('cancelled')).size).toBe(0);
    expect(cycleWithheldBecause(aCycle('cancelled'))).toBe('performance.withheld.cycleCancelled');
  });

  it('does not offer enrolment on a draft cycle, because there is nothing to enrol into yet', () => {
    const draft = cycleActionsFor(aCycle('draft'));

    expect([...draft].sort()).toEqual(['cancel', 'open']);
    expect(draft.has('enrol')).toBe(false);
  });

  it('offers enrolment and closure once the cycle is open', () => {
    expect([...cycleActionsFor(aCycle('open'))].sort()).toEqual(['cancel', 'close', 'enrol']);
  });
});

describe('which actions a review permits', () => {
  it('offers neither completion nor calibration before the review has been scored', () => {
    const unscored = reviewActionsFor(aReview());

    // There is nothing to sign off and nothing to moderate: the engine has produced no number.
    expect(unscored.has('complete')).toBe(false);
    expect(unscored.has('calibrate')).toBe(false);
    expect(unscored.has('score')).toBe(true);
    expect(reviewWithheldBecause(aReview())).toBe('performance.withheld.notScored');
  });

  it('offers completion and calibration once a score exists', () => {
    const scored = reviewActionsFor(aReview({ calculatedScore: 370 }));

    expect(scored.has('complete')).toBe(true);
    expect(scored.has('calibrate')).toBe(true);
  });

  it('offers only archival on a completed review, and says it is immutable', () => {
    const completed = reviewActionsFor(
      aReview({ status: 'completed', calculatedScore: 370, finalScore: 350 }),
    );

    // The rating is frozen by the domain and by a trigger. Offering Score or Calibrate would invite
    // an administrator to try, and the API would refuse them.
    expect([...completed]).toEqual(['archive']);
    expect(reviewWithheldBecause(aReview({ status: 'completed' }))).toBe(
      'performance.withheld.reviewCompleted',
    );
  });

  it('offers nothing at all on an archived review', () => {
    expect(reviewActionsFor(aReview({ status: 'archived' })).size).toBe(0);
  });
});

describe('which actions a goal permits', () => {
  it('offers approval on a draft goal but not progress against one nobody approved', () => {
    const draft = goalActionsFor(aGoal('draft'));

    expect(draft.has('approve')).toBe(true);
    expect(draft.has('recordProgress')).toBe(false);
  });

  it('offers progress and closure once the goal is active', () => {
    expect([...goalActionsFor(aGoal('active'))].sort()).toEqual([
      'amend',
      'closeGoal',
      'recordProgress',
    ]);
  });

  it('offers nothing on a goal that ended, however it ended', () => {
    for (const status of ['achieved', 'missed', 'cancelled']) {
      expect(goalActionsFor(aGoal(status)).size).toBe(0);
      expect(goalWithheldBecause(aGoal(status))).toBe('performance.withheld.goalClosed');
    }
  });
});
