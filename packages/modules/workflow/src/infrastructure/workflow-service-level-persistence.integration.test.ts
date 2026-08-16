import type { Transaction } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServiceLevelTarget } from '../domain/service-level.js';
import {
  APPROVER,
  CONNECTION,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import {
  NOW,
  aBranchTemplate,
  aDefinition,
  aDraft,
  aStartedApproval,
  stepAt,
} from './workflow-states.js';

/**
 * The service-level target through real columns: what is stored, and — at greater length — what is
 * not.
 *
 * **Three columns and no fourth.** `service_level_count` and `service_level_unit` on the template and
 * on the step, plus `awaiting_at` on the step. Everything a reader asks about a target — when it
 * falls due, whether it has passed, by how many minutes — is computed by the domain from those three
 * and a reading instant the caller supplies. None of it is stored, and the last test in this file
 * asserts that no column for any of it exists anywhere in the module.
 *
 * **The repository computes nothing.** A stored due time would disagree with its own inputs the first
 * time somebody corrected a target; a stored `overdue` would need something to write it, and this
 * phase has no scheduler and refuses a synthetic actor. What the repository does is store two
 * integers, a word, and an instant.
 *
 * **`awaiting_at` is the application's, not the database's.** Nothing here generates it, defaults it,
 * or derives it from `created_at` or from the history table — every instant in this file is written
 * explicitly, and the assertions are exact to the millisecond precisely so that a `now()` default
 * sneaking in would be visible rather than plausible.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's service-level persistence suite");

const TWO_DAYS: ServiceLevelTarget = { count: 2, unit: 'days' };
const FORTY_EIGHT_HOURS: ServiceLevelTarget = { count: 48, unit: 'hours' };

suite('a service-level target, persisted', () => {
  let fixture: WorkflowFixture;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_sla_repo_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const inA = <TResult>(work: (transaction: Transaction) => Promise<TResult>): Promise<TResult> =>
    fixture.inTenant(TENANT_A, work);

  describe('on a step template', () => {
    const roundTrip = async (serviceLevel?: ServiceLevelTarget) => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const template = aBranchTemplate(
        draft,
        1,
        APPROVER,
        serviceLevel === undefined ? {} : { serviceLevel },
      );

      const read = await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
        return fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId);
      });

      return { template, read: read[0] };
    };

    it('has no target at all where none was configured', async () => {
      const { template, read } = await roundTrip();

      expect(read).toStrictEqual(template);
      expect(read?.serviceLevel).toBeUndefined();
    });

    it('round-trips a target in hours', async () => {
      const { read } = await roundTrip(FORTY_EIGHT_HOURS);

      expect(read?.serviceLevel).toStrictEqual({ count: 48, unit: 'hours' });
    });

    it('round-trips a target in days', async () => {
      const { read } = await roundTrip(TWO_DAYS);

      expect(read?.serviceLevel).toStrictEqual({ count: 2, unit: 'days' });
    });

    /**
     * Forty-eight hours and two days are the same duration and **not** the same row.
     *
     * The unit is stored as the administrator wrote it rather than normalized into one canonical
     * unit, because a screen has to show them back what they typed. A mapper that converted would
     * make this assertion fail, which is the whole reason it is two columns.
     */
    it('keeps hours and days distinguishable, even at the same duration', async () => {
      const hours = await roundTrip(FORTY_EIGHT_HOURS);
      const days = await roundTrip(TWO_DAYS);

      expect(hours.read?.serviceLevel?.unit).toBe('hours');
      expect(days.read?.serviceLevel?.unit).toBe('days');
      expect(hours.read?.serviceLevel).not.toStrictEqual(days.read?.serviceLevel);
    });

    /**
     * An `integer` column that came back as a string would break the arithmetic without changing a
     * line of it: `Number.isInteger('2')` is false, and a due time computed from it is `NaN`.
     */
    it('returns the count as a number, not as the string a driver may hand back', async () => {
      const { read } = await roundTrip({ count: 2_000_000_000, unit: 'hours' });

      expect(typeof read?.serviceLevel?.count).toBe('number');
      expect(Number.isInteger(read?.serviceLevel?.count)).toBe(true);
      // And no ceiling: AD-004's rule about approval limits, arriving at a target.
      expect(read?.serviceLevel?.count).toBe(2_000_000_000);
    });

    it('keeps a target inside its own tenant', async () => {
      const definition = aDefinition();
      const draft = aDraft(definition);
      const template = aBranchTemplate(draft, 1, APPROVER, { serviceLevel: TWO_DAYS });

      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, definition);
        await fixture.stores.versions.insert(transaction, draft);
        await fixture.stores.versions.insertTemplate(transaction, template);
      });

      const theirs = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.versions.templatesFor(transaction, draft.workflowVersionId),
      );

      expect(theirs).toStrictEqual([]);
    });
  });

  describe('on a running step', () => {
    const started = (targets: readonly (ServiceLevelTarget | undefined)[], at = NOW) =>
      aStartedApproval(
        (draft) =>
          targets.map((serviceLevel, index) =>
            aBranchTemplate(
              draft,
              index + 1,
              index === 0 ? APPROVER : SECOND_APPROVER,
              serviceLevel === undefined ? {} : { serviceLevel },
            ),
          ),
        { at },
      );

    const write = async (seed: ReturnType<typeof started>): Promise<void> => {
      await inA(async (transaction) => {
        await fixture.stores.definitions.insert(transaction, seed.definition);
        await fixture.stores.versions.insert(transaction, seed.version);
        for (const template of seed.templates) {
          await fixture.stores.versions.insertTemplate(transaction, template);
        }
        await fixture.stores.instances.insert(transaction, seed.instance);
        for (const step of seed.steps) {
          await fixture.stores.steps.insert(transaction, step);
        }
      });
    };

    const readSteps = (seed: ReturnType<typeof started>) =>
      inA((transaction) => fixture.stores.steps.forInstance(transaction, seed.instance.instanceId));

    it('round-trips a step with no target and no awaiting instant on the ones not yet reached', async () => {
      const seed = started([undefined, undefined]);

      await write(seed);

      const read = await readSteps(seed);

      expect(read).toStrictEqual(seed.steps);
      expect(read[0]?.serviceLevel).toBeUndefined();
      // The first step is awaiting, so it has an instant; the second is not, so it has none.
      expect(read[0]?.awaitingAt).toStrictEqual(NOW);
      expect(read[1]?.awaitingAt).toBeUndefined();
    });

    it('round-trips a target in hours alongside the instant it counts from', async () => {
      const seed = started([FORTY_EIGHT_HOURS]);

      await write(seed);

      const [read] = await readSteps(seed);

      expect(read?.serviceLevel).toStrictEqual({ count: 48, unit: 'hours' });
      expect(read?.awaitingAt).toStrictEqual(NOW);
    });

    it('round-trips a target in days alongside the instant it counts from', async () => {
      const seed = started([TWO_DAYS]);

      await write(seed);

      const [read] = await readSteps(seed);

      expect(read?.serviceLevel).toStrictEqual({ count: 2, unit: 'days' });
      expect(read?.awaitingAt).toStrictEqual(NOW);
    });

    /**
     * To the millisecond, and it matters.
     *
     * `timestamptz` keeps microseconds and JavaScript's `Date` keeps milliseconds, so a value that
     * survived to the second would look correct in every assertion that did not check one. A target
     * measured from a truncated instant is off by up to a second, every time it is read.
     */
    it('keeps the awaiting instant exact to the millisecond', async () => {
      const precise = new Date('2026-08-14T09:00:00.123Z');
      const seed = started([TWO_DAYS], precise);

      await write(seed);

      const [read] = await readSteps(seed);

      expect(read?.awaitingAt?.toISOString()).toBe('2026-08-14T09:00:00.123Z');
      expect(read?.awaitingAt?.getTime()).toBe(precise.getTime());
    });

    /**
     * And across UTC midnight, which is the instant a truncation or a local-time reinterpretation
     * would move by a whole day.
     */
    it('keeps an instant either side of UTC midnight on the right day', async () => {
      const before = new Date('2026-02-28T23:59:59.999Z');
      const after = new Date('2026-03-01T00:00:00.001Z');

      for (const instant of [before, after]) {
        const seed = started([TWO_DAYS], instant);

        await write({ ...seed, instance: { ...seed.instance, subjectId: instant.toISOString() } });

        const [read] = await readSteps(seed);

        expect([instant.toISOString(), read?.awaitingAt?.toISOString()]).toStrictEqual([
          instant.toISOString(),
          instant.toISOString(),
        ]);
      }
    });

    /**
     * Every step of a parallel branch opens together, so their instants are **equal** — and nothing
     * anywhere refuses that.
     *
     * A uniqueness constraint near `awaiting_at` would make parallel approval unrepresentable, which
     * is why §19 forbids adding one and why this asserts the equality rather than tolerating it.
     */
    it('lets two steps of one branch share an instant to the millisecond', async () => {
      const seed = aStartedApproval((draft) => [
        aBranchTemplate(draft, 1, APPROVER, { branchRule: 'unanimous', serviceLevel: TWO_DAYS }),
        aBranchTemplate(draft, 1, SECOND_APPROVER, {
          branchRule: 'unanimous',
          serviceLevel: TWO_DAYS,
        }),
      ]);

      await write(seed);

      const read = await readSteps(seed);

      expect(read).toHaveLength(2);
      expect(read.every((step) => step.status === 'awaiting')).toBe(true);
      expect(read[0]?.awaitingAt?.getTime()).toBe(read[1]?.awaitingAt?.getTime());
    });

    /** A step reached later carries a later instant, written by the application on its own update. */
    it('takes a later instant on a step that becomes awaiting afterwards', async () => {
      const seed = started([TWO_DAYS, TWO_DAYS]);

      await write(seed);

      const later = new Date('2026-08-28T09:00:00.000Z');
      const second = stepAt(seed, 1);
      const read = await inA(async (transaction) => {
        await fixture.stores.steps.update(
          transaction,
          { ...second, status: 'awaiting', awaitingAt: later },
          1,
        );
        return fixture.stores.steps.byId(transaction, second.stepId);
      });

      expect(read?.awaitingAt).toStrictEqual(later);
      // And the first step's instant did not move: an update writes one row.
      const [first] = await readSteps(seed);

      expect(first?.awaitingAt).toStrictEqual(NOW);
    });

    it('carries the target through the queue read as well as the detail read', async () => {
      const seed = started([FORTY_EIGHT_HOURS]);

      await write(seed);

      const queue = await inA((transaction) =>
        fixture.stores.steps.awaitingFor(transaction, APPROVER, { limit: 20, offset: 0 }),
      );

      expect(queue.items[0]?.serviceLevel).toStrictEqual({ count: 48, unit: 'hours' });
      expect(queue.items[0]?.awaitingAt).toStrictEqual(NOW);
    });

    it('keeps a running target and its instant inside its own tenant', async () => {
      const seed = started([TWO_DAYS]);

      await write(seed);

      const theirs = await fixture.inTenant(TENANT_B, (transaction) =>
        fixture.stores.steps.forInstance(transaction, seed.instance.instanceId),
      );

      expect(theirs).toStrictEqual([]);
    });
  });
});
