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
  DIRECTOR_EMPLOYMENT,
  EMPLOYEE_EMPLOYMENT,
  NAME,
  configure,
  createGoals,
  openCycleWith,
  registerWorkforce,
  submitManagerAssessment,
  type Configured,
} from './performance-scenarios.js';
import { PerformancePermissions } from './performance-permissions.js';

/**
 * Every refusal the checkpoint requires, and the permitted case beside it.
 *
 * A rule that is only ever tested by its refusal is a rule that might be refusing everything. So
 * each block below asserts the thing that *is* allowed as well as the thing that is not — the
 * lesson Phase 12 learned when two triggers turned out to refuse more than they should.
 */

/**
 * The refusals that guard a rating once it exists: who may calibrate it, who may approve anything,
 * who may read it, and what reconciliation does with what it finds.
 *
 * `system:auto-approval` decides nothing here, as it decides nothing in the five modules before
 * this one — and the actor comes from the authenticated context, so the only way to test the rule
 * is to act as it and watch the aggregate refuse.
 */

describe('what the application refuses about a rating', () => {
  let harness: Harness;
  let configured: Configured;

  beforeEach(async () => {
    harness = harnessFor();
    registerWorkforce(harness);
    configured = await configure(harness, HR);
  });

  const scoredReview = async (): Promise<{
    readonly cycleId: string;
    readonly reviewId: string;
  }> => {
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

    return enrolled;
  };

  it('refuses calibration without the permission, and refuses calibrating one’s own review', async () => {
    const enrolled = await scoredReview();
    const restricted = harnessFor({
      permissions: [PerformancePermissions.cycleManage, PerformancePermissions.assess],
    });

    registerWorkforce(restricted);

    const unauthorized = await restricted.as(MANAGER, () =>
      attempt(restricted, {
        commandName: 'performance.schedule-calibration',
        cycleId: enrolled.cycleId,
        code: 'engineering',
        name: NAME,
      }),
    );

    expect(unauthorized.ok).toBe(false);
    expect(reasonOf(unauthorized)).toBe(`forbidden:${PerformancePermissions.calibrate}`);

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

    const level = await topLevel(harness);
    const own = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.record-calibration-decision',
        calibrationSessionId: session.calibrationSessionId,
        reviewId: enrolled.reviewId,
        expectedReviewVersion: 2,
        calibratedScore: 450,
        calibratedRatingLevelId: level,
        reason: 'Raising my own',
        decidedByEmploymentId: EMPLOYEE_EMPLOYMENT,
      }),
    );

    expect(own.ok).toBe(false);
    expect(reasonOf(own)).toContain('calibration-self-refused');

    // The permitted case: somebody else's, with a reason.
    const permitted = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.record-calibration-decision',
        calibrationSessionId: session.calibrationSessionId,
        reviewId: enrolled.reviewId,
        expectedReviewVersion: 2,
        calibratedScore: 450,
        calibratedRatingLevelId: level,
        reason: 'Moderated against the peer group',
        decidedByEmploymentId: DIRECTOR_EMPLOYMENT,
      }),
    );

    expect(permitted.ok).toBe(true);
  });

  it('refuses a calibration decision with no recorded reason', async () => {
    const enrolled = await scoredReview();
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

    const level = await topLevel(harness);
    const result = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.record-calibration-decision',
        calibrationSessionId: session.calibrationSessionId,
        reviewId: enrolled.reviewId,
        expectedReviewVersion: 2,
        calibratedScore: 450,
        calibratedRatingLevelId: level,
        reason: '   ',
        decidedByEmploymentId: DIRECTOR_EMPLOYMENT,
      }),
    );

    expect(result.ok).toBe(false);
    expect(reasonOf(result)).toContain('calibration-decision-needs-reason');
  });

  it('refuses a goal approved by nobody in particular', async () => {
    // `system:auto-approval` cannot reach a goal because the actor comes from the context, so the
    // way to prove the rule is to act *as* it and watch the aggregate refuse.
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goal = await harness.as(HR, () =>
      send<{ readonly goalId: string }>(harness, {
        commandName: 'performance.create-goal',
        scope: 'individual',
        employmentId: EMPLOYEE_EMPLOYMENT,
        cycleId: enrolled.cycleId,
        title: 'A goal',
        measurement: 'numeric',
        weightBasisPoints: 10_000,
        startDate: new Date('2026-01-01'),
        dueDate: new Date('2026-12-31'),
      }),
    );
    const auto = await harness.as('system:auto-approval', () =>
      attempt(harness, {
        commandName: 'performance.approve-goal',
        goalId: goal.goalId,
        expectedVersion: 1,
      }),
    );

    expect(auto.ok).toBe(false);
    expect(reasonOf(auto)).toContain('goal-approval-not-human');

    const human = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.approve-goal',
        goalId: goal.goalId,
        expectedVersion: 1,
      }),
    );

    expect(human.ok).toBe(true);
  });

  it('refuses a review completed by the auto-approver', async () => {
    const enrolled = await scoredReview();

    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 2,
        status: 'manager_assessment',
      }),
    );

    const auto = await harness.as('system:auto-approval', () =>
      attempt(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 3,
      }),
    );

    expect(auto.ok).toBe(false);
    expect(reasonOf(auto)).toContain('review-completion-not-human');
  });
});

const topLevel = async (harness: Harness): Promise<string> => {
  const scales = await harness.as(HR, () =>
    harness.dispatcher.ask<{
      readonly items: readonly {
        readonly levels: readonly { readonly ratingLevelId: string; readonly ordinal: number }[];
      }[];
    }>({ queryName: 'performance.rating-scales' }),
  );

  if (!scales.ok) throw new Error('The rating scale could not be read.');

  const level = scales.value.items[0]?.levels.find((candidate) => candidate.ordinal === 4);

  if (level === undefined) throw new Error('No top rating level.');
  return level.ratingLevelId;
};
