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
  OUTSIDER_EMPLOYMENT,
  PEER_EMPLOYMENT,
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

describe('what the application refuses', () => {
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

  const completed = async (): Promise<string> => {
    const enrolled = await scoredReview();

    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 2,
        status: 'manager_assessment',
      }),
    );
    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 3,
      }),
    );

    return enrolled.reviewId;
  };

  it('completes a review once, and refuses the second attempt deterministically', async () => {
    const enrolled = await scoredReview();

    await harness.as(MANAGER, () =>
      send(harness, {
        commandName: 'performance.move-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 2,
        status: 'manager_assessment',
      }),
    );

    // Two managers, both holding the version they read, both completing. Exactly one wins, and the
    // loser meets the optimistic version — the guarantee the plan names, rather than a unique index
    // on "the completed state", which would be vacuous because one row cannot collide with itself.
    //
    // `ConcurrencyException` travels rather than becoming a `Result`, exactly as it does in every
    // module since Phase 2: the edge turns it into a 409. So the loser *throws*, and the assertion
    // has to say so rather than quietly counting a rejected promise as a refusal.
    const settled = await Promise.allSettled([
      harness.as(HR, () =>
        attempt(harness, {
          commandName: 'performance.complete-review',
          reviewId: enrolled.reviewId,
          expectedVersion: 3,
        }),
      ),
      harness.as(MANAGER, () =>
        attempt(harness, {
          commandName: 'performance.complete-review',
          reviewId: enrolled.reviewId,
          expectedVersion: 3,
        }),
      ),
    ]);
    const succeeded = settled.filter(
      (outcome) => outcome.status === 'fulfilled' && outcome.value.ok,
    );
    const refused = settled.filter((outcome) => outcome.status === 'rejected');

    expect(succeeded).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(String((refused[0] as PromiseRejectedResult).reason)).toMatch(
      /modified by someone else/,
    );

    // And a third attempt, sequentially, is refused by the aggregate rather than by a race.
    const third = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.complete-review',
        reviewId: enrolled.reviewId,
        expectedVersion: 4,
      }),
    );

    expect(third.ok).toBe(false);
  });

  it('refuses to score or reassess a review after it is completed', async () => {
    const reviewId = await completed();

    const rescored = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.score-review',
        reviewId,
        expectedVersion: 4,
      }),
    );

    expect(rescored.ok).toBe(false);
    expect(reasonOf(rescored)).toContain('review-already-completed');

    const reassessed = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.start-assessment',
        reviewId,
        assessmentKind: 'peer',
        assessorEmploymentId: PEER_EMPLOYMENT,
      }),
    );

    expect(reassessed.ok).toBe(false);
    expect(reasonOf(reassessed)).toContain('review-already-completed');

    // The permitted case beside the refusals: archival is the one move a completed review makes.
    const archived = await harness.as(HR, () =>
      attempt(harness, {
        commandName: 'performance.archive-review',
        reviewId,
        expectedVersion: 4,
      }),
    );

    expect(archived.ok).toBe(true);
  });

  it('freezes a submitted assessment against its own author', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);
    const goalIds = await createGoals(harness, HR, enrolled.cycleId, [
      { weightBasisPoints: 10_000 },
    ]);
    const assessmentId = await submitManagerAssessment(harness, MANAGER, enrolled.reviewId, [
      { goalId: goalIds[0], score: 400 },
    ]);

    const edited = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.record-assessment-item',
        assessmentId,
        itemKind: 'goal',
        goalId: goalIds[0],
        score: 500,
      }),
    );

    expect(edited.ok).toBe(false);
    expect(reasonOf(edited)).toContain('assessment-already-submitted');

    const resubmitted = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.submit-assessment',
        assessmentId,
        expectedVersion: 2,
      }),
    );

    expect(resubmitted.ok).toBe(false);
  });

  it('refuses a reviewer who was never invited, and admits one who was', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);

    const uninvited = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.start-assessment',
        reviewId: enrolled.reviewId,
        assessmentKind: 'peer',
        assessorEmploymentId: OUTSIDER_EMPLOYMENT,
      }),
    );

    expect(uninvited.ok).toBe(false);
    expect(reasonOf(uninvited)).toBe(`forbidden:${PerformancePermissions.assessPeer}`);

    await harness.as(HR, () =>
      send(harness, {
        commandName: 'performance.assign-reviewer',
        reviewId: enrolled.reviewId,
        reviewerEmploymentId: PEER_EMPLOYMENT,
        role: 'peer',
      }),
    );

    const invited = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.start-assessment',
        reviewId: enrolled.reviewId,
        assessmentKind: 'peer',
        assessorEmploymentId: PEER_EMPLOYMENT,
      }),
    );

    expect(invited.ok).toBe(true);
  });

  it('refuses somebody claiming to be the manager who is not', async () => {
    const enrolled = await openCycleWith(harness, HR, configured.templateId);

    const impostor = await harness.as(MANAGER, () =>
      attempt(harness, {
        commandName: 'performance.start-assessment',
        reviewId: enrolled.reviewId,
        assessmentKind: 'manager',
        assessorEmploymentId: OUTSIDER_EMPLOYMENT,
      }),
    );

    // The employment identifier is supplied because nothing can derive it, so it is *checked*: a
    // supplied identifier buys nothing the reporting line did not already grant.
    expect(impostor.ok).toBe(false);
    expect(reasonOf(impostor)).toBe(`forbidden:${PerformancePermissions.assess}`);
  });
});
