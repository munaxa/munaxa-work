import { beforeEach, describe, expect, it } from 'vitest';

import {
  anEmployment,
  aPublishedPlan,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  TENANT_A,
  type Harness,
} from './onboarding-test-harness.js';
import type { OnboardingStarted } from './start.use-case.js';
import type { OnboardingSnapshot, TaskEventView, TaskView } from '../contracts/views.js';

/**
 * What an onboarding does between being started and being finished.
 *
 * Through the dispatcher, because the pipeline is where tenancy and authorization are applied and a
 * test that called handlers directly would prove a handler works for a caller who was never checked.
 */
describe('An onboarding carries the checklist it was given', () => {
  beforeEach(() => {
    testClock.reset();
  });

  /**
   * The copy is what makes plan versioning work.
   *
   * Tasks are rows on the instance from the moment it is generated; nothing afterwards reads the
   * template again. This asserts the *dates* as well as the titles, because the due date is resolved
   * once from the anchor and offset — a task that recomputed its deadline would move it every time a
   * plan was edited.
   */
  it('copies the published version at creation, with due dates resolved', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness, { startDate: '2026-09-01' });
      const started = await start(harness, employment.employmentId, plan.planId);
      const snapshot = await read(harness, started.onboardingId);

      expect(snapshot.tasks.map((task) => task.templateCode)).toEqual([
        'sign-contract',
        'issue-laptop',
      ]);
      // Three days before the employment starts, and one day after. Calendar days, in UTC.
      expect(snapshot.tasks.map((task) => task.dueOn)).toEqual(['2026-08-29', '2026-09-02']);
      // The employee's task resolved to the joiner's own employment; the queue kept its role.
      expect(snapshot.tasks[0]?.ownerRef).toBe(employment.employmentId);
      expect(snapshot.tasks[1]?.ownerRole).toBe('it');
    });
  });

  /**
   * A tenant that has configured no plan gets an onboarding with no tasks — and a screen that says
   * so. This product seeds no checklist, because what a joiner is asked to do is the customer's
   * decision and in several markets part of it is statutory (00B).
   */
  it('starts with no tasks when no plan is named', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const employment = anEmployment(harness);
      const started = await start(harness, employment.employmentId);
      const snapshot = await read(harness, started.onboardingId);

      expect(started.tasksCreated).toBe(0);
      expect(snapshot.tasks).toEqual([]);
      expect(snapshot.onboarding.planId).toBeUndefined();
    });
  });

  it('refuses completion until every required task is done or waived', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness);
      const started = await start(harness, employment.employmentId, plan.planId);

      await send(harness, {
        commandName: 'onboarding.begin-onboarding',
        onboardingId: started.onboardingId,
        expectedVersion: 1,
      });

      const tooEarly = await send(harness, {
        commandName: 'onboarding.complete-onboarding',
        onboardingId: started.onboardingId,
        expectedVersion: 2,
      });

      expect(tooEarly.ok).toBe(false);
      expect(!tooEarly.ok && tooEarly.error.kind).toBe('rejected');

      const snapshot = await read(harness, started.onboardingId);
      const required = snapshot.tasks.find((task) => task.required);

      await send(harness, {
        commandName: 'onboarding.complete-task',
        taskId: required?.taskId,
        expectedVersion: 1,
      });

      const completed = await send(harness, {
        commandName: 'onboarding.complete-onboarding',
        onboardingId: started.onboardingId,
        expectedVersion: 2,
      });

      // The optional task is still open, and that is not a reason to hold the onboarding.
      expect(completed.ok).toBe(true);
      expect((await read(harness, started.onboardingId)).onboarding.state).toBe('completed');
    });
  });

  /** Cancelling closes the open tasks too. A live task on a cancelled onboarding is a queue entry
   * nobody can act on and nobody can clear. */
  it('cancels the open tasks with the onboarding, and ends no employment', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness);
      const started = await start(harness, employment.employmentId, plan.planId);

      const cancelled = await send(harness, {
        commandName: 'onboarding.cancel-onboarding',
        onboardingId: started.onboardingId,
        reasonCode: 'withdrawn',
        expectedVersion: 1,
      });

      expect(cancelled.ok).toBe(true);

      const snapshot = await read(harness, started.onboardingId);

      expect(snapshot.onboarding.state).toBe('cancelled');
      expect(snapshot.tasks.every((task) => task.status === 'cancelled')).toBe(true);
      // The employment is untouched. Ending one is Employment's operation, and the exit process is
      // Offboarding's.
      expect((await harness.employment.find(employment.employmentId))?.status).toBe('active');
    });
  });

  /**
   * Every movement leaves a row, in the transaction that made it. This is where "who moved this
   * deadline" is answered, and the actor was taken from the context rather than from the command.
   */
  it('records every task movement in the task history', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness);
      const started = await start(harness, employment.employmentId, plan.planId);
      const snapshot = await read(harness, started.onboardingId);
      const task = snapshot.tasks[0];

      await send(harness, {
        commandName: 'onboarding.reschedule-task',
        taskId: task?.taskId,
        dueOn: '2026-08-31',
        expectedVersion: 1,
      });
      await send(harness, {
        commandName: 'onboarding.complete-task',
        taskId: task?.taskId,
        expectedVersion: 2,
      });

      const history = await ask<readonly TaskEventView[]>(harness, {
        queryName: 'onboarding.read-task-history',
        taskId: task?.taskId,
      });

      expect(history.ok).toBe(true);
      expect(history.ok && history.value.map((event) => event.kind)).toEqual([
        'created',
        'rescheduled',
        'completed',
      ]);
      expect(history.ok && history.value[1]?.detail).toBe('2026-08-29 → 2026-08-31');
      expect(history.ok && history.value.every((event) => event.recordedBy.startsWith('user:'))).toBe(
        true,
      );
    });
  });

  /** Overdue is computed from a due date, never stored — so nothing has to sweep it. */
  it('reports a task overdue only once its due date has passed', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const plan = await aPublishedPlan(harness);
      const employment = anEmployment(harness);

      await start(harness, employment.employmentId, plan.planId);

      const before = await overdue(harness);

      testClock.value = new Date('2026-09-05T09:00:00Z');

      const after = await overdue(harness);

      expect(before).toBe(0);
      // Both tasks are past their dates by the fifth, and neither was ever marked so by a job.
      expect(after).toBe(2);
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

const read = async (harness: Harness, onboardingId: string): Promise<OnboardingSnapshot> => {
  const result = await ask<OnboardingSnapshot>(harness, {
    queryName: 'onboarding.read',
    onboardingId,
  });

  if (!result.ok) throw new Error(`Read failed: ${JSON.stringify(result.error)}`);
  return result.value;
};

const overdue = async (harness: Harness): Promise<number> => {
  const result = await ask<{ readonly items: readonly TaskView[] }>(harness, {
    queryName: 'onboarding.search-tasks',
    overdue: true,
  });

  return result.ok ? result.value.items.length : -1;
};
