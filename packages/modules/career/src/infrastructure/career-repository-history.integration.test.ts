import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Transaction } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openCareerFixture,
  refusalOf,
  requireDatabaseInCi,
  type CareerFixture,
} from './career-database.fixture.js';
import {
  ASSESSOR,
  EMPLOYMENT,
  aMembership,
  aNomination,
  aPool,
  aReadinessLevel,
  aRecommendation,
  aSuccessionPlan,
  anAssessment,
} from './career-states.js';

/**
 * Historical facts, through the repositories, and the exactness of what comes back.
 *
 * Two claims, and both need a real database.
 *
 * **A fact written stays exactly as written.** Not "equivalent" — identical. A civil date that went
 * in as `2026-03-01` comes back as the string `2026-03-01`, not as an instant that renders as that
 * day in the process's time zone and as the day before in somebody else's.
 *
 * **A correction is a new fact, and the old one survives it.** That is enforced by a trigger and by
 * the absence of an update method, and both are exercised here — including through raw SQL, because
 * a guarantee that only holds for code written in TypeScript is not a guarantee.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career repository history suite');

suite('career repository history', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_history_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('readiness assessments are append-only', () => {
    /**
     * Write a fact, write a later one, read the history: both are exactly as written.
     *
     * The earlier statement keeps its own level, its own rationale and its own day. A product that
     * reconstructed "current readiness" by overwriting would answer "what do we think now" and lose
     * "when did that change", which is the question a succession review actually asks.
     */
    it('keeps the statement a correction corrected, whole', async () => {
      const notReady = aReadinessLevel('not-ready', 1);
      const readyNow = aReadinessLevel('ready-now', 4);
      const first = anAssessment(notReady, {
        assessedOn: '2026-03-01',
        at: new Date('2026-03-01T10:00:00.000Z'),
        rationale: 'Needs a larger team first',
      });
      const correction = anAssessment(readyNow, {
        assessedOn: '2026-09-01',
        at: new Date('2026-09-01T10:00:00.000Z'),
        rationale: 'Ran the migration end to end',
      });

      const history = await inA(async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, notReady);
        await fixture.stores.readinessLevels.insert(transaction, readyNow);
        await fixture.stores.assessments.insert(transaction, first);
        await fixture.stores.assessments.insert(transaction, correction);
        return fixture.stores.assessments.historyFor(transaction, EMPLOYMENT);
      });

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(correction);
      expect(history[1]).toEqual(first);
    });

    /**
     * Two statements on the same civil day resolve to the one recorded later.
     *
     * The tie-break is `recorded_at`, and it is in the SQL rather than applied afterwards — ordering
     * by `assessed_on` alone would return either row, and the answer would change between runs.
     */
    it('sorts a same-day correction above the statement it corrected', async () => {
      const level = aReadinessLevel();
      const morning = anAssessment(level, {
        assessedOn: '2026-08-13',
        at: new Date('2026-08-13T09:00:00.000Z'),
        rationale: 'morning',
      });
      const afternoon = anAssessment(level, {
        assessedOn: '2026-08-13',
        at: new Date('2026-08-13T16:00:00.000Z'),
        rationale: 'afternoon',
      });

      const history = await inA(async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, level);
        await fixture.stores.assessments.insert(transaction, morning);
        await fixture.stores.assessments.insert(transaction, afternoon);
        return fixture.stores.assessments.historyFor(transaction, EMPLOYMENT);
      });

      expect(history.map((held) => held.rationale)).toEqual(['afternoon', 'morning']);
    });

    /**
     * The repository offers no way to rewrite one — asserted structurally, because the guarantee is
     * the *absence* of a method rather than a rule somebody has to remember.
     */
    it('offers no update, delete or restore method on the assessment store', () => {
      const store = fixture.stores.assessments as unknown as Record<string, unknown>;

      expect(Object.keys(store).sort()).toEqual([]);
      for (const forbidden of ['update', 'remove', 'delete', 'softDelete', 'restore']) {
        expect(typeof store[forbidden], forbidden).toBe('undefined');
      }
    });

    /**
     * And raw SQL cannot rewrite one either, as an unprivileged role.
     *
     * A repository with no update method is a rule about *this* code. The trigger is the rule about
     * every path — a repair script, a migration, a future handler, a psql session.
     */
    it('refuses a raw update and a raw delete', async () => {
      const level = aReadinessLevel();
      const assessment = anAssessment(level);

      await inA(async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, level);
        await fixture.stores.assessments.insert(transaction, assessment);
      });

      const attempt = async (sql: string): Promise<string> => {
        try {
          await fixture.asTenant(TENANT_A, (client) =>
            client.query(sql, [assessment.readinessAssessmentId]),
          );
        } catch (error: unknown) {
          return refusalOf(error);
        }
        throw new Error('The database accepted a mutation of an immutable row.');
      };

      expect(
        await attempt(
          `update career_readiness_assessment set rationale = 'rewritten' where id = $1`,
        ),
      ).toContain('career_readiness_assessment_immutable');
      expect(await attempt(`delete from career_readiness_assessment where id = $1`)).toContain(
        'career_readiness_assessment_immutable',
      );
      expect(
        await attempt(
          `update career_readiness_assessment set deleted_at = now(), deleted_by = 'x' where id = $1`,
        ),
      ).toContain('career_readiness_assessment_immutable');
    });

    /** The refusal must not be a table that rejects everything: a new assessment still lands. */
    it('still accepts a new assessment after refusing to rewrite one', async () => {
      const level = aReadinessLevel();

      const history = await inA(async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, level);
        await fixture.stores.assessments.insert(transaction, anAssessment(level));
        await fixture.stores.assessments.insert(
          transaction,
          anAssessment(level, { assessedOn: '2026-10-01' }),
        );
        return fixture.stores.assessments.historyFor(transaction, EMPLOYMENT);
      });

      expect(history).toHaveLength(2);
    });

    it('records the assessor from the state and never the connection', async () => {
      const level = aReadinessLevel();
      const stored = await fixture.asActor(TENANT_A, 'user:somebody-else', async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, level);
        await fixture.stores.assessments.insert(transaction, anAssessment(level));
        return fixture.stores.assessments.historyFor(transaction, EMPLOYMENT);
      });

      // `assessed_by` is the domain's, set from the authenticated actor when the command ran.
      // `updated_by` is the audit column, and the two are deliberately separate columns.
      expect(stored[0]?.assessedBy).toBe(ASSESSOR);
    });
  });

  describe('periods and decisions survive', () => {
    it('keeps a membership period after the removal that ended it', async () => {
      const pool = aPool();
      const membership = aMembership(pool);

      const after = await inA(async (transaction) => {
        await fixture.stores.pools.insert(transaction, pool);
        await fixture.stores.memberships.insertIfAbsent(transaction, membership);
        await fixture.stores.memberships.update(
          transaction,
          {
            ...membership,
            to: '2026-06-30',
            removedBy: 'user:test',
            removedReason: 'Completed the scheme',
          },
          1,
        );
        return fixture.stores.memberships.byId(transaction, membership.membershipId);
      });

      expect(after?.from).toBe('2026-01-05');
      expect(after?.to).toBe('2026-06-30');
      expect(after?.removedReason).toBe('Completed the scheme');
      expect(after?.addedReason).toBe('Graduate scheme intake');
    });

    it('keeps a withdrawn nomination on the bench with its reason', async () => {
      const plan = aSuccessionPlan();
      const nomination = aNomination(plan);

      const bench = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, nomination);
        await fixture.stores.successors.update(
          transaction,
          {
            ...nomination,
            status: 'withdrawn',
            withdrawnOn: '2026-09-01',
            withdrawnBy: 'user:test',
            withdrawalReason: 'Took a role elsewhere',
          },
          1,
        );
        return fixture.stores.successors.forPlan(transaction, plan.successionPlanId);
      });

      expect(bench).toHaveLength(1);
      expect(bench[0]?.status).toBe('withdrawn');
      expect(bench[0]?.withdrawalReason).toBe('Took a role elsewhere');
      expect(bench[0]?.nominatedOn).toBe(nomination.nominatedOn);
    });

    it('keeps a declined recommendation and its decision', async () => {
      const recommendation = aRecommendation();

      const after = await inA(async (transaction) => {
        await fixture.stores.mobility.insert(transaction, recommendation);
        await fixture.stores.mobility.update(
          transaction,
          {
            ...recommendation,
            status: 'declined',
            decidedOn: '2026-07-01',
            decidedBy: 'user:test',
            decisionNote: 'Not the right moment',
          },
          1,
        );
        return fixture.stores.mobility.byId(transaction, recommendation.mobilityRecommendationId);
      });

      expect(after?.status).toBe('declined');
      expect(after?.recommendedOn).toBe('2026-06-01');
      expect(after?.decisionNote).toBe('Not the right moment');
    });
  });
});
