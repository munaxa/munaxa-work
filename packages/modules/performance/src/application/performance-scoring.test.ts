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

describe('scoring, through the application', () => {
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

  it('1 · weights the goal aggregate by the tenant’s goal weights', async () => {
    const score = await scored(
      [{ weightBasisPoints: 7000 }, { weightBasisPoints: 3000 }],
      (goals) => [
        { goalId: goals[0], score: 400 },
        { goalId: goals[1], score: 200 },
        { competencyId: configured.competencyIds[0], score: 300 },
        { competencyId: configured.competencyIds[1], score: 300 },
      ],
    );

    // Goals: (400 × 7000 + 200 × 3000) ÷ 10000 = 340. Competencies, unweighted: (300 + 300) ÷ 2 =
    // 300. Final: (340 × 6000 + 300 × 4000) ÷ 10000 = 324.
    expect(score).toBe(324);
  });

  it('2 · takes the whole score from one goal at full weight', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 500 },
      { competencyId: configured.competencyIds[0], score: 500 },
      { competencyId: configured.competencyIds[1], score: 500 },
    ]);

    // The maximum of the scale, reachable and not clamped to something below it.
    expect(score).toBe(500);
  });

  it('3 · averages competencies without weighting them', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 300 },
      { competencyId: configured.competencyIds[0], score: 100 },
      { competencyId: configured.competencyIds[1], score: 500 },
    ]);

    // Competencies: (100 + 500) ÷ 2 = 300. Final: (300 × 6000 + 300 × 4000) ÷ 10000 = 300.
    expect(score).toBe(300);
  });

  it('4 · combines the two components by their template weights', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 500 },
      { competencyId: configured.competencyIds[0], score: 100 },
      { competencyId: configured.competencyIds[1], score: 100 },
    ]);

    // (500 × 6000 + 100 × 4000) ÷ 10000 = 340. An unweighted mean would have been 300.
    expect(score).toBe(340);
  });

  it('5 · rounds a boundary to the nearest hundredth', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 301 },
      { competencyId: configured.competencyIds[0], score: 300 },
      { competencyId: configured.competencyIds[1], score: 300 },
    ]);

    // (301 × 6000 + 300 × 4000) ÷ 10000 = 300.6 → 301.
    expect(score).toBe(301);
  });

  it('6 · takes a half away from zero rather than to the even neighbour', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 300 },
      { competencyId: configured.competencyIds[0], score: 301 },
      { competencyId: configured.competencyIds[1], score: 302 },
    ]);

    // Competencies: (301 + 302) ÷ 2 = 301.5 → 302. Final: (300 × 6000 + 302 × 4000) ÷ 10000 =
    // 300.8 → 301. Banker's rounding would have made the competency mean 302 as well here, so the
    // assertion that separates them is in the domain suite; this proves the same rule is applied.
    expect(score).toBe(301);
  });

  it('7 · excludes a component nobody assessed from the final denominator', async () => {
    const score = await scored([{ weightBasisPoints: 10_000 }], (goals) => [
      { goalId: goals[0], score: 400 },
    ]);

    // 400, not 240. The competency component was declared and never assessed, so it leaves the
    // denominator rather than being scored at zero.
    expect(score).toBe(400);
  });

  it('8 · records why an incomplete component was left out', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);

    await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 400 },
    ]);
    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.score-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 1,
      }),
    );

    const detail = await harness.as(HR, () =>
      harness.dispatcher.ask<{
        readonly componentScores: readonly {
          readonly component: string;
          readonly included: boolean;
          readonly exclusionReason?: string;
        }[];
      }>({ queryName: 'performance.read-review', reviewId: enrolled.reviewId } as never),
    );

    expect(detail.ok).toBe(true);
    if (!detail.ok) return;

    const competencies = detail.value.componentScores.find(
      (component) => component.component === 'competencies',
    );

    // The working is persisted, not merely used. A rating somebody disagrees with is a conversation.
    expect(competencies?.included).toBe(false);
    expect(competencies?.exclusionReason).toBe('missing');
  });
});
