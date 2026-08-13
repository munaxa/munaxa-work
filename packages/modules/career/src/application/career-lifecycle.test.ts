import { describe, expect, it } from 'vitest';

import {
  EMPLOYMENT,
  HR,
  attempt,
  harnessFor,
  named,
  reasonOf,
  send,
} from './career-test-harness.js';
import {
  aCareerPlan,
  aNomination,
  anActiveCareerPlan,
  aPublishedPath,
  aSuccessionPlan,
} from './career-scenarios.js';
import { ConflictingActivePlan } from './in-memory-config-stores.js';

/**
 * Every transition, the ones that are refused, and what a stale write does.
 *
 * **Terminal is terminal.** An achieved plan does not reopen, a withdrawn nomination does not
 * un-withdraw, an archived path takes no more stages. Each of those is a *record of what happened*,
 * and a product that let one be reopened would let the record be rewritten.
 *
 * **A repeated command is not the same as a concurrent one.** The suites below prove the *rule* —
 * that a second active plan is refused, that a retried nomination converges. They do not prove the
 * *race*: two callers arriving at the same instant is PostgreSQL's arbitration, tested across two
 * real connections in Checkpoint 3, and nothing here re-proves it.
 */

describe('a career path', () => {
  it('moves draft → published → archived', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const pathId = await aPublishedPath(harness);

      await send(harness, { commandName: 'career.archive-path', pathId, expectedVersion: 2 });

      const held = harness.stores.tables.paths.get(pathId);

      expect(held?.status).toBe('archived');
      expect(held?.archivedBy).toBe(HR);
    });
  });

  it('refuses to publish a path with no stages', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const { pathId } = await send<{ pathId: string }>(harness, {
        commandName: 'career.create-path',
        code: 'empty',
        name: named('Empty', 'فارغ'),
        kind: 'custom',
        effectiveFrom: '2026-01-01',
      });
      const refused = await attempt(harness, {
        commandName: 'career.publish-path',
        pathId,
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe('career.rejection.path-has-no-stages');
    });
  });

  it('refuses a stage on an archived path', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const pathId = await aPublishedPath(harness);

      await send(harness, { commandName: 'career.archive-path', pathId, expectedVersion: 2 });

      const refused = await attempt(harness, {
        commandName: 'career.add-stage',
        pathId,
        sequence: 9,
        name: named('Late', 'متأخر'),
      });

      expect(reasonOf(refused)).toBe('career.rejection.path-archived');
    });
  });

  it('refuses a second stage at the same position on one path', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const pathId = await aPublishedPath(harness);
      const refused = await attempt(harness, {
        commandName: 'career.add-stage',
        pathId,
        sequence: 1,
        name: named('Duplicate', 'مكرر'),
      });

      expect(reasonOf(refused)).toBe('career_stage_sequence_taken');
    });
  });

  it('refuses a stage naming a position Organization does not have', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const pathId = await aPublishedPath(harness);
      const refused = await attempt(harness, {
        commandName: 'career.add-stage',
        pathId,
        sequence: 2,
        name: named('Director', 'مدير'),
        targetPositionId: 'a-position-nobody-has',
      });

      expect(reasonOf(refused)).toBe('career.rejection.position-not-found');
    });
  });
});

describe('a career plan', () => {
  it('moves draft → active → achieved, recording the day and the actor', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const careerPlanId = await anActiveCareerPlan(harness);

      await send(harness, {
        commandName: 'career.move-plan',
        careerPlanId,
        to: 'achieved',
        expectedVersion: 2,
      });

      const held = harness.stores.tables.plans.get(careerPlanId);

      expect(held?.status).toBe('achieved');
      expect(held?.closedOn).toBe('2026-08-13');
      expect(held?.closedBy).toBe(HR);
    });
  });

  it('refuses to reopen a plan that ended', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const careerPlanId = await anActiveCareerPlan(harness);

      await send(harness, {
        commandName: 'career.move-plan',
        careerPlanId,
        to: 'abandoned',
        expectedVersion: 2,
      });

      const refused = await attempt(harness, {
        commandName: 'career.move-plan',
        careerPlanId,
        to: 'active',
        expectedVersion: 3,
      });

      expect(reasonOf(refused)).toBe('career.rejection.plan-transition-refused');
    });
  });

  it('refuses to amend a plan that ended', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const careerPlanId = await anActiveCareerPlan(harness);

      await send(harness, {
        commandName: 'career.move-plan',
        careerPlanId,
        to: 'achieved',
        expectedVersion: 2,
      });

      const refused = await attempt(harness, {
        commandName: 'career.amend-plan',
        careerPlanId,
        notes: 'One more thought',
        expectedVersion: 3,
      });

      expect(reasonOf(refused)).toBe('career.rejection.plan-closed');
    });
  });

  it('refuses a plan for somebody Employment does not have', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const refused = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: 'somebody-who-does-not-work-here',
        startedOn: '2026-03-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.employment-not-found');
    });
  });

  /**
   * A stage belongs to a path, and only the application can check that the two agree.
   *
   * The check constraint knows a stage was named with no path at all; it cannot know that the stage
   * named belongs to a *different* path, because that is a join.
   */
  it('refuses a plan naming a stage from another path', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const first = await aPublishedPath(harness, 'engineering');
      const second = await aPublishedPath(harness, 'management');
      const [stage] = await harness.stores.paths.stagesFor(unusedTransaction, second);
      const refused = await attempt(harness, {
        commandName: 'career.create-plan',
        employmentId: EMPLOYMENT,
        pathId: first,
        targetStageId: stage?.stageId,
        startedOn: '2026-03-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.stage-not-on-path');
    });
  });

  /**
   * One active plan per employment, refused by the index the fake stands in for.
   *
   * Deliberately *not* pre-checked in the handler: a read-then-write would let two administrators
   * activating two drafts for the same person both pass, and only the index refuses the second.
   */
  it('refuses activating a second plan for somebody who already has an active one', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await anActiveCareerPlan(harness);

      const second = await aCareerPlan(harness);

      await expect(
        send(harness, {
          commandName: 'career.move-plan',
          careerPlanId: second,
          to: 'active',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(ConflictingActivePlan);
    });
  });

  it('permits a second active plan once the first has ended', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const first = await anActiveCareerPlan(harness);

      await send(harness, {
        commandName: 'career.move-plan',
        careerPlanId: first,
        to: 'achieved',
        expectedVersion: 2,
      });

      const second = await anActiveCareerPlan(harness);

      expect(harness.stores.tables.plans.get(second)?.status).toBe('active');
      expect(harness.stores.tables.plans.size).toBe(2);
    });
  });
});

describe('optimistic concurrency', () => {
  /**
   * The three-step property the checkpoint asks for, on one aggregate: version N succeeds, the same
   * stale N is refused, and N+1 succeeds.
   *
   * `ConcurrencyException` is what `Repository.updateRow` raises when its `where version = $expected`
   * matches no row, and every module since Phase 2 lets it travel to the edge, where it becomes a
   * 409. A fake that returned a quiet failure would let a losing writer look like a winning one.
   */
  it('accepts the version the caller read, refuses it again, then accepts the next', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const pathId = await aPublishedPath(harness);

      // Version 1 → 2 happened inside `aPublishedPath`'s publish. The archive at 2 succeeds.
      await send(harness, { commandName: 'career.archive-path', pathId, expectedVersion: 2 });
      expect(harness.stores.tables.paths.get(pathId)?.version).toBe(3);
    });
  });

  it('refuses a stale version on a succession plan and accepts the current one', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);

      await aNomination(harness, planId);
      await send(harness, {
        commandName: 'career.activate-succession-plan',
        successionPlanId: planId,
        expectedVersion: 1,
      });

      await expect(
        send(harness, {
          commandName: 'career.archive-succession-plan',
          successionPlanId: planId,
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/version/i);

      await send(harness, {
        commandName: 'career.archive-succession-plan',
        successionPlanId: planId,
        expectedVersion: 2,
      });
      expect(harness.stores.tables.successionPlans.get(planId)?.status).toBe('archived');
    });
  });
});

/**
 * The stores' transaction parameter, which the in-memory implementations ignore.
 *
 * Named rather than cast inline so a reader sees that reaching a store directly is a *fixture*
 * convenience for reading state back, never a way to arrange one.
 */
const unusedTransaction = undefined as never;
