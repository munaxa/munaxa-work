import type { CalibrationDecisionView, ReviewView } from '@work/performance/contracts';
import { describe, expect, it } from 'vitest';

import { exactText, ratingFor, scoreText, weightText } from './scoring';

/**
 * A score must leave this screen as the number the engine produced.
 *
 * The API already proved the value survives a driver, an integer column, a driver again and
 * `JSON.stringify` — `performance.lifecycle.spec.ts` asserts 370, the scale bounds and
 * `9007199254740993`. What these check is the last step nobody else covers: that a browser rendering
 * it does not round it, divide it, or hand it to `Number` on the way to a table cell.
 */

const aReview = (overrides: Partial<ReviewView> = {}): ReviewView => ({
  reviewId: '01930000-0000-7000-8000-000000000001',
  cycleId: '01930000-0000-7000-8000-000000000002',
  employmentId: '01930000-0000-7000-8000-000000000003',
  ratingScaleId: '01930000-0000-7000-8000-000000000004',
  status: 'manager_assessment',
  calibrated: false,
  version: 1,
  ...overrides,
});

const aDecision = (overrides: Partial<CalibrationDecisionView> = {}): CalibrationDecisionView => ({
  calibrationDecisionId: '01930000-0000-7000-8000-000000000005',
  calibrationSessionId: '01930000-0000-7000-8000-000000000006',
  calibratedScore: 350,
  calibratedRatingLevelId: '01930000-0000-7000-8000-000000000007',
  reason: 'Moderated against the peer group',
  decidedAt: '2027-01-10T09:00:00.000Z',
  decidedBy: 'user:performance-manager',
  ...overrides,
});

describe('rendering a score without recomputing one', () => {
  it('places the decimal point by string surgery rather than by dividing', () => {
    expect(scoreText(370)).toBe('3.70');
    expect(scoreText(500)).toBe('5.00');
    expect(scoreText(100)).toBe('1.00');
    // Zero is a score, not an absence. It renders as a number.
    expect(scoreText(0)).toBe('0.00');
    // Absent is an absence, and renders as one. A screen showing 0.00 for a review nobody scored
    // would be telling somebody they were rated at the bottom of the scale.
    expect(scoreText(undefined)).toBe('—');
  });

  it('pads a value smaller than one whole rather than losing its leading zero', () => {
    expect(scoreText(5)).toBe('0.05');
    expect(scoreText(50)).toBe('0.50');
  });

  it('renders weights as basis points, including the total of a whole template', () => {
    expect(weightText(6000)).toBe('60.00%');
    expect(weightText(10_000)).toBe('100.00%');
    expect(weightText(undefined)).toBe('—');
  });
});

describe('an exact measurement', () => {
  /**
   * The mandatory regression. `9007199254740993` is 2^53 + 1, and `Number` of it is
   * `9007199254740992` — the last digit is simply gone, with nothing to indicate it.
   */
  it('renders a value larger than a double can hold, digit for digit', () => {
    const enormous = '9007199254740993';

    expect(exactText(enormous)).toBe(enormous);
    expect(exactText(enormous)).not.toBe('9007199254740992');
    // And the value the screen holds is still the string, so anything that reused it — a filter, a
    // link, a request a later phase adds — carries the same digits rather than a rounded double.
    expect(exactText(enormous)).toBe(String(enormous));
  });

  it('is the identity function, so nothing formats it into a different number', () => {
    for (const value of ['0', '-1', '9007199254740993', '123456789012345678901234567890']) {
      expect(exactText(value)).toBe(value);
    }
  });
});

describe('what calibration did, and what it did not do', () => {
  it('keeps the calculated score beside the calibrated one rather than replacing it', () => {
    const rating = ratingFor(
      aReview({ calculatedScore: 400, finalScore: 350, calibrated: true }),
      aDecision({ originalScore: 400, calibratedScore: 350 }),
    );

    expect(rating.calculated).toBe('4.00');
    expect(rating.final).toBe('3.50');
    expect(rating.original).toBe('4.00');
    expect(rating.moderated).toBe(true);
    expect(rating.reason).toBe('Moderated against the peer group');
  });

  it('does not call a confirmed rating an override', () => {
    // The panel looked at it and agreed with the engine. Labelling that an override would
    // misrepresent what happened to the person whose rating it is.
    const rating = ratingFor(
      aReview({ calculatedScore: 400, finalScore: 400, calibrated: true }),
      aDecision({ originalScore: 400, calibratedScore: 400 }),
    );

    expect(rating.moderated).toBe(false);
    expect(rating.calculated).toBe('4.00');
    expect(rating.final).toBe('4.00');
  });

  it('shows no original at all for a review nobody calibrated', () => {
    const rating = ratingFor(aReview({ calculatedScore: 400 }), undefined);

    // Not '—', which would look like a calibration that recorded nothing. Absent, so the section
    // that renders it does not appear.
    expect(rating.original).toBeUndefined();
    expect(rating.moderated).toBe(false);
    // With no calibration, the final score is the calculated one — read from the review, not
    // computed here.
    expect(rating.final).toBe('4.00');
  });
});
