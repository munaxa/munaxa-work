import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CONNECTION,
  DOCUMENT_ID,
  EMPLOYEE_ID,
  HR,
  LEGAL_ENTITY_ID,
  MANAGER,
  MANAGER_ID,
  OUTSIDER_ID,
  PEER_ID,
  UNIT_ID,
  ask,
  harnessFor,
  requireDatabaseInCi,
  send,
  type CrossModuleHarness,
} from './phase-thirteen-harness.js';
import { NAME, configure, type Configured } from './phase-thirteen-configuration.js';

/**
 * Phase 13 across every production boundary: the real dispatcher, the real Performance handlers,
 * **real PostgreSQL repositories**, and the real Employment, Organization and Documents adapters
 * under real bounded service grants.
 *
 * The mandatory scenario runs end to end — configure, enrol, set goals, assess, score, calibrate,
 * complete, then change the configuration and read the completed review back unchanged. Nothing in
 * it is stubbed on the Performance side, and the three upstream modules answer through their
 * published contracts on the same dispatcher.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Phase 13 cross-module suite');

suite('phase thirteen, across the product', () => {
  let harness: CrossModuleHarness;

  beforeAll(() => {
    harness = harnessFor();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  it('carries one employment from configuration to an unchangeable historical rating', async () => {
    const configured = await configure(harness);
    const cycle = await send<{ readonly cycleId: string }>(harness, {
      commandName: 'performance.create-cycle',
      code: 'annual-2026',
      name: NAME,
      reviewTemplateId: configured.templateId,
      kind: 'annual',
      periodStart: new Date('2026-01-01'),
      periodEnd: new Date('2026-12-31'),
    });

    await send(harness, {
      commandName: 'performance.move-cycle',
      cycleId: cycle.cycleId,
      expectedVersion: 1,
      status: 'open',
    });

    // Enrolment resolves each employment through Employment's published contract, under a grant.
    const enrolled = await send<{ readonly enrolled: number; readonly refused: readonly string[] }>(
      harness,
      {
        commandName: 'performance.enrol-participants',
        cycleId: cycle.cycleId,
        employmentIds: [EMPLOYEE_ID],
      },
    );

    expect(enrolled.enrolled).toBe(1);
    expect(enrolled.refused).toEqual([]);

    const queue = await ask<{
      readonly items: readonly { readonly reviewId: string; readonly employmentId: string }[];
    }>(harness, { queryName: 'performance.reviews', cycleId: cycle.cycleId });
    const reviewId = queue.items[0]?.reviewId ?? '';

    expect(reviewId).not.toBe('');

    // A goal citing evidence: the document identifier is confirmed through Documents' published
    // read. Nothing is fetched, and nothing claims it could be.
    const goal = await send<{ readonly goalId: string }>(harness, {
      commandName: 'performance.create-goal',
      scope: 'individual',
      employmentId: EMPLOYEE_ID,
      cycleId: cycle.cycleId,
      title: 'Reduce onboarding time to ten days',
      measurement: 'numeric',
      weightBasisPoints: 10_000,
      startDate: new Date('2026-01-01'),
      dueDate: new Date('2026-12-31'),
      evidenceDocumentId: DOCUMENT_ID,
    });

    await send(harness, {
      commandName: 'performance.approve-goal',
      goalId: goal.goalId,
      expectedVersion: 1,
    });
    await send(harness, {
      commandName: 'performance.move-goal',
      goalId: goal.goalId,
      expectedVersion: 2,
      status: 'active',
    });

    // A self assessment and a peer assessment, both recorded and neither counted.
    await send(harness, {
      commandName: 'performance.assign-reviewer',
      reviewId,
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });
    const line = (
      kind: string,
      assessorEmploymentId: string,
      score: number,
    ): AssessmentRequest => ({
      reviewId,
      kind,
      assessorEmploymentId,
      goalId: goal.goalId,
      configured,
      score,
    });

    await recordAssessment(harness, line('self', EMPLOYEE_ID, 500));
    await recordAssessment(harness, line('peer', PEER_ID, 100));
    await recordAssessment(harness, line('manager', MANAGER_ID, 400));

    const scored = await send<{ readonly score: number }>(harness, {
      commandName: 'performance.score-review',
      reviewId,
      expectedVersion: 1,
    });

    // Goals: 400. Competencies: (400 + 400) ÷ 2 = 400. Final: (400 × 6000 + 400 × 4000) ÷ 10000.
    // **The self assessment scored 500 and the peer 100, and neither moved the number.** They are
    // recorded and visible; they do not contribute, because nothing approved says how they would be
    // weighted against the manager's.
    expect(scored.score).toBe(400);

    await calibrateAndComplete(harness, cycle.cycleId, reviewId, configured);

    const completed = await readReview(harness, reviewId);

    expectCompleted(completed);

    await changeTheWorld(harness, configured);

    const afterwards = await readReview(harness, reviewId);

    expectUnchanged(afterwards, completed);
  });
});

interface AssessmentRequest {
  readonly reviewId: string;
  readonly kind: string;
  readonly assessorEmploymentId: string;
  readonly goalId: string;
  readonly configured: Configured;
  readonly score: number;
}

const recordAssessment = async (
  harness: CrossModuleHarness,
  request: AssessmentRequest,
): Promise<void> =>
  harness.as(MANAGER, async () => {
    const started = await send<{ readonly assessmentId: string }>(harness, {
      commandName: 'performance.start-assessment',
      reviewId: request.reviewId,
      assessmentKind: request.kind,
      assessorEmploymentId: request.assessorEmploymentId,
    });

    await send(harness, {
      commandName: 'performance.record-assessment-item',
      assessmentId: started.assessmentId,
      itemKind: 'goal',
      goalId: request.goalId,
      score: request.score,
    });
    for (const competencyId of request.configured.competencyIds) {
      await send(harness, {
        commandName: 'performance.record-assessment-item',
        assessmentId: started.assessmentId,
        itemKind: 'competency',
        competencyId,
        score: 400,
      });
    }
    await send(harness, {
      commandName: 'performance.submit-assessment',
      assessmentId: started.assessmentId,
      expectedVersion: 1,
    });
  });

interface ReviewDetail {
  readonly review: {
    readonly status: string;
    readonly calculatedScore?: number;
    readonly finalScore?: number;
  };
  readonly assessments: readonly { readonly assessmentKind: string }[];
  readonly calibration?: { readonly originalScore?: number };
  readonly snapshot?: {
    readonly managerEmploymentId?: string;
    readonly placement: { readonly organizationUnitId?: string; readonly legalEntityId?: string };
    readonly ratingScale: { readonly levels: readonly unknown[] };
    readonly componentScores: readonly unknown[];
  };
}

const readReview = (harness: CrossModuleHarness, reviewId: string): Promise<ReviewDetail> =>
  harness.as(HR, () =>
    ask<ReviewDetail>(harness, { queryName: 'performance.read-review', reviewId }),
  );

/** Calibrate the review, move it and complete it. Extracted so the scenario reads as its steps. */
const calibrateAndComplete = async (
  harness: CrossModuleHarness,
  cycleId: string,
  reviewId: string,
  configured: Configured,
): Promise<void> => {
  const session = await send<{ readonly calibrationSessionId: string }>(harness, {
    commandName: 'performance.schedule-calibration',
    cycleId,
    code: 'engineering',
    name: NAME,
  });

  await send(harness, {
    commandName: 'performance.move-calibration',
    calibrationSessionId: session.calibrationSessionId,
    expectedVersion: 1,
    status: 'in_session',
  });
  await send(harness, {
    commandName: 'performance.record-calibration-decision',
    calibrationSessionId: session.calibrationSessionId,
    reviewId,
    expectedReviewVersion: 2,
    calibratedScore: 350,
    calibratedRatingLevelId: configured.meetsLevelId,
    reason: 'Moderated against the peer group',
    decidedByEmploymentId: MANAGER_ID,
  });
  await send(harness, {
    commandName: 'performance.move-review',
    reviewId,
    expectedVersion: 3,
    status: 'manager_assessment',
  });
  await send(harness, { commandName: 'performance.complete-review', reviewId, expectedVersion: 4 });
};

/**
 * Everything a completed review must survive: the scale retired, the template retired, and the
 * employment moved to a different manager in a different unit.
 */
const changeTheWorld = async (
  harness: CrossModuleHarness,
  configured: Configured,
): Promise<void> => {
  await send(harness, {
    commandName: 'performance.retire-rating-scale',
    ratingScaleId: configured.ratingScaleId,
    expectedVersion: 1,
  });
  await send(harness, {
    commandName: 'performance.retire-template',
    templateId: configured.templateId,
    expectedVersion: 1,
  });
  const moved = harness.facts.employments.map((employment) =>
    employment.employmentId === EMPLOYEE_ID
      ? { ...employment, managerEmploymentId: OUTSIDER_ID, unitId: 'moved' }
      : employment,
  );

  harness.facts.employments.splice(0, harness.facts.employments.length, ...moved);
};

/** What a completed review says, and where each part of it came from. */
const expectCompleted = (detail: ReviewDetail): void => {
  expect(detail.review.status).toBe('completed');
  expect(detail.review.calculatedScore).toBe(400);
  expect(detail.review.finalScore).toBe(350);
  expect(detail.calibration?.originalScore).toBe(400);
  // The placement was resolved through Organization's published contract at completion.
  expect(detail.snapshot?.placement.legalEntityId).toBe(LEGAL_ENTITY_ID);
  expect(detail.snapshot?.placement.organizationUnitId).toBe(UNIT_ID);
  expect(detail.snapshot?.managerEmploymentId).toBe(MANAGER_ID);
  // All three assessments are kept and readable; only one of them was counted.
  expect(detail.assessments.map((assessment) => assessment.assessmentKind).sort()).toEqual([
    'manager',
    'peer',
    'self',
  ]);
};

/** And what it still says after the scale, the template and the reporting line have all changed. */
const expectUnchanged = (afterwards: ReviewDetail, before: ReviewDetail): void => {
  expect(afterwards.review.finalScore).toBe(350);
  expect(afterwards.review.calculatedScore).toBe(400);
  expect(afterwards.snapshot?.managerEmploymentId).toBe(MANAGER_ID);
  expect(afterwards.snapshot?.placement.legalEntityId).toBe(LEGAL_ENTITY_ID);
  expect(afterwards.snapshot?.ratingScale.levels).toHaveLength(4);
  expect(afterwards.snapshot?.componentScores).toEqual(before.snapshot?.componentScores);
};
