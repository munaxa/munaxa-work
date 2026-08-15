import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  OTHER_EMPLOYMENT,
  TENANT_A,
  openCareerFixture,
  refusalOf,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  insertAssessment,
  insertDevelopmentItem,
  insertMembership,
  insertMobility,
  insertPlan,
  insertPool,
  insertReadinessLevel,
  insertSuccessionPlan,
  insertSuccessor,
} from './career-fixtures.js';

/**
 * What the schema itself refuses.
 *
 * Every assertion below issues the statement directly, as an unprivileged role, and reads the
 * constraint name PostgreSQL raised. A probe that only asserted "it threw" would pass for a typo in
 * the SQL as readily as for the rule it meant to provoke.
 *
 * These are the database's half of invariants the domain also holds. The domain refusing a state and
 * the database accepting it is not belt-and-braces — it is one guarantee with a hole in it, because
 * a repair script, a migration or a future handler reaches the table without passing through the
 * domain at all.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career schema suite');

suite('career schema', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_schema_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const refusal = async (
    work: (client: Parameters<Parameters<CareerFixture['asTenant']>[1]>[0]) => Promise<unknown>,
  ): Promise<string> => {
    try {
      await fixture.asTenant(TENANT_A, work);
    } catch (error: unknown) {
      return refusalOf(error);
    }
    throw new Error('The database accepted a row it should have refused.');
  };

  describe('civil dates', () => {
    /**
     * The boundary that closes the defect Checkpoint 2 found in the repository's shared
     * `isCivilDate` helper: `Date.parse('2026-02-30')` rolls the day into March and returns a valid
     * instant, so a string that names no day was accepted as one. PostgreSQL's `date` has no such
     * behaviour, and this is the assertion that says so rather than assuming it.
     */
    it('refuses days that do not exist', async () => {
      for (const impossible of ['2026-02-30', '2026-04-31', '2025-02-29', '2026-13-01']) {
        expect(
          await refusal((client) => insertPlan(client, TENANT_A, { startedOn: impossible })),
          impossible,
        ).toMatch(/date\/time field value out of range|invalid input syntax/i);
      }
    });

    it('accepts a genuine leap day', async () => {
      await expect(
        fixture.asTenant(TENANT_A, (client) =>
          insertPlan(client, TENANT_A, { startedOn: '2024-02-29' }),
        ),
      ).resolves.toBeTypeOf('string');
    });

    /**
     * A civil date comes back the day it went in.
     *
     * A column typed `timestamptz` would return the day before or after for half the world, which is
     * how "their target date moved" bugs are born. The assertion reads the stored value as text so
     * no client-side `Date` can launder a shift into agreement.
     */
    it('returns a civil date as the same day it was given', async () => {
      const stored = await fixture.asTenant(TENANT_A, async (client) => {
        await insertPlan(client, TENANT_A, { startedOn: '2026-03-01', targetDate: '2027-01-31' });
        return client.query<{ started: string; target: string }>(
          `select started_on::text as started, target_date::text as target from career_plan`,
        );
      });

      expect(stored.rows[0]).toEqual({ started: '2026-03-01', target: '2027-01-31' });
    });

    it('refuses a target date before the day the plan started', async () => {
      expect(
        await refusal((client) =>
          insertPlan(client, TENANT_A, { startedOn: '2026-03-01', targetDate: '2026-02-01' }),
        ),
      ).toContain('career_plan_target_check');
    });
  });

  describe('closed vocabularies', () => {
    /**
     * The row is valid in every other respect. An unknown status is not `draft` or `active`, so it
     * also trips the closure check — and a probe that left the closure columns empty would pass
     * while proving that constraint instead of this one. Constraint evaluation order is not
     * something PostgreSQL promises, so the row has to be unimpeachable apart from the one field.
     */
    it('refuses a status no lifecycle names', async () => {
      expect(
        await refusal((client) =>
          insertPlan(client, TENANT_A, {
            status: 'paused',
            closedOn: '2026-05-01',
            closedBy: 'user:test',
          }),
        ),
      ).toContain('career_plan_status_check');
    });

    /**
     * `expired` is derived from `valid_until` and the day somebody asked, never stored (D-13).
     * Nothing moves a stored flag overnight — `JobPort` has no adapter — so a written `expired` would
     * be a state that could only ever be wrong. The constraint refuses it as a column value.
     */
    it('refuses `expired` as a stored mobility status', async () => {
      expect(
        await refusal((client) =>
          insertMobility(client, TENANT_A, {
            status: 'expired',
            decidedOn: '2026-06-20',
            decidedBy: 'user:head-of-hr',
          }),
        ),
      ).toContain('career_mobility_recommendation_status_check');
    });

    it('refuses a development category outside the three', async () => {
      expect(
        await refusal((client) =>
          insertDevelopmentItem(client, TENANT_A, crypto.randomUUID(), { category: 'exercise' }),
        ),
      ).toMatch(/career_development_item_(category_check|plan_fk)/);
    });
  });

  describe('an act that commits an organization names a person', () => {
    /**
     * `system:auto-approval` is `AutoApprovingPort`'s actor, and its own comment says it pretends
     * nothing. Recording it against a nomination or a readiness assessment would be a fabricated
     * human decision on the most consequential rows in this module (ADR-0072, rule 12).
     */
    it('refuses the auto-approval actor as a nominator', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertSuccessionPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertSuccessor(client, TENANT_A, planId, { nominatedBy: 'system:auto-approval' }),
        ),
      ).toContain('career_successor_nominator_check');
    });

    it('refuses the auto-approval actor as a confirmer', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertSuccessionPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertSuccessor(client, TENANT_A, planId, {
            status: 'confirmed',
            confirmedOn: '2026-04-05',
            confirmedBy: 'system:auto-approval',
          }),
        ),
      ).toContain('career_successor_confirmer_check');
    });

    it('refuses the auto-approval actor as an assessor', async () => {
      const levelId = await fixture.asTenant(TENANT_A, (client) =>
        insertReadinessLevel(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertAssessment(client, TENANT_A, levelId, {
            employmentId: OTHER_EMPLOYMENT,
            assessedBy: 'system:auto-approval',
          }),
        ),
      ).toContain('career_readiness_assessment_assessor_check');
    });

    it('refuses the auto-approval actor as a recommender', async () => {
      expect(
        await refusal((client) =>
          insertMobility(client, TENANT_A, { recommendedBy: 'system:auto-approval' }),
        ),
      ).toContain('career_mobility_recommendation_recommender_check');
    });
  });

  describe('a state that names its author and its day, or is not that state', () => {
    it('refuses a confirmed successor with no confirmation day or author', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertSuccessionPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertSuccessor(client, TENANT_A, planId, { status: 'confirmed' }),
        ),
      ).toContain('career_successor_confirmation_check');
    });

    it('refuses a withdrawal with no reason', async () => {
      const planId = await fixture.asTenant(TENANT_A, (client) =>
        insertSuccessionPlan(client, TENANT_A),
      );

      expect(
        await refusal((client) =>
          insertSuccessor(client, TENANT_A, planId, {
            status: 'withdrawn',
            withdrawnOn: '2026-05-01',
            withdrawnBy: 'user:head-of-hr',
          }),
        ),
      ).toContain('career_successor_withdrawal_check');
    });

    it('refuses a closed plan with no closing day or author', async () => {
      expect(
        await refusal((client) => insertPlan(client, TENANT_A, { status: 'achieved' })),
      ).toContain('career_plan_closure_check');
    });

    it('refuses an ended membership with nobody who ended it', async () => {
      const poolId = await fixture.asTenant(TENANT_A, (client) => insertPool(client, TENANT_A));

      expect(
        await refusal((client) =>
          insertMembership(client, TENANT_A, poolId, { toDate: '2026-06-30' }),
        ),
      ).toContain('career_pool_membership_removal_check');
    });

    it('refuses a decided recommendation with no decision day or decider', async () => {
      expect(
        await refusal((client) => insertMobility(client, TENANT_A, { status: 'accepted' })),
      ).toContain('career_mobility_recommendation_decision_check');
    });
  });
});
