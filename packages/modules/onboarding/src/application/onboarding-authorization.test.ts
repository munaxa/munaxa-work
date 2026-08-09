import { describe, expect, it } from 'vitest';

import { inMemoryOnboardingStores } from './in-memory-stores.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import {
  anEmployment,
  aPublishedPlan,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  TENANT_A,
  TENANT_B,
  type Harness,
} from './onboarding-test-harness.js';
import type { OnboardingStarted } from './start.use-case.js';
import type { OnboardingSnapshot, TaskView } from '../contracts/views.js';

/**
 * Who may do what, and what one tenant can see of another.
 *
 * The separations asserted here are the ones that would fail open silently. A permission that is
 * merely *declared* on a handler proves nothing; what proves it is a caller who holds everything
 * else being refused.
 */
describe('Every operation is its own permission', () => {
  /**
   * Publishing is not drafting.
   *
   * A published version is what every onboarding started afterwards is generated from and what an
   * auditor reads. Somebody trusted to improve next quarter's checklist is not thereby trusted to
   * put it in force.
   */
  it('refuses to publish a version without onboarding.plan.publish', async () => {
    const harness = harnessFor(TENANT_A, [
      OnboardingPermissions.planManage,
      OnboardingPermissions.planRead,
    ]);

    await asTenant(TENANT_A, async () => {
      const plan = await send<{ planId: string }>(harness, {
        commandName: 'onboarding.create-plan',
        code: 'joiner',
        name: { en: 'Joiner', ar: 'منضم' },
      });
      const version = await send<{ planVersionId: string }>(harness, {
        commandName: 'onboarding.draft-plan-version',
        planId: plan.ok ? plan.value.planId : '',
      });

      expect(version.ok).toBe(true);

      const refused = await send(harness, {
        commandName: 'onboarding.publish-plan-version',
        planVersionId: version.ok ? version.value.planVersionId : '',
        expectedVersion: 1,
      });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe('forbidden');
    });
  });

  /**
   * Waiving is not completing.
   *
   * "We did it" and "it did not apply to this person" are different answers, and the second is the
   * one an auditor asks about. A required task waived by somebody unauthorized to waive it is how a
   * completion record stops meaning anything.
   */
  it('refuses to waive a task with only onboarding.task.complete', async () => {
    const granted = [
      OnboardingPermissions.planManage,
      OnboardingPermissions.planPublish,
      OnboardingPermissions.planRead,
      OnboardingPermissions.start,
      OnboardingPermissions.read,
      OnboardingPermissions.taskRead,
      OnboardingPermissions.taskComplete,
    ];
    const harness = harnessFor(TENANT_A, granted);

    await asTenant(TENANT_A, async () => {
      const task = await aTask(harness);
      const refused = await send(harness, {
        commandName: 'onboarding.waive-task',
        taskId: task.taskId,
        reasonCode: 'not-applicable',
        expectedVersion: 1,
      });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe('forbidden');
      expect(
        (
          await send(harness, {
            commandName: 'onboarding.complete-task',
            taskId: task.taskId,
            expectedVersion: 1,
          })
        ).ok,
      ).toBe(true);
    });
  });

  /**
   * Self-service closes the caller's own task and nobody else's.
   *
   * This is the permission Employee Self-Service (Phase 18) will grant every employee, so the rule
   * has to hold at the handler rather than at a screen: a task owned by somebody else is refused
   * even though the caller holds the permission and the task exists.
   */
  it('refuses to complete somebody else\'s task through the self-service path', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const task = await aTask(harness);
      const somebodyElse = anEmployment(harness);
      const refused = await send(harness, {
        commandName: 'onboarding.complete-own-task',
        taskId: task.taskId,
        employmentId: somebodyElse.employmentId,
        expectedVersion: 1,
      });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe('conflict');
      expect(!refused.ok && refused.error.kind === 'conflict' && refused.error.reason).toBe(
        'task_belongs_to_somebody_else',
      );
    });
  });

  /** Reconciliation performs the start, so it needs the start permission and not a way around it. */
  it('refuses reconciliation to a caller who may not start an onboarding', async () => {
    const harness = harnessFor(TENANT_A, [OnboardingPermissions.read]);

    await asTenant(TENANT_A, async () => {
      const refused = await send(harness, { commandName: 'onboarding.reconcile' });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe('forbidden');
    });
  });

  /** The export is held by fewer people than read, because it is the largest disclosure here. */
  it('refuses the export to a caller who may only read', async () => {
    const harness = harnessFor(TENANT_A, [
      OnboardingPermissions.read,
      OnboardingPermissions.taskRead,
    ]);

    await asTenant(TENANT_A, async () => {
      const refused = await ask(harness, { queryName: 'onboarding.export' });

      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error.kind).toBe('forbidden');
    });
  });
});

describe('One tenant sees nothing of another', () => {
  /**
   * Every assertion below uses **shared stores**: the same rows, read through two tenants' contexts.
   * A test with separate stores would prove only that two empty collections are empty.
   *
   * Not found rather than forbidden, deliberately. "Forbidden" on an onboarding identifier would
   * confirm that somebody is being onboarded in this system — one tenant learning another has a
   * joiner starting on Monday.
   */
  it('cannot read, search, or move another tenant\'s onboarding', async () => {
    const stores = inMemoryOnboardingStores();
    const a = harnessWithStores(TENANT_A, stores);
    const b = harnessWithStores(TENANT_B, stores, undefined, {
      employment: a.employment,
      people: a.people,
    });

    const started = await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(a);
      const employment = anEmployment(a);

      return startFor(a, employment.employmentId, plan.planId);
    });

    await asTenant(TENANT_B, async () => {
      const read = await ask(b, { queryName: 'onboarding.read', onboardingId: started.onboardingId });
      const searched = await ask<{ readonly items: readonly unknown[] }>(b, {
        queryName: 'onboarding.search',
      });
      const moved = await send(b, {
        commandName: 'onboarding.begin-onboarding',
        onboardingId: started.onboardingId,
        expectedVersion: 1,
      });

      expect(!read.ok && read.error.kind).toBe('not_found');
      expect(searched.ok && searched.value.items).toEqual([]);
      expect(!moved.ok && moved.error.kind).toBe('not_found');
    });
  });

  it('cannot see another tenant\'s plans or tasks', async () => {
    const stores = inMemoryOnboardingStores();
    const a = harnessWithStores(TENANT_A, stores);
    const b = harnessWithStores(TENANT_B, stores, undefined, {
      employment: a.employment,
      people: a.people,
    });

    await asTenant(TENANT_A, async () => {
      await aTask(a);
    });

    await asTenant(TENANT_B, async () => {
      const plans = await ask<{ readonly items: readonly unknown[] }>(b, {
        queryName: 'onboarding.search-plans',
      });
      const tasks = await ask<{ readonly items: readonly TaskView[] }>(b, {
        queryName: 'onboarding.search-tasks',
      });

      expect(plans.ok && plans.value.items).toEqual([]);
      expect(tasks.ok && tasks.value.items).toEqual([]);
    });
  });

  /**
   * The reliability path is tenant-scoped too.
   *
   * Reconciliation is the one operation that reaches for a *list* of employments rather than a named
   * one, so it is the one that would leak a whole workforce if the scope were wrong.
   */
  it('reconciles only its own tenant\'s employments', async () => {
    const stores = inMemoryOnboardingStores();
    const a = harnessWithStores(TENANT_A, stores);
    const b = harnessWithStores(TENANT_B, stores, undefined, {
      employment: a.employment,
      people: a.people,
    });
    const employment = await asTenant(TENANT_A, () => Promise.resolve(anEmployment(a)));

    await asTenant(TENANT_A, async () => {
      const outcome = await send<{ started: number }>(a, { commandName: 'onboarding.reconcile' });

      expect(outcome.ok && outcome.value.started).toBe(1);
    });

    await asTenant(TENANT_B, async () => {
      // Tenant B's reconciliation shares the *fake* employment directory, which in production is a
      // tenant-scoped read. What it must not do is see A's instance and conclude anything from it.
      const searched = await ask<{ readonly items: readonly unknown[] }>(b, {
        queryName: 'onboarding.search',
        employmentId: employment.employmentId,
      });

      expect(searched.ok && searched.value.items).toEqual([]);
    });
  });
});

const startFor = async (
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

/** One onboarding with its checklist, and the first task of it. */
const aTask = async (harness: Harness): Promise<TaskView> => {
  const plan = await aPublishedPlan(harness);
  const employment = anEmployment(harness);
  const started = await startFor(harness, employment.employmentId, plan.planId);
  const snapshot = await ask<OnboardingSnapshot>(harness, {
    queryName: 'onboarding.read',
    onboardingId: started.onboardingId,
  });

  if (!snapshot.ok) throw new Error('The onboarding could not be read back.');

  const task = snapshot.value.tasks[0];

  if (task === undefined) throw new Error('The onboarding was generated with no tasks.');
  return task;
};
