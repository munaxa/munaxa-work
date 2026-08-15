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
  aCourseItem,
  aDevelopmentPlan,
  aNomination,
  aPlan,
  aReadinessLevel,
  aSuccessionPlan,
  anObjective,
} from './career-states.js';

/**
 * Exactness: what a value is when it comes back out.
 *
 * **A fact written stays exactly as written.** Not "equivalent" — identical. A civil date that went
 * in as `2026-03-01` comes back as the string `2026-03-01`, not as an instant that renders as that
 * day in the process's time zone and as the day before in somebody else's. A 17-digit reference
 * comes back with all seventeen digits, because nothing on the path parsed it.
 *
 * Split from the append-only suite at the seam between "is the history preserved" and "is the value
 * exact".
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career repository exactness suite');

suite('career repository exactness', () => {
  let fixture: CareerFixture;

  beforeAll(async () => {
    fixture = await openCareerFixture('career_exactness_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);
  describe('civil dates are exact strings in both directions', () => {
    /**
     * Ordinary, boundary and leap-day values, round-tripped through the repository.
     *
     * A `date` column read as a JavaScript `Date` would come back at the process's local midnight,
     * so a server west of UTC would report the previous day — which is how "their target date moved"
     * bugs are born. The `to_char` alias means what leaves the database is what was stored.
     */
    it('round-trips ordinary, boundary and leap-day values unchanged', async () => {
      const days = ['2026-01-01', '2026-12-31', '2024-02-29', '2026-02-28', '2026-03-01'];

      for (const day of days) {
        const plan = await inA(async (transaction) => {
          const state = aPlan({ startedOn: day, targetDate: '2027-06-30' });

          await fixture.stores.plans.insertIfAbsent(transaction, state);
          return fixture.stores.plans.byId(transaction, state.careerPlanId);
        });

        expect(plan?.startedOn, day).toBe(day);
        expect(typeof plan?.startedOn, day).toBe('string');
        await fixture.truncate();
      }
    });

    /**
     * PostgreSQL refuses a day that does not exist, and the repository surfaces the refusal rather
     * than normalizing it.
     *
     * This is the boundary that closes the defect Checkpoint 2 found: `Date.parse('2026-02-30')`
     * rolls into March and returns a valid instant, so a string naming no day would otherwise be
     * accepted. Nothing on this path parses a date in JavaScript, so the database is the arbiter.
     */
    it('refuses an impossible day rather than rolling it into the next month', async () => {
      for (const impossible of ['2026-02-30', '2026-04-31', '2025-02-29']) {
        const refused = await inA(async (transaction) => {
          const state = { ...aPlan(), startedOn: impossible };

          try {
            await fixture.stores.plans.insertIfAbsent(transaction, state);
          } catch (error: unknown) {
            return refusalOf(error);
          }
          return 'accepted';
        }).catch((error: unknown) => refusalOf(error));

        expect(refused, impossible).toMatch(
          /date\/time field value out of range|invalid input syntax/i,
        );
      }
    });

    /** A null civil date stays absent rather than becoming an epoch or an empty string. */
    it('keeps an absent date absent', async () => {
      const plan = aDevelopmentPlan();
      const read = await inA(async (transaction) => {
        await fixture.stores.developmentPlans.insert(transaction, plan);
        return fixture.stores.developmentPlans.byId(transaction, plan.developmentPlanId);
      });

      expect(read).toEqual(plan);
      expect(Object.keys(read ?? {})).not.toContain('targetDate');
      expect(Object.keys(read ?? {})).not.toContain('closedOn');
    });
  });

  describe('exact numbers', () => {
    /**
     * Every numeric column in this module is `smallint` or `integer`, and the schema says so.
     *
     * Asserted against `information_schema` rather than assumed: a column that became `numeric` or
     * `double precision` in a later migration would keep every test above passing and quietly
     * introduce a value JavaScript cannot hold exactly.
     */
    it('uses only integral column types, with no floating point anywhere', async () => {
      const columns = await fixture.admin.query<{
        table_name: string;
        column_name: string;
        data_type: string;
      }>(
        `select table_name, column_name, data_type from information_schema.columns
          where table_schema = 'public' and table_name like 'career\\_%'
            and data_type in ('numeric', 'double precision', 'real', 'money', 'bigint')`,
      );

      expect(columns.rows).toEqual([]);
    });

    it('stores a stage sequence, a rank and an ordinal as the integers they are', async () => {
      const level = aReadinessLevel('ready-now', 4);
      const plan = aSuccessionPlan();
      const nomination = aNomination(plan, { rank: 3, readinessLevelId: level.readinessLevelId });

      const read = await inA(async (transaction) => {
        await fixture.stores.readinessLevels.insert(transaction, level);
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, nomination);
        return {
          rank: (await fixture.stores.successors.byId(transaction, nomination.successorId))?.rank,
          ordinal: (await fixture.stores.readinessLevels.byId(transaction, level.readinessLevelId))
            ?.ordinal,
        };
      });

      expect(read.rank).toBe(3);
      expect(read.ordinal).toBe(4);
      expect(Number.isInteger(read.rank)).toBe(true);
    });

    /**
     * The repository guarantee, at a value JavaScript cannot hold.
     *
     * **This is not a reachable application state** and is labelled as such: the domain bounds a rank
     * to 1–50 and a `smallint` column would refuse this outright, so nothing in the product can
     * produce it. What it tests is that the *repository* never launders an exact value through a
     * JavaScript `number` — the free-text `withdrawal_reason` carries the digits verbatim, and comes
     * back with every one of them, because nothing on the path parses it.
     */
    it('returns a 17-digit value byte-for-byte in a free-text column', async () => {
      const exact = '9007199254740993';
      const plan = aSuccessionPlan();
      const nomination = aNomination(plan);

      const read = await inA(async (transaction) => {
        await fixture.stores.successionPlans.insertIfAbsent(transaction, plan);
        await fixture.stores.successors.insertIfAbsent(transaction, nomination);
        await fixture.stores.successors.update(
          transaction,
          {
            ...nomination,
            status: 'withdrawn',
            withdrawnOn: '2026-09-01',
            withdrawnBy: 'user:test',
            withdrawalReason: `Reference ${exact}`,
          },
          1,
        );
        return fixture.stores.successors.byId(transaction, nomination.successorId);
      });

      expect(read?.withdrawalReason).toBe(`Reference ${exact}`);
      // The value survives because nothing converted it. `Number('9007199254740993')` is
      // 9007199254740992, and a mapper that touched it would return a different number.
      expect(read?.withdrawalReason).toContain(exact);
      expect(String(Number(exact))).not.toBe(exact);
    });
  });

  describe('development items keep Learning at arm’s length', () => {
    it('stores a course item as an identifier with no status Career invented', async () => {
      const plan = aDevelopmentPlan();
      const item = aCourseItem(plan);

      const read = await inA(async (transaction) => {
        await fixture.stores.developmentPlans.insert(transaction, plan);
        await fixture.stores.developmentItems.insert(transaction, item);
        return fixture.stores.developmentItems.byId(transaction, item.developmentItemId);
      });

      expect(read).toEqual(item);
      expect(read?.status).toBe('planned');
      expect(Object.keys(read ?? {})).not.toContain('completedOn');
    });

    it('groups a plan’s items by category without judging the mix', async () => {
      const plan = aDevelopmentPlan();
      const items = [
        anObjective(plan, { category: 'experience' }),
        anObjective(plan, { category: 'experience' }),
        anObjective(plan, { category: 'exposure' }),
      ];

      const read = await inA(async (transaction) => {
        await fixture.stores.developmentPlans.insert(transaction, plan);
        for (const item of items) await fixture.stores.developmentItems.insert(transaction, item);
        return fixture.stores.developmentItems.forPlan(transaction, plan.developmentPlanId);
      });

      expect(read).toHaveLength(3);
      expect(read.filter((item) => item.category === 'experience')).toHaveLength(2);
    });
  });
});
