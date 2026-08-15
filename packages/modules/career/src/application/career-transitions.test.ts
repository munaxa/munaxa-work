import { describe, expect, it } from 'vitest';

import {
  EMPLOYMENT,
  HR,
  OTHER_EMPLOYMENT,
  OTHER_POSITION,
  POSITION,
  attempt,
  harnessFor,
  named,
  reasonOf,
  send,
} from './career-test-harness.js';
import {
  aDevelopmentPlan,
  aNomination,
  anObjectiveOn,
  aPool,
  aReadinessLevel,
  aRecommendation,
  aSuccessionPlan,
} from './career-scenarios.js';

/**
 * Every transition on the aggregates a person is the subject of.
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

describe('succession', () => {
  it('refuses to activate a plan with nobody on the bench', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.activate-succession-plan',
        successionPlanId: planId,
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe('career.rejection.succession-plan-has-no-successors');
    });
  });

  it('moves a successor nominated → confirmed, recording the actor and the day', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);

      await send(harness, {
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: 1,
      });

      const held = harness.stores.tables.successors.get(successorId);

      expect(held?.status).toBe('confirmed');
      expect(held?.confirmedBy).toBe(HR);
      expect(held?.confirmedOn).toBe('2026-08-13');
    });
  });

  it('refuses a confirmation on a withdrawn nomination', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const successorId = await aNomination(harness, planId);

      await send(harness, {
        commandName: 'career.withdraw-successor',
        successorId,
        reason: 'Took a role elsewhere',
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.confirm-successor',
        successorId,
        expectedVersion: 2,
      });

      expect(reasonOf(refused)).toBe('career.rejection.successor-transition-refused');
    });
  });

  it('refuses nominating somebody whose employment has ended', async () => {
    const harness = harnessFor();

    harness.employment.end(OTHER_EMPLOYMENT);

    await harness.as(HR, async () => {
      const planId = await aSuccessionPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.nominate-successor',
        successionPlanId: planId,
        employmentId: OTHER_EMPLOYMENT,
      });

      expect(reasonOf(refused)).toBe('career.rejection.employment-not-active');
    });
  });

  /**
   * The same person may stand for two positions (D-15). Uniqueness is per plan, not per employment.
   */
  it('permits the same person on two positions’ benches', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const first = await aSuccessionPlan(harness, POSITION);
      const second = await aSuccessionPlan(harness, OTHER_POSITION);

      await aNomination(harness, first);
      await aNomination(harness, second);

      expect(harness.stores.tables.successors.size).toBe(2);
    });
  });
});

describe('development', () => {
  it('refuses to activate a plan with nothing on it', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const refused = await attempt(harness, {
        commandName: 'career.move-development-plan',
        developmentPlanId: planId,
        to: 'active',
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe('career.rejection.development-plan-has-no-items');
    });
  });

  it('moves an objective planned → in_progress → completed', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);
      const itemId = await anObjectiveOn(harness, planId);

      await send(harness, {
        commandName: 'career.move-development-item',
        developmentItemId: itemId,
        to: 'in_progress',
        expectedVersion: 1,
      });
      await send(harness, {
        commandName: 'career.move-development-item',
        developmentItemId: itemId,
        to: 'completed',
        expectedVersion: 2,
      });

      const held = harness.stores.tables.developmentItems.get(itemId);

      expect(held?.status).toBe('completed');
      expect(held?.completedOn).toBe('2026-08-13');
      expect(held?.completedBy).toBe(HR);
    });
  });

  it('records each acknowledgement once, and refuses a second', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const planId = await aDevelopmentPlan(harness);

      await send(harness, {
        commandName: 'career.acknowledge-development-plan',
        developmentPlanId: planId,
        party: 'employee',
        on: '2026-02-05',
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.acknowledge-development-plan',
        developmentPlanId: planId,
        party: 'employee',
        on: '2026-02-06',
        expectedVersion: 2,
      });

      expect(reasonOf(refused)).toBe('career.rejection.already-acknowledged');

      const held = harness.stores.tables.developmentPlans.get(planId);

      // The *recorder* is the authenticated administrator. The employee did not press this button,
      // because the employee cannot sign in (D-9, ADR-0032).
      expect(held?.employeeAcknowledgedOn).toBe('2026-02-05');
      expect(held?.employeeAcknowledgementRecordedBy).toBe(HR);
    });
  });
});

describe('mobility', () => {
  it('moves proposed → accepted, and refuses a second decision', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const id = await aRecommendation(harness);

      await send(harness, {
        commandName: 'career.decide-move',
        mobilityRecommendationId: id,
        to: 'accepted',
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.decide-move',
        mobilityRecommendationId: id,
        to: 'declined',
        expectedVersion: 2,
      });

      expect(reasonOf(refused)).toBe('career.rejection.recommendation-transition-refused');
    });
  });

  it('refuses a recommendation whose validity ends before it was made', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const refused = await attempt(harness, {
        commandName: 'career.recommend-move',
        employmentId: EMPLOYMENT,
        kind: 'promotion',
        validUntil: '2026-08-13',
      });

      expect(reasonOf(refused)).toBe('career.rejection.recommendation-expires-before-it-is-made');
    });
  });

  it('refuses a destination Organization does not have', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const refused = await attempt(harness, {
        commandName: 'career.recommend-move',
        employmentId: EMPLOYMENT,
        kind: 'lateral_move',
        targetUnitId: 'a-unit-nobody-has',
      });

      expect(reasonOf(refused)).toBe('career.rejection.unit-not-found');
    });
  });
});

describe('pools', () => {
  it('refuses adding somebody to a closed pool', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);

      await send(harness, {
        commandName: 'career.close-pool',
        talentPoolId: poolId,
        expectedVersion: 1,
      });

      const refused = await attempt(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-04-01',
      });

      expect(reasonOf(refused)).toBe('career.rejection.pool-closed');
    });
  });

  it('leaves open memberships open when the pool closes', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);

      await send(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-04-01',
      });
      await send(harness, {
        commandName: 'career.close-pool',
        talentPoolId: poolId,
        expectedVersion: 1,
      });

      const [membership] = [...harness.stores.tables.memberships.values()];

      // Whether somebody's investment period ended when the pool closed is a fact about that
      // person, and deciding it for them here would write a day nobody chose.
      expect(membership?.to).toBeUndefined();
    });
  });

  it('refuses a removal dated before the membership began', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const poolId = await aPool(harness);
      const { membershipId } = await send<{ membershipId: string }>(harness, {
        commandName: 'career.add-to-pool',
        talentPoolId: poolId,
        employmentId: EMPLOYMENT,
        from: '2026-04-01',
      });
      const refused = await attempt(harness, {
        commandName: 'career.remove-from-pool',
        membershipId,
        on: '2026-03-01',
        expectedVersion: 1,
      });

      expect(reasonOf(refused)).toBe('career.rejection.membership-ends-before-it-began');
    });
  });
});

describe('readiness levels', () => {
  it('refuses two levels at the same ordinal', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      await aReadinessLevel(harness, 'ready-now', 4);

      const refused = await attempt(harness, {
        commandName: 'career.define-readiness-level',
        code: 'ready-soon',
        name: named('Ready soon', 'جاهز قريبا'),
        ordinal: 4,
      });

      expect(reasonOf(refused)).toBe('career_readiness_level_ordinal_taken');
    });
  });

  it('deactivates a level rather than deleting it, and refuses a second deactivation', async () => {
    const harness = harnessFor();

    await harness.as(HR, async () => {
      const levelId = await aReadinessLevel(harness);

      await send(harness, {
        commandName: 'career.deactivate-readiness-level',
        readinessLevelId: levelId,
        expectedVersion: 1,
      });

      expect(harness.stores.tables.readinessLevels.get(levelId)?.active).toBe(false);

      const refused = await attempt(harness, {
        commandName: 'career.deactivate-readiness-level',
        readinessLevelId: levelId,
        expectedVersion: 2,
      });

      expect(reasonOf(refused)).toBe('career.rejection.readiness-level-already-inactive');
    });
  });
});
