import { describe, expect, it } from 'vitest';
import { createGoal } from './goal.js';
import { enrolReview, recordScore } from './review.js';
import {
  changedTheRating,
  concludeCalibration,
  moveCalibration,
  recordCalibrationDecision,
  scheduleCalibration,
} from './calibration.js';
import { performanceBandOf, recordPlacement } from './talent-placement.js';
import { giveFeedback } from './feedback.js';
import { carriesForbiddenData, takeSnapshot } from './review-snapshot.js';

import type { RatingScaleBand } from './scoring.js';

/**
 * Calibration, talent placement, continuous feedback and the completion snapshot.
 *
 * The seventh approved scoring decision is asserted here end to end: an override is a recorded
 * decision carrying the original, the actor, the moment and the reason — never an edit. Alongside it,
 * the rule this repository has held since Phase 6, that `system:auto-approval` decides nothing a
 * human is accountable for, and the rule about *absence*: a snapshot carries no name and no pay.
 */

const NAME = { en: 'Annual', ar: 'سنوي' };

const SCALE: RatingScaleBand = {
  minimumScore: 100,
  maximumScore: 500,
  levels: [
    { ratingLevelId: 'level-1', ordinal: 1, minimumScore: 100, maximumScore: 199 },
    { ratingLevelId: 'level-2', ordinal: 2, minimumScore: 200, maximumScore: 299 },
    { ratingLevelId: 'level-3', ordinal: 3, minimumScore: 300, maximumScore: 399 },
    { ratingLevelId: 'level-4', ordinal: 4, minimumScore: 400, maximumScore: 500 },
  ],
};

const day = (iso: string): Date => new Date(iso);

describe('calibration', () => {
  const session = () =>
    scheduleCalibration({
      calibrationSessionId: 'session-1',
      cycleId: 'cycle-1',
      code: 'engineering',
      name: NAME,
    });
  const scoredReview = () => {
    const review = enrolReview({
      reviewId: 'review-1',
      cycleId: 'cycle-1',
      employmentId: 'employment-1',
      managerEmploymentId: 'employment-9',
      ratingScaleId: 'scale-1',
    });

    if (!review.ok) throw new Error('unreachable');

    const scored = recordScore(
      review.value,
      { score: 370, ratingLevelId: 'level-3', components: [] },
      day('2027-01-10'),
    );

    if (!scored.ok) throw new Error('unreachable');
    return scored.value;
  };

  it('keeps the original alongside the calibrated value, with the actor and the reason', () => {
    const scheduled = session();

    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;

    const opened = moveCalibration(scheduled.value, 'in_session', day('2027-01-15'));

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const decision = recordCalibrationDecision(opened.value, scoredReview(), SCALE, {
      calibrationDecisionId: 'decision-1',
      calibratedScore: 410,
      calibratedRatingLevelId: 'level-4',
      reason: 'Consistent with the peer group after comparison',
      decidedAt: day('2027-01-15'),
      decidedBy: 'user:director',
      decidedByEmploymentId: 'employment-20',
    });

    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.value.originalScore).toBe(370);
    expect(decision.value.originalRatingLevelId).toBe('level-3');
    expect(decision.value.calibratedScore).toBe(410);
    expect(changedTheRating(decision.value)).toBe(true);
  });

  it('refuses a decision with no reason, by the auto-approver, or on one’s own review', () => {
    const scheduled = session();

    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;

    const opened = moveCalibration(scheduled.value, 'in_session', day('2027-01-15'));

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const base = {
      calibrationDecisionId: 'decision-1',
      calibratedScore: 410,
      calibratedRatingLevelId: 'level-4',
      reason: 'Consistent with the peer group',
      decidedAt: day('2027-01-15'),
      decidedBy: 'user:director',
      decidedByEmploymentId: 'employment-20',
    };
    const refused = (overrides: Partial<typeof base>): string => {
      const decision = recordCalibrationDecision(opened.value, scoredReview(), SCALE, {
        ...base,
        ...overrides,
      });

      return decision.ok ? 'accepted' : decision.error.reason;
    };

    expect(refused({ reason: '  ' })).toBe('calibration-decision-needs-reason');
    expect(refused({ decidedBy: 'system:auto-approval' })).toBe('calibration-decision-not-human');
    // Nobody calibrates their own review. No check constraint can reach the subject's employment,
    // so this rule lives here and is asserted again at the HTTP edge.
    expect(refused({ decidedByEmploymentId: 'employment-1' })).toBe('calibration-self-refused');
    expect(refused({ calibratedScore: 800 })).toBe('calibration-score-out-of-range');
  });

  it('refuses a decision before the session is in progress, and concludes under a named human', () => {
    const scheduled = session();

    expect(scheduled.ok).toBe(true);
    if (!scheduled.ok) return;

    const early = recordCalibrationDecision(scheduled.value, scoredReview(), SCALE, {
      calibrationDecisionId: 'decision-1',
      calibratedScore: 410,
      calibratedRatingLevelId: 'level-4',
      reason: 'Too early',
      decidedAt: day('2027-01-14'),
      decidedBy: 'user:director',
    });

    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.error.reason).toBe('calibration-not-in-session');

    const opened = moveCalibration(scheduled.value, 'in_session', day('2027-01-15'));

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(concludeCalibration(opened.value, 'system:auto-approval', day('2027-01-16')).ok).toBe(
      false,
    );
    expect(concludeCalibration(opened.value, 'user:director', day('2027-01-16')).ok).toBe(true);
  });
});

describe('talent placement', () => {
  const completed = () => {
    const review = enrolReview({
      reviewId: 'review-1',
      cycleId: 'cycle-1',
      employmentId: 'employment-1',
      ratingScaleId: 'scale-1',
    });

    if (!review.ok) throw new Error('unreachable');

    const scored = recordScore(
      review.value,
      { score: 480, ratingLevelId: 'level-4', components: [] },
      day('2027-01-10'),
    );

    if (!scored.ok) throw new Error('unreachable');

    return {
      ...scored.value,
      status: 'completed' as const,
      completedAt: day('2027-01-20'),
      completedBy: 'user:hr',
    };
  };

  it('derives the performance band from the review’s rating rather than taking it', () => {
    expect(performanceBandOf(SCALE, 'level-1').ok).toBe(true);

    const lowest = performanceBandOf(SCALE, 'level-1');
    const highest = performanceBandOf(SCALE, 'level-4');

    if (lowest.ok) expect(lowest.value).toBe(1);
    if (highest.ok) expect(highest.value).toBe(3);
    expect(performanceBandOf(SCALE, 'level-nonexistent').ok).toBe(false);
  });

  it('places a completed review and refuses an incomplete one', () => {
    const placed = recordPlacement(completed(), SCALE, {
      talentPlacementId: 'placement-1',
      potentialBand: 2,
      placedAt: day('2027-02-01'),
      placedBy: 'user:hr',
    });

    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    expect(placed.value.performanceBand).toBe(3);
    expect(placed.value.boxCode).toBe('p3x2');

    const { completedAt: _stamped, ...unfinished } = completed();
    const refused = recordPlacement(unfinished, SCALE, {
      talentPlacementId: 'placement-2',
      potentialBand: 2,
      placedAt: day('2027-02-01'),
      placedBy: 'user:hr',
    });

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.reason).toBe('placement-review-not-completed');
  });
});

describe('continuous feedback', () => {
  const request = {
    feedbackId: 'feedback-1',
    subjectEmploymentId: 'employment-1',
    authorEmploymentId: 'employment-4',
    kind: 'praise',
    visibility: 'manager',
    body: 'Carried the migration through a difficult week.',
    givenAt: day('2026-06-01'),
  };

  it('refuses feedback about oneself and an empty body', () => {
    expect(giveFeedback({ ...request, authorEmploymentId: 'employment-1' }).ok).toBe(false);
    expect(giveFeedback({ ...request, body: '   ' }).ok).toBe(false);
    expect(giveFeedback(request).ok).toBe(true);
  });

  it('has no anonymous visibility to offer', () => {
    const anonymous = giveFeedback({ ...request, visibility: 'anonymous' });

    expect(anonymous.ok).toBe(false);
    // Every row records its author, the audit columns name the actor and row-level security sees
    // the tenant. A vocabulary offering the word would be claiming a guarantee nothing can keep.
    if (!anonymous.ok) expect(anonymous.error.reason).toBe('feedback-visibility-unknown');
  });
});

describe('the completion snapshot', () => {
  const review = () => {
    const enrolledReview = enrolReview({
      reviewId: 'review-1',
      cycleId: 'cycle-1',
      employmentId: 'employment-1',
      managerEmploymentId: 'employment-9',
      ratingScaleId: 'scale-1',
    });

    if (!enrolledReview.ok) throw new Error('unreachable');

    const scored = recordScore(
      enrolledReview.value,
      { score: 370, ratingLevelId: 'level-3', components: [] },
      day('2027-01-10'),
    );

    if (!scored.ok) throw new Error('unreachable');
    return scored.value;
  };

  it('carries the inputs to the decision and no name, pay or identifier', () => {
    const goal = createGoal({
      goalId: 'goal-1',
      scope: 'individual',
      employmentId: 'employment-1',
      title: 'Reduce onboarding time to ten days',
      measurement: 'numeric',
      weightBasisPoints: 10_000,
      startDate: day('2026-01-01'),
      dueDate: day('2026-12-31'),
    });

    expect(goal.ok).toBe(true);
    if (!goal.ok) return;

    const snapshot = takeSnapshot(review(), {
      reviewSnapshotId: 'snapshot-1',
      managerEmploymentId: 'employment-9',
      reviewers: [],
      placement: { organizationUnitId: 'unit-1', legalEntityId: 'entity-1' },
      ratingScale: SCALE,
      goals: [goal.value],
      componentScores: [
        {
          component: 'goals',
          weightBasisPoints: 10_000,
          included: true,
          score: 370,
          denominatorBasisPoints: 10_000,
          excludedItems: [],
        },
      ],
      takenAt: day('2027-01-20'),
      takenBy: 'user:hr',
    });

    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;

    expect(snapshot.value.calculation.calculatedScore).toBe(370);
    expect(snapshot.value.managerEmploymentId).toBe('employment-9');
    // A rule about what is *absent* is the one kind a reader cannot check by looking, because the
    // offending field simply is not there yet on the day they look.
    expect(carriesForbiddenData(snapshot.value)).toEqual([]);
  });

  it('refuses a snapshot of a review nothing has scored', () => {
    const enrolledReview = enrolReview({
      reviewId: 'review-2',
      cycleId: 'cycle-1',
      employmentId: 'employment-2',
      ratingScaleId: 'scale-1',
    });

    expect(enrolledReview.ok).toBe(true);
    if (!enrolledReview.ok) return;

    const snapshot = takeSnapshot(enrolledReview.value, {
      reviewSnapshotId: 'snapshot-2',
      reviewers: [],
      placement: {},
      ratingScale: SCALE,
      goals: [],
      componentScores: [],
      takenAt: day('2027-01-20'),
      takenBy: 'user:hr',
    });

    expect(snapshot.ok).toBe(false);
    if (!snapshot.ok) expect(snapshot.error.reason).toBe('review-not-yet-scored');
  });
});
