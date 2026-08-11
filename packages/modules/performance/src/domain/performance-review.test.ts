import { describe, expect, it } from 'vitest';
import {
  applyCalibration,
  archiveReview,
  assignReviewer,
  completeReview,
  enrolReview,
  moveAssignment,
  multiRaterAggregateAvailable,
  recordScore,
} from './review.js';
import { recordItem, startAssessment, submitAssessment } from './assessment.js';

import type { RatingScaleBand } from './scoring.js';

/**
 * The review and the assessments beneath it.
 *
 * The assertions that matter most: the calculated score survives a calibration that moves the final
 * one, a submitted assessment cannot be rewritten by anybody including its author, and a multi-rater
 * panel excludes the subject and their manager. The last of those withholds an aggregate; it does
 * not make anything anonymous, and the test says so.
 */

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

describe('the review', () => {
  const enrolled = () =>
    enrolReview({
      reviewId: 'review-1',
      cycleId: 'cycle-1',
      employmentId: 'employment-1',
      managerEmploymentId: 'employment-9',
      ratingScaleId: 'scale-1',
    });
  const outcome = { score: 370, ratingLevelId: 'level-3', components: [] };

  it('refuses a review whose subject is their own manager', () => {
    const same = enrolReview({
      reviewId: 'review-1',
      cycleId: 'cycle-1',
      employmentId: 'employment-1',
      managerEmploymentId: 'employment-1',
      ratingScaleId: 'scale-1',
    });

    expect(same.ok).toBe(false);
    if (!same.ok) expect(same.error.reason).toBe('review-manager-is-subject');
  });

  it('keeps the calculated score when calibration moves the final one', () => {
    const review = enrolled();

    expect(review.ok).toBe(true);
    if (!review.ok) return;

    const scored = recordScore(review.value, outcome, day('2027-01-10'));

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    expect(scored.value.calculatedScore).toBe(370);
    expect(scored.value.finalScore).toBe(370);

    const calibrated = applyCalibration(scored.value, SCALE, {
      score: 410,
      ratingLevelId: 'level-4',
    });

    expect(calibrated.ok).toBe(true);
    if (!calibrated.ok) return;

    // The seventh approved scoring decision, made structurally impossible to break: the calibrated
    // value is effective, and the original remains exactly where the engine left it.
    expect(calibrated.value.calculatedScore).toBe(370);
    expect(calibrated.value.finalScore).toBe(410);
    expect(calibrated.value.calibrated).toBe(true);
  });

  it('refuses a calibrated score outside the scale rather than clamping it', () => {
    const review = enrolled();

    expect(review.ok).toBe(true);
    if (!review.ok) return;

    const scored = recordScore(review.value, outcome, day('2027-01-10'));

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    const beyond = applyCalibration(scored.value, SCALE, { score: 600, ratingLevelId: 'level-4' });

    expect(beyond.ok).toBe(false);
    // The invariant that accompanies the seven decisions. A clamp would have made this 500 and
    // presented it as the meeting's decision.
    if (!beyond.ok) expect(beyond.error.reason).toBe('review-calibrated-score-out-of-range');
  });

  it('refuses completion by the auto-approver, and without the calibration a template required', () => {
    const review = enrolled();

    expect(review.ok).toBe(true);
    if (!review.ok) return;

    const scored = recordScore(review.value, outcome, day('2027-01-10'));

    expect(scored.ok).toBe(true);
    if (!scored.ok) return;

    const manager = { ...scored.value, status: 'manager_assessment' as const };

    expect(
      completeReview(manager, {
        completedBy: 'system:auto-approval',
        completedAt: day('2027-01-20'),
        calibrationRequired: false,
      }).ok,
    ).toBe(false);

    expect(
      completeReview(manager, {
        completedBy: 'user:hr',
        completedAt: day('2027-01-20'),
        calibrationRequired: true,
      }).ok,
    ).toBe(false);

    const completed = completeReview(manager, {
      completedBy: 'user:hr',
      completedAt: day('2027-01-20'),
      calibrationRequired: false,
    });

    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    // Immutable from here. The only move left is archival, and a correction is a new review.
    expect(recordScore(completed.value, outcome, day('2027-02-01')).ok).toBe(false);
    expect(archiveReview(completed.value, day('2027-06-01')).ok).toBe(true);
  });

  it('keeps a multi-rater panel independent of its subject and their manager', () => {
    const review = enrolled();

    expect(review.ok).toBe(true);
    if (!review.ok) return;

    const asSubject = assignReviewer(review.value, 'ra-1', {
      reviewerEmploymentId: 'employment-1',
      role: 'peer',
      requestedAt: day('2027-01-01'),
      requestedBy: 'user:hr',
    });

    expect(asSubject.ok).toBe(false);
    if (!asSubject.ok) expect(asSubject.error.reason).toBe('reviewer-subject-not-independent');

    const asManager = assignReviewer(review.value, 'ra-2', {
      reviewerEmploymentId: 'employment-9',
      role: 'peer',
      requestedAt: day('2027-01-01'),
      requestedBy: 'user:hr',
    });

    expect(asManager.ok).toBe(false);
    if (!asManager.ok) expect(asManager.error.reason).toBe('reviewer-manager-not-peer');

    const peer = assignReviewer(review.value, 'ra-3', {
      reviewerEmploymentId: 'employment-4',
      role: 'peer',
      requestedAt: day('2027-01-01'),
      requestedBy: 'user:hr',
    });

    expect(peer.ok).toBe(true);
    if (!peer.ok) return;

    expect(moveAssignment(peer.value, 'declined', day('2027-01-05')).ok).toBe(false);
    expect(moveAssignment(peer.value, 'declined', day('2027-01-05'), 'On leave').ok).toBe(true);
  });

  it('withholds a multi-rater aggregate below the template’s minimum', () => {
    const responses = [
      { role: 'peer' as const, status: 'submitted' as const },
      { role: 'peer' as const, status: 'pending' as const },
      { role: 'manager' as const, status: 'submitted' as const },
    ];

    // One peer response, and the manager's does not count toward a peer minimum.
    expect(multiRaterAggregateAvailable(responses, 3)).toBe(false);
    expect(multiRaterAggregateAvailable(responses, 1)).toBe(true);
    // This withholds a number. It does not make the rows behind it anonymous, and nothing in this
    // module claims that it does.
    expect(multiRaterAggregateAvailable(responses, undefined)).toBe(true);
  });
});

describe('the assessment', () => {
  const started = () =>
    startAssessment({
      assessmentId: 'assessment-1',
      reviewId: 'review-1',
      assessorEmploymentId: 'employment-9',
      assessmentKind: 'manager',
    });

  it('records an unscored line as excluded rather than as a zero', () => {
    const assessment = started();

    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;

    const item = recordItem(
      assessment.value,
      { assessmentItemId: 'ai-1', itemKind: 'goal', goalId: 'goal-1', weightBasisPoints: 5000 },
      SCALE,
    );

    expect(item.ok).toBe(true);
    if (!item.ok) return;

    // The fifth approved scoring decision. A zero is a judgement somebody made; an absence is the
    // fact that nobody did, and the two must not look the same to an aggregate.
    expect(item.value.excluded).toBe(true);
    expect(item.value.exclusionReason).toBe('missing');
    expect(item.value.score).toBeUndefined();
  });

  it('refuses a score outside the scale and a line that names two subjects', () => {
    const assessment = started();

    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;

    const beyond = recordItem(
      assessment.value,
      { assessmentItemId: 'ai-1', itemKind: 'goal', goalId: 'goal-1', score: 900 },
      SCALE,
    );

    expect(beyond.ok).toBe(false);
    if (!beyond.ok) expect(beyond.error.reason).toBe('assessment-item-score-out-of-range');

    const ambiguous = recordItem(
      assessment.value,
      {
        assessmentItemId: 'ai-2',
        itemKind: 'goal',
        goalId: 'goal-1',
        competencyId: 'competency-1',
        score: 300,
      },
      SCALE,
    );

    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.error.reason).toBe('assessment-item-subject-ambiguous');
  });

  it('freezes on submission, and refuses to submit nothing at all', () => {
    const assessment = started();

    expect(assessment.ok).toBe(true);
    if (!assessment.ok) return;

    const empty = submitAssessment(assessment.value, [], {
      submittedBy: 'user:manager',
      submittedAt: day('2027-01-10'),
    });

    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.reason).toBe('assessment-has-no-items');

    const item = recordItem(
      assessment.value,
      {
        assessmentItemId: 'ai-1',
        itemKind: 'goal',
        goalId: 'goal-1',
        score: 400,
        weightBasisPoints: 10_000,
      },
      SCALE,
    );

    expect(item.ok).toBe(true);
    if (!item.ok) return;

    const submitted = submitAssessment(assessment.value, [item.value], {
      submittedBy: 'user:manager',
      submittedAt: day('2027-01-10'),
    });

    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    // A manager cannot overwrite an employee's self-assessment because there is no column to do it
    // in, and neither can they rewrite their own once it is submitted.
    expect(
      recordItem(
        submitted.value,
        { assessmentItemId: 'ai-2', itemKind: 'goal', goalId: 'goal-2', score: 100 },
        SCALE,
      ).ok,
    ).toBe(false);
    expect(
      submitAssessment(submitted.value, [item.value], {
        submittedBy: 'user:manager',
        submittedAt: day('2027-01-11'),
      }).ok,
    ).toBe(false);
  });
});
