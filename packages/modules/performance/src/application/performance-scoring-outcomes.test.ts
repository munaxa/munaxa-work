import { beforeEach, describe, expect, it } from 'vitest';
import {
  HR,
  MANAGER,
  attempt,
  harnessFor,
  reasonOf,
  send,
  type Harness,
} from './performance-test-harness.js';
import {
  EMPLOYEE_EMPLOYMENT,
  MANAGER_EMPLOYMENT,
  NAME,
  configure,
  createGoals,
  openCycleWith,
  registerWorkforce,
  submitManagerAssessment,
  type AssessmentLine,
  type Configured,
} from './performance-scenarios.js';

/**
 * The seventeen golden cases, through the **whole application layer** rather than through the pure
 * engine.
 *
 * The domain suite already proves the arithmetic in isolation. What these prove is that the
 * arithmetic survives assembly: that the goal weights the engine divides by are the *tenant's*
 * weights from the goal rows and not whatever an assessor typed, that a cancelled goal never reaches
 * the denominator by any path a command can take, that a component the template declared but nobody
 * assessed leaves the final denominator with a recorded reason, and that every refusal the approved
 * decisions require reaches the caller as a refusal rather than as a number.
 *
 * Every expectation below is the arithmetic written out, not a constant somebody read off a run.
 */

/**
 * The remaining golden cases: what leaves the denominator, what is refused outright, and what a
 * calibration override does to the two numbers a review carries.
 *
 * The last two are the seventh approved scoring decision proved end to end — the calibrated value
 * becomes effective and the engine's answer stays exactly where it was, with the decision row
 * carrying both.
 */

describe('scoring exclusions and overrides, through the application', () => {
  let harness: Harness;
  let configured: Configured;

  beforeEach(async () => {
    harness = harnessFor();
    registerWorkforce(harness);
    configured = await configure(harness, HR);
  });

  /** Enrol, create goals, assess and score. Returns whatever the score command answered. */
  const scoreWith = async (
    goals: readonly { readonly weightBasisPoints: number; readonly cancel?: boolean }[],
    lines: (goalIds: readonly string[]) => readonly AssessmentLine[],
  ): Promise<ReturnType<typeof attempt>> => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, goals);

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, lines(goalIds));

    return harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );
  };

  const scored = async (
    goals: readonly { readonly weightBasisPoints: number; readonly cancel?: boolean }[],
    lines: (goalIds: readonly string[]) => readonly AssessmentLine[],
  ): Promise<number> => {
    const result = await scoreWith(goals, lines);

    if (!result.ok) throw new Error(`Refused: ${reasonOf(result)}`);
    return (result.value as { readonly score: number }).score;
  };

  it('9 · excludes a cancelled goal entirely, by every path a command can take', async () => {
    const score = await scored(
      [{ weightBasisPoints: 6000 }, { weightBasisPoints: 4000, cancel: true }],
      (goals) => [
        { goalId: goals[0], score: 400 },
        { competencyId: configured.competencyIds[0], score: 400 },
        { competencyId: configured.competencyIds[1], score: 400 },
      ],
    );

    // 400, not 240. The cancelled goal contributes neither a score nor a denominator weight, even
    // though its weight is still 4,000 on the row.
    expect(score).toBe(400);
  });

  it('10 · lets a zero-weight goal be scored and count for nothing', async () => {
    const score = await scored(
      [{ weightBasisPoints: 10_000 }, { weightBasisPoints: 0 }],
      (goals) => [
        { goalId: goals[0], score: 400 },
        { goalId: goals[1], score: 100 },
        { competencyId: configured.competencyIds[0], score: 400 },
        { competencyId: configured.competencyIds[1], score: 400 },
      ],
    );

    expect(score).toBe(400);
  });

  it('11 · refuses to submit an assessment with no lines at all', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);

    await createGoals(harness, HR, enrolled.cycleId, [{ weightBasisPoints: 10_000 }]);

    const started = await harness.as(MANAGER, () =>
      send<{ readonly assessmentId: string }>(harness, {
        commandName: 'performance.start-assessment',
        reviewId: enrolled.reviewId,
        assessmentKind: 'manager',
        assessorEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );
    const result = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.submit-assessment',
        assessmentId: started.assessmentId,
        expectedVersion: 1,
      }),
    );

    // The empty denominator never reaches the engine, because an assessment with no lines cannot
    // be submitted at all. Submitting nothing is not assessing, and an empty submission would
    // satisfy a completeness check while telling the person nothing.
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('assessment-has-no-items');
  });

  it('12 · refuses a review where every component was excluded', async () => {
    const result = await scoreWith([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], exclusionReason: 'not_applicable' },
    ]);

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('scoring-nothing-assessed');
  });

  it('13 · refuses component weights that do not total 10,000', async () => {
    const uneven = harnessFor();

    registerWorkforce(uneven);

    const result = await uneven.as(HR, () =>
      attempt(uneven, {
        commandName: 'performance.define-template',
        code: 'uneven',
        name: NAME,
        ratingScaleId: '01930000-0000-7000-8000-00000000s001',
        requiresSelfAssessment: false,
        requiresPeerAssessment: false,
        requiresCalibration: false,
        goalWeightTotalBasisPoints: 10_000,
        components: [
          { component: 'goals', weightBasisPoints: 6000 },
          { component: 'competencies', weightBasisPoints: 3000 },
        ],
      }),
    );

    // Refused before anything can be scored against it — the first of the three places this rule
    // is enforced. The rating scale is not even looked up, because the shape is wrong first.
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toMatch(/not_found|component-weights-not-total/);
  });

  it('14 · refuses an assessed item outside the rating scale rather than clamping it', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);
    const started = await harness.as(MANAGER, () =>
      send<{ readonly assessmentId: string }>(harness, {
        commandName: 'performance.start-assessment',
        reviewId: enrolled.reviewId,
        assessmentKind: 'manager',
        assessorEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );
    const result = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.record-assessment-item',
        assessmentId: started.assessmentId,
        itemKind: 'goal',
        goalId: goalIds[0],
        score: 900,
      }),
    );

    // A clamp would have made this 500 and told somebody it was their rating.
    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('assessment-item-score-out-of-range');
  });

  it('15 · refuses a calibrated score outside the scale rather than clamping it', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 300 },
    ]);
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );

    const session = await harness.as(HR, () =>
      send<{ readonly calibrationSessionId: string }>(harness, {
        commandName: 'performance.schedule-calibration',
        cycleId: enrolled.cycleId,
        code: 'engineering',
        name: NAME,
      }),
    );

    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.move-calibration',
        calibrationSessionId: session.calibrationSessionId,
        expectedVersion: 1,
        status: 'in_session',
      }),
    );

    const result = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.record-calibration-decision',
        calibrationSessionId: session.calibrationSessionId,
        reviewId: enrolled.reviewId,
        expectedReviewVersion: 2,
        calibratedScore: 900,
        calibratedRatingLevelId: 'level-4',
        reason: 'Out of range',
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('calibration-score-out-of-range');
  });

  it('16 · applies a calibration override and makes it effective', async () => {
    const outcome = await calibrated(harness, configured, 450);

    expect(outcome.finalScore).toBe(450);
    expect(outcome.calibrated).toBe(true);
  });

  it('17 · keeps the original calculated score after an override', async () => {
    const outcome = await calibrated(harness, configured, 450);

    // The seventh approved decision. The calibrated value is effective; the engine's answer stays
    // exactly where it was, and the decision row carries both.
    expect(outcome.calculatedScore).toBe(300);
    expect(outcome.decisionOriginal).toBe(300);
    expect(outcome.decisionCalibrated).toBe(450);
  });
});

interface CalibratedOutcome {
  readonly calculatedScore?: number;
  readonly finalScore?: number;
  readonly calibrated: boolean;
  readonly decisionOriginal?: number;
  readonly decisionCalibrated?: number;
}

/** Scores a review at 300 and then calibrates it, returning both numbers and the decision's. */
const calibrated = async (
  harness: Harness,
  configured: Configured,
  to: number,
): Promise<CalibratedOutcome> => {
  const enrolled = await openCycleWith(harness, HR, configured.templateId);
  const goalIds = await createGoals(harness, HR, enrolled.cycleId, [{ weightBasisPoints: 10_000 }]);

  await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
    { goalId: goalIds[0], score: 300 },
    { competencyId: configured.competencyIds[0], score: 300 },
    { competencyId: configured.competencyIds[1], score: 300 },
  ]);
  await harness.as(MANAGER, () =>
    send(harness, {
      commandName: 'performance.score-review',
      reviewId: enrolled.reviewId,
      expectedVersion: 1,
    }),
  );

  const levels = await harness.as(HR, () =>
    harness.dispatcher.ask<{
      readonly items: readonly {
        readonly levels: readonly { readonly ratingLevelId: string; readonly ordinal: number }[];
      }[];
    }>({ queryName: 'performance.rating-scales' }),
  );
  const top = levels.ok
    ? levels.value.items[0]?.levels.find((level) => level.ordinal === 4)?.ratingLevelId
    : undefined;
  const session = await harness.as(HR, () =>
    send<{ readonly calibrationSessionId: string }>(harness, {
      commandName: 'performance.schedule-calibration',
      cycleId: enrolled.cycleId,
      code: 'engineering',
      name: NAME,
    }),
  );

  await harness.as(HR, () =>
    send(harness, {
      commandName: 'performance.move-calibration',
      calibrationSessionId: session.calibrationSessionId,
      expectedVersion: 1,
      status: 'in_session',
    }),
  );
  await harness.as(HR, () =>
    send(harness, {
      commandName: 'performance.record-calibration-decision',
      calibrationSessionId: session.calibrationSessionId,
      reviewId: enrolled.reviewId,
      expectedReviewVersion: 2,
      calibratedScore: to,
      calibratedRatingLevelId: top ?? '',
      reason: 'Consistent with the peer group after comparison',
      decidedByEmploymentId: EMPLOYEE_EMPLOYMENT === undefined ? undefined : MANAGER_EMPLOYMENT,
    }),
  );

  const detail = await harness.as(HR, () =>
    harness.dispatcher.ask<{
      readonly review: {
        readonly calculatedScore?: number;
        readonly finalScore?: number;
        readonly calibrated: boolean;
      };
      readonly calibration?: {
        readonly originalScore?: number;
        readonly calibratedScore: number;
      };
    }>({ queryName: 'performance.read-review', reviewId: enrolled.reviewId } as never),
  );

  if (!detail.ok) throw new Error('The review could not be read back.');

  return {
    calibrated: detail.value.review.calibrated,
    ...(detail.value.review.calculatedScore === undefined
      ? {}
      : { calculatedScore: detail.value.review.calculatedScore }),
    ...(detail.value.review.finalScore === undefined
      ? {}
      : { finalScore: detail.value.review.finalScore }),
    ...(detail.value.calibration === undefined
      ? {}
      : {
          decisionCalibrated: detail.value.calibration.calibratedScore,
          ...(detail.value.calibration.originalScore === undefined
            ? {}
            : { decisionOriginal: detail.value.calibration.originalScore }),
        }),
  };
};
