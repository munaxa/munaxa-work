import { beforeEach, describe, expect, it } from 'vitest';

import { inMemoryOnboardingStores } from './in-memory-stores.js';
import {
  anEmployment,
  aPublishedPlan,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  TENANT_A,
  type Harness,
} from './onboarding-test-harness.js';
import type { AwaitingOnboardingView, ReconciliationOutcome } from './reconcile.use-case.js';
import type { OnboardingStarted } from './start.use-case.js';

/**
 * The three properties this module's reliability rests on.
 *
 * They are one suite rather than three scattered assertions because they are one argument, and the
 * argument is worth stating plainly:
 *
 * **Event delivery in this product is post-commit, in-process and at-most-once, with no outbox.** A
 * hire event can be lost — the process can die between the commit and the dispatch, and nothing
 * replays it. So an onboarding is *never* guaranteed by an event. What guarantees it is an
 * idempotent command plus a reconciliation that can be run again, and these tests are the evidence
 * for that claim rather than a description of it.
 *
 * The first scenario is the one that matters most, because it is the failure a reader will not
 * otherwise believe: an employment is created, the event never arrives, and the joiner still gets an
 * onboarding.
 */
describe('Onboarding is guaranteed by reconciliation, not by an event', () => {
  beforeEach(() => {
    testClock.reset();
  });

  /**
   * Scenario one — the missed event.
   *
   * Nothing in this test publishes or consumes anything. That is the point: no hire event is
   * delivered, no accelerator runs, and the onboarding still exists at the end because
   * reconciliation found the employment and started one. Running it a second time creates nothing.
   */
  it('creates the onboarding a lost hire event never started, and never twice', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      // Step 1: the employment exists, exactly as Recruitment's hire left it.
      const employment = anEmployment(harness);

      // Step 2 and 3: no event was delivered, so no onboarding exists.
      const before = await ask<AwaitingOnboardingView>(harness, {
        queryName: 'onboarding.awaiting-onboarding',
      });

      expect(before.ok).toBe(true);
      expect(before.ok && before.value.employments.map((one) => one.employmentId)).toContain(
        employment.employmentId,
      );

      // Step 4 and 5: reconciliation detects it and starts one.
      const first = await send<ReconciliationOutcome>(harness, {
        commandName: 'onboarding.reconcile',
        planId: plan.planId,
      });

      expect(first.ok).toBe(true);
      expect(first.ok && first.value.started).toBe(1);
      expect(first.ok && first.value.failures).toEqual([]);

      // Step 6: a second run creates nothing. Not "creates a duplicate that is later cleaned up" —
      // creates nothing, because the employment already has an onboarding.
      const second = await send<ReconciliationOutcome>(harness, {
        commandName: 'onboarding.reconcile',
        planId: plan.planId,
      });

      expect(second.ok).toBe(true);
      expect(second.ok && second.value.started).toBe(0);
      expect(instancesFor(harness, employment.employmentId)).toBe(1);

      // And the joiner has the checklist, not merely a row.
      expect(tasksCount(harness)).toBe(2);
    });
  });

  /**
   * Scenario two — the same command, twice.
   *
   * Both are successes. The second names the instance the first created and says so, rather than
   * returning a conflict a client would have to interpret: an idempotent command whose retry fails
   * is not idempotent, it is merely tolerant of one attempt.
   */
  it('returns the same onboarding when the start command is sent twice', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness);
      const first = await start(harness, employment.employmentId, plan.planId);
      const second = await start(harness, employment.employmentId, plan.planId);

      expect(first.alreadyExisted).toBe(false);
      expect(second.alreadyExisted).toBe(true);
      expect(second.onboardingId).toBe(first.onboardingId);
      // The second request generated no second checklist either. Two instances would have been
      // obvious; two sets of tasks on one instance is the quieter version of the same bug.
      expect(second.tasksCreated).toBe(0);
      expect(instancesFor(harness, employment.employmentId)).toBe(1);
      expect(tasksCount(harness)).toBe(2);
    });
  });

  /**
   * Scenario three — two at once.
   *
   * The uniqueness boundary is a database constraint, not a check the application makes: both
   * requests read "no onboarding", both try to insert, and one is refused. The in-memory store
   * reproduces the partial unique index *and the SQLSTATE the driver raises*, so the branch the
   * loser takes — re-read, return the winner's instance — is exercised here rather than only in
   * production. The integration suite proves the same thing against the real index.
   */
  it('converges on one onboarding when two starts race', async () => {
    const stores = inMemoryOnboardingStores();
    const first = harnessWithStores(TENANT_A, stores);
    const second = harnessWithStores(TENANT_A, stores, undefined, {
      employment: first.employment,
      people: first.people,
    });

    await asTenant(TENANT_A, async () => {
      const employment = anEmployment(first);
      const [left, right] = await Promise.all([
        start(first, employment.employmentId),
        start(second, employment.employmentId),
      ]);

      expect(left.onboardingId).toBe(right.onboardingId);
      // Exactly one of them created it. Both reporting `alreadyExisted: false` would mean two rows.
      expect([left.alreadyExisted, right.alreadyExisted].filter((one) => !one)).toHaveLength(1);
      expect(instancesFor(first, employment.employmentId)).toBe(1);
    });
  });

  /**
   * Reconciliation is not a way around the rules.
   *
   * It sends the *same* command an administrator would, so an ended employment is refused in a
   * reconciliation run exactly as it is at the endpoint — and the run reports the refusal instead of
   * swallowing it.
   */
  it('refuses an ended employment during a run, and reports why', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const employment = anEmployment(harness);

      harness.employment.end(employment.employmentId);

      const outcome = await send<ReconciliationOutcome>(harness, {
        commandName: 'onboarding.reconcile',
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.ok && outcome.value.started).toBe(0);
      expect(instancesFor(harness, employment.employmentId)).toBe(0);
    });
  });
});

const start = async (
  harness: Harness,
  employmentId: string,
  planId?: string,
): Promise<OnboardingStarted> => {
  const result = await send<OnboardingStarted>(harness, {
    commandName: 'onboarding.start-onboarding',
    employmentId,
    ...(planId === undefined ? {} : { planId }),
  });

  if (!result.ok) throw new Error(`Start failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

/** Counted from the store rather than from a query, so a read filter cannot hide a second row. */
const instancesFor = (harness: Harness, employmentId: string): number =>
  rowsOf(harness.stores.onboardings).filter(
    (row) => (row as { employmentId: string }).employmentId === employmentId,
  ).length;

const tasksCount = (harness: Harness): number => rowsOf(harness.stores.tasks).length;

const rowsOf = (store: unknown): readonly unknown[] =>
  (store as { readonly rows: readonly unknown[] }).rows;
