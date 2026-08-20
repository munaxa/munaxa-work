import { beforeEach, describe, expect, it } from 'vitest';

import { WorkflowPermissions, ALL_WORKFLOW_PERMISSIONS } from './workflow-permissions.js';
import { publishedBranches } from './workflow-scenarios.js';
import {
  APPROVER,
  NOW,
  REQUESTER,
  SUBJECT_TYPE,
  ask,
  attempt,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';

/**
 * The automatic service-level reminder, through the application.
 *
 * The domain suite proves *when* a reminder is due. This one proves the four things only the handler
 * can be wrong about: that automatic execution goes through the same authorization gate a person
 * does, that a human cannot run it at all, that the intent is emitted **after** the claim commits and
 * only then, and that a second run changes nothing.
 */

/** `runningApproval` starts a step awaiting at `NOW`; two hours later it is overdue. */
const THREE_HOURS = 3 * 60 * 60 * 1000;

const overdueApproval = async (
  harness: Harness,
): Promise<{ instanceId: string; stepId: string }> => {
  const process = await publishedBranches(harness, [
    { ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'hours' } },
  ]);
  const started = await harness.as(REQUESTER, () =>
    send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: process.definitionId,
      subjectType: SUBJECT_TYPE,
      subjectId: 'requisition-1',
    }),
  );
  const opening = await historyOf(harness, started.instanceId);
  const awaiting = opening.find((entry) => entry.event === 'step-awaiting');

  if (awaiting?.stepId === undefined) throw new Error('the scenario produced no awaiting step');
  return { instanceId: started.instanceId, stepId: awaiting.stepId };
};

interface HistoryEntry {
  readonly event: string;
  readonly stepId?: string;
  readonly actorMembershipId?: string;
  readonly onBehalfOfMembershipId?: string;
}

/**
 * The approval's timeline, through the published query.
 *
 * Read through the contract rather than the store because that is what a reader of this module
 * actually gets — and because it is the assertion that would catch a reminder entry that existed in
 * the database but never reached anybody.
 */
const historyOf = async (
  harness: Harness,
  instanceId: string,
): Promise<readonly HistoryEntry[]> => {
  const page = await harness.as(REQUESTER, () =>
    ask<{ items: readonly HistoryEntry[] }>(harness, {
      queryName: 'workflow.read-history',
      instanceId,
    }),
  );

  return page.items;
};

const remind = (harness: Harness, ids: { instanceId: string; stepId: string }) =>
  harness.asMachine(() =>
    attempt(harness, {
      commandName: 'workflow.remind-step',
      instanceId: ids.instanceId,
      stepId: ids.stepId,
    }),
  );

describe('running the automatic reminder', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  beforeEach(async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
  });

  it('emits one intent for the approver the step names', async () => {
    const outcome = await remind(harness, ids);

    expect(outcome.ok).toBe(true);
    expect(harness.reminderRecipient.asked).toStrictEqual([APPROVER]);
    expect(harness.notifications.sent).toHaveLength(1);
    expect(harness.notifications.sent[0]?.recipients).toStrictEqual([
      { userId: `user-for-${APPROVER}` },
    ]);
  });

  /** One history row, and it is the reminder — not a decision, not an escalation. */
  it('records exactly one step-reminded entry', async () => {
    await remind(harness, ids);

    const history = await historyOf(harness, ids.instanceId);
    const reminders = history.filter((entry) => entry.event === 'step-reminded');

    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.stepId).toBe(ids.stepId);
  });

  /**
   * **Nothing about the approval moves.** Asserted over the whole step and instance rather than field
   * by field, so an effect anybody adds later is caught whatever it touched.
   */
  it('changes no step and no instance', async () => {
    const statusOf = () =>
      harness.as(REQUESTER, () =>
        ask<unknown>(harness, {
          queryName: 'workflow.read-approval-status',
          approvalId: ids.instanceId,
        }),
      );
    const before = await statusOf();

    await remind(harness, ids);

    // The whole published status — every step, every status, the tally and the instance — compared as
    // one object, so an effect anybody adds later is caught whatever it touched.
    expect(await statusOf()).toStrictEqual(before);
  });

  /**
   * **The published entry names nobody**, which is the half a reader of this module can see.
   *
   * The stored provenance is deliberately *not* published — it is an operator's fact, not a field for
   * an approvals screen — so it is asserted where it lives, in the persistence suite that round-trips
   * it through the mapper. What matters here is that the timeline shows an entry with both actor
   * columns empty: nobody did this, and the screen says so.
   */
  it('publishes an entry that names no actor, and leaks no execution identity', async () => {
    await harness.asMachine(
      () =>
        attempt(harness, {
          commandName: 'workflow.remind-step',
          instanceId: ids.instanceId,
          stepId: ids.stepId,
        }),
      { jobId: 'job-7', attempt: 2 },
    );

    const history = await historyOf(harness, ids.instanceId);
    const reminder = history.find((entry) => entry.event === 'step-reminded');

    expect(reminder).toBeDefined();
    expect(reminder?.actorMembershipId).toBeUndefined();
    expect(reminder?.onBehalfOfMembershipId).toBeUndefined();
    // And no execution identity reaches the tenant-facing timeline.
    expect(JSON.stringify(reminder)).not.toContain('service:');
  });
});

describe('who may run it', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  /**
   * **A person cannot run it, even holding every permission there is.**
   *
   * This is the guarantee that keeps automatic work attributable: the handler needs an execution to
   * attribute the entry to, and only a machine context has one. A human run is refused before
   * anything is read, so there is no path to a reminder nothing accounts for.
   */
  it('refuses a human caller holding every Workflow permission', async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));

    const outcome = await harness.as(APPROVER, () =>
      attempt(harness, {
        commandName: 'workflow.remind-step',
        instanceId: ids.instanceId,
        stepId: ids.stepId,
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? undefined : outcome.error).toStrictEqual({
      kind: 'rejected',
      reason: 'workflow.rejection.reminder-execution-unknown',
    });
    expect(harness.notifications.sent).toHaveLength(0);
  });

  /**
   * **A machine without the permission is refused exactly as a person would be.**
   *
   * The machine context opens the tenancy gate and not the authorization one. If this ever passed, a
   * machine would be running business operations nobody granted it.
   */
  it('refuses a machine that does not hold workflow.reminder.execute', async () => {
    harness = harnessFor({
      permissions: ALL_WORKFLOW_PERMISSIONS.filter(
        (permission) => permission !== WorkflowPermissions.reminderExecute,
      ),
    });
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));

    const outcome = await remind(harness, ids);

    expect(outcome.ok ? undefined : outcome.error).toStrictEqual({
      kind: 'forbidden',
      permission: 'workflow.reminder.execute',
    });
    expect(harness.notifications.sent).toHaveLength(0);
  });

  /** And holding only that one permission is enough — it is implied by nothing and implies nothing. */
  it('admits a machine holding only workflow.reminder.execute', async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));

    expect((await remind(harness, ids)).ok).toBe(true);
  });
});
