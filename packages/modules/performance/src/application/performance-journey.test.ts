import { beforeEach, describe, expect, it } from 'vitest';

import { HR, MANAGER, harnessFor, send, type Harness } from './performance-test-harness.js';
import {
  EMPLOYEE_EMPLOYMENT,
  LEGAL_ENTITY,
  MANAGER_EMPLOYMENT,
  NAME,
  PEER_EMPLOYMENT,
  UNIT,
  configure,
  createGoals,
  openCycleWith,
  registerWorkforce,
  submitManagerAssessment,
  type Configured,
} from './performance-scenarios.js';
import type { ReviewDetailView } from '../contracts/views.js';

/**
 * The whole journey, through the real dispatcher and the real handlers.
 *
 * Configure → open a cycle → enrol → set goals → assess → score → calibrate → complete → read the
 * historical result. Nothing is seeded; every step is a command an administrator or a manager would
 * actually send, which is what makes this a test of the application boundary rather than of the
 * stores.
 *
 * The assertion that matters most is the last one: **changing the configuration after completion
 * does not change what the completed review says.** That is the whole purpose of the snapshot, and
 * it is the one property that cannot be checked by reading the code.
 */

describe('the performance journey', () => {
  let harness: Harness;
  let configured: Configured;

  beforeEach(async () => {
    harness = harnessFor();
    registerWorkforce(harness);
    configured = await configure(harness, HR, {
      requiresCalibration: true,
      requiresPeerAssessment: true,
      minimumPeerResponses: 2,
    });
  });

  it('carries one employment from enrolment to a completed, explainable rating', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 6000 },
      { weightBasisPoints: 4000 },
    ]);

    // A peer is invited by name. Nothing about this is anonymous, and the invitation records who
    // asked and who was asked.
    const invited = await harness.as(HR, () =>
      send<{ readonly reviewerAssignmentId: string }>(harness, {
        commandName: 'performance.assign-reviewer',
        reviewId: enrolled.reviewId,
        reviewerEmploymentId: PEER_EMPLOYMENT,
        role: 'peer',
      }),
    );

    expect(invited.reviewerAssignmentId).toBeDefined();
    // The intent was recorded. Nothing was delivered, because nothing delivers (D-21).
    expect(harness.notifications.recorded.map((intent) => intent.templateKey)).toContain(
      'performance.reviewer.invited',
    );

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 400 },
      { goalId: goalIds[1], score: 300 },
      { competencyId: configured.competencyIds[0], score: 500 },
      { competencyId: configured.competencyIds[1], score: 300 },
    ]);

    const scored = await harness.as(MANAGER, () =>
      send<{ readonly score: number }>(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );

    // Goals: (400 × 6000 + 300 × 4000) ÷ 10000 = 360. Competencies: (500 + 300) ÷ 2 = 400.
    // Final: (360 × 6000 + 400 × 4000) ÷ 10000 = 376.
    expect(scored.score).toBe(376);

    const level = await ratingLevelOrdinal(harness, 3);
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
        calibratedScore: 350,
        calibratedRatingLevelId: level,
        reason: 'Moderated against the peer group',
        decidedByEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.conclude-calibration',
        calibrationSessionId: session.calibrationSessionId,
        expectedVersion: 2,
      }),
    );
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 3,
        status: 'manager_assessment',
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 4,
      }),
    );

    const detail = await read(harness, enrolled.reviewId);

    expect(detail.review.status).toBe('completed');
    // The calibrated value is effective; the engine's answer is exactly where it was left.
    expect(detail.review.finalScore).toBe(350);
    expect(detail.review.calculatedScore).toBe(376);
    expect(detail.calibration?.originalScore).toBe(376);
    expect(detail.calibration?.reason).toBe('Moderated against the peer group');

    // The working is there, so the rating can be talked through with the person it belongs to.
    expect(detail.componentScores.map((component) => component.component).sort()).toEqual([
      'competencies',
      'goals',
    ]);

    // The snapshot holds the inputs to the decision — including the organizational placement,
    // resolved through Organization's published contract at the moment of completion.
    expect(detail.snapshot?.placement.organizationUnitId).toBe(UNIT);
    expect(detail.snapshot?.placement.legalEntityId).toBe(LEGAL_ENTITY);
    expect(detail.snapshot?.managerEmploymentId).toBe(MANAGER_EMPLOYMENT);
    expect(detail.snapshot?.goals).toHaveLength(2);
    expect(detail.snapshot?.calculation.calculatedScore).toBe(376);
    expect(detail.snapshot?.calculation.finalScore).toBe(350);

    // The multi-rater aggregate is withheld: one peer was invited and none responded, and the
    // template asks for two. That withholds a number. It does not make anything anonymous.
    expect(detail.peerAggregate.available).toBe(false);
    expect(detail.peerAggregate.minimumResponses).toBe(2);

    // A completed review carries no name and no pay, and there is nowhere in the view to put one.
    expect(JSON.stringify(detail)).not.toContain('salary');
  });

  it('does not rewrite a completed review when the configuration changes afterwards', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 400 },
      { competencyId: configured.competencyIds[0], score: 400 },
      { competencyId: configured.competencyIds[1], score: 400 },
    ]);
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );

    const level = await ratingLevelOrdinal(harness, 4);
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
        calibratedScore: 400,
        calibratedRatingLevelId: level,
        reason: 'Confirmed',
        decidedByEmploymentId: MANAGER_EMPLOYMENT,
      }),
    );
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 3,
        status: 'manager_assessment',
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 4,
      }),
    );

    const before = await read(harness, enrolled.reviewId);

    // Now change the world underneath it: retire the scale, retire the framework, retire the
    // template, and move the employment to a different manager and unit.
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.retire-rating-scale',
        ratingScaleId: configured.ratingScaleId,
        expectedVersion: 1,
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.retire-framework',
        frameworkId: configured.frameworkId,
        expectedVersion: 1,
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.retire-template',
        templateId: configured.templateId,
        expectedVersion: 1,
      }),
    );
    harness.employment.add({
      employmentId: EMPLOYEE_EMPLOYMENT,
      status: 'active',
      active: true,
      managerEmploymentId: '01930000-0000-7000-8000-00000000e999',
      organizationUnitId: '01930000-0000-7000-8000-00000000u999',
    });

    const after = await read(harness, enrolled.reviewId);

    // Not one number moved. The snapshot is the inputs to the decision, frozen at completion — a
    // review that re-read current configuration would change when somebody transferred.
    expect(after.review.finalScore).toBe(before.review.finalScore);
    expect(after.snapshot?.managerEmploymentId).toBe(MANAGER_EMPLOYMENT);
    expect(after.snapshot?.placement.organizationUnitId).toBe(UNIT);
    expect(after.snapshot?.ratingScale.levels).toHaveLength(4);
    expect(after.snapshot?.competencyFramework?.frameworkVersion).toBe(1);
    expect(after.snapshot?.componentScores).toEqual(before.snapshot?.componentScores);
  });
});

const read = async (harness: Harness, reviewId: string): Promise<ReviewDetailView> => {
  const result = await harness.as(HR, () =>
    harness.dispatcher.ask<ReviewDetailView>({
      queryName: 'performance.read-review',
      reviewId,
    } as never),
  );

  if (!result.ok) throw new Error(`The review could not be read: ${JSON.stringify(result.error)}`);
  return result.value;
};

const ratingLevelOrdinal = async (harness: Harness, ordinal: number): Promise<string> => {
  const scales = await harness.as(HR, () =>
    harness.dispatcher.ask<{
      readonly items: readonly {
        readonly levels: readonly { readonly ratingLevelId: string; readonly ordinal: number }[];
      }[];
    }>({ queryName: 'performance.rating-scales' }),
  );

  if (!scales.ok) throw new Error('The rating scale could not be read.');

  const level = scales.value.items[0]?.levels.find((candidate) => candidate.ordinal === ordinal);

  if (level === undefined) throw new Error(`No rating level at ordinal ${String(ordinal)}.`);
  return level.ratingLevelId;
};
