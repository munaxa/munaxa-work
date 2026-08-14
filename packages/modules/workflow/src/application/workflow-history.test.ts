import { beforeEach, describe, expect, it } from 'vitest';

import type { ApprovalStatusView, WorkflowHistoryView } from '../contracts/views.js';
import { approveAs, publishedProcess, runningApproval } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  NOW,
  REQUESTER,
  SECOND_APPROVER,
  ask,
  attempt,
  failureOf,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';
import type { Page } from './workflow-ports.js';

/**
 * The timeline an approval leaves behind, the state it reports at the port, and what an application
 * version conflict looks like.
 *
 * **History is written by the commands that move the approval**, not raised separately, which is
 * what keeps the two from disagreeing. Every assertion below reads it back through the query rather
 * than out of a store, so a suite failing here means a screen would be wrong.
 *
 * **The version assertions are about the application, not about a race.** The in-memory stores are a
 * single process; two callers arriving at the same instant is PostgreSQL's arbitration and
 * Checkpoint 3 proved it across two real connections. What is provable here is that a stale
 * `expectedVersion` is refused and a current one is not.
 */

const timelineOf = (harness: Harness, instanceId: string): Promise<Page<WorkflowHistoryView>> =>
  ask<Page<WorkflowHistoryView>>(harness, { queryName: 'workflow.read-history', instanceId });

describe('what an approval records about itself', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('records the raising and the first assignment when it starts', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);
    const timeline = await timelineOf(harness, running.instanceId);

    expect(timeline.items.map((entry) => entry.event)).toStrictEqual([
      'instance-started',
      'step-awaiting',
    ]);
    expect(timeline.items[0]?.actorMembershipId).toBe(REQUESTER);
    expect(timeline.items[1]?.ordinal).toBe(1);
    expect(timeline.items[0]?.occurredOn).toBe(NOW.toISOString());
  });

  it('records each approval, the next assignment, and the completion', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);
    await approveAs(harness, SECOND_APPROVER, running.instanceId);

    const timeline = await timelineOf(harness, running.instanceId);

    expect(timeline.items.map((entry) => entry.event)).toStrictEqual([
      'instance-started',
      'step-awaiting',
      'step-approved',
      'step-awaiting',
      'step-approved',
      'instance-completed',
    ]);
  });

  it('explains every abandoned step when an approval is rejected', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'workflow.decide-step',
        instanceId: running.instanceId,
        decision: 'rejected',
        expectedVersion: 1,
      }),
    );

    const timeline = await timelineOf(harness, running.instanceId);

    expect(timeline.items.slice(2).map((entry) => entry.event)).toStrictEqual([
      'step-rejected',
      'step-skipped',
      'instance-rejected',
    ]);
  });

  it('records a delegate as the actor and the approver as the authority', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, {
      from: new Date(NOW.getTime() - 3_600_000),
      to: new Date(NOW.getTime() + 3_600_000),
    });
    await approveAs(harness, DEPUTY, running.instanceId);

    const timeline = await timelineOf(harness, running.instanceId);
    const approved = timeline.items.find((entry) => entry.event === 'step-approved');

    expect(approved?.actorMembershipId).toBe(DEPUTY);
    expect(approved?.onBehalfOfMembershipId).toBe(APPROVER);
  });

  it('records a cancellation and the steps it abandoned', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 1,
    });

    const timeline = await timelineOf(harness, running.instanceId);

    expect(timeline.items.map((entry) => entry.event)).toStrictEqual([
      'instance-started',
      'step-awaiting',
      'step-skipped',
      'step-skipped',
      'instance-cancelled',
    ]);
  });

  it('offers no way to change or remove an entry', () => {
    const stores = harnessFor().stores;

    // The two append-only stores have inserts and reads and nothing else — the same shape as their
    // production counterparts and the two triggers behind them.
    expect(Object.keys(stores.history).sort()).toStrictEqual(['forInstance', 'insert']);
    expect(Object.keys(stores.decisions).sort()).toStrictEqual([
      'decidedBy',
      'forInstance',
      'insert',
    ]);
  });
});

describe('the state reported at the port', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  const statusOf = (instanceId: string): Promise<ApprovalStatusView> =>
    ask<ApprovalStatusView>(harness, {
      queryName: 'workflow.read-approval-status',
      approvalId: instanceId,
    });

  it('reports pending while it runs and approved when it completes', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    expect((await statusOf(running.instanceId)).state).toBe('pending');

    await approveAs(harness, APPROVER, running.instanceId);

    const finished = await statusOf(running.instanceId);

    expect(finished.state).toBe('approved');
    expect(finished.completedOn).toBe(NOW.toISOString());
  });

  it('reports the chain in order, with the approver each step was assigned to', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);

    const status = await statusOf(running.instanceId);

    expect(status.steps.map((step) => step.approver)).toStrictEqual([APPROVER, SECOND_APPROVER]);
    expect(status.steps[0]?.decision).toBe('approved');
    // Not yet asked, so no answer is invented for it.
    expect(status.steps[1]?.decision).toBeUndefined();
  });

  it('reports cancelled, and never expired', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 1,
    });

    const status = await statusOf(running.instanceId);

    expect(status.state).toBe('cancelled');
    // `expired` is one of the port's five states and Phase 16A produces none: SLA is 16B and
    // `JobPort` has no adapter, so nothing expires anything.
    expect(status.state).not.toBe('expired');
  });

  it('returns the approval identifier the adopting module will store', async () => {
    const running = await runningApproval(harness, [APPROVER]);
    const status = await statusOf(running.instanceId);

    expect(status.approvalId).toBe(running.instanceId);
  });
});

describe('an application version conflict', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('refuses a stale expected version on a transition the domain permits', async () => {
    // The version has to be tested on an operation the *domain* allows, or the refusal comes from
    // the lifecycle rule and never reaches the store. Cancelling a running approval is legal; doing
    // it against a version nobody holds is the stale writer.
    const running = await runningApproval(harness, [APPROVER]);
    const stale = await attempt(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 99,
    })
      .then(() => 'accepted')
      .catch((error: unknown) => (error instanceof Error ? error.message : 'unknown'));

    expect(stale).toMatch(/concurren|version/i);

    // The same act against the version the caller actually read succeeds.
    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 1,
    });

    const detail = await ask<{ instance: { status: string; version: number } }>(harness, {
      queryName: 'workflow.read-instance',
      instanceId: running.instanceId,
    });

    expect(detail.instance.status).toBe('cancelled');
    // Incremented exactly once by the write that won.
    expect(detail.instance.version).toBe(2);
  });

  it('refuses a stale expected version when publishing a version', async () => {
    const process = await publishedProcess(harness, [APPROVER], 'staleness');
    const draft = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });

    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: draft.workflowVersionId,
      ordinal: 1,
      name: { en: 'One', ar: 'واحد' },
      approverMembershipId: APPROVER,
    });

    const stale = await attempt(harness, {
      commandName: 'workflow.publish-version',
      workflowVersionId: draft.workflowVersionId,
      expectedVersion: 7,
    })
      .then(() => 'accepted')
      .catch((error: unknown) => (error instanceof Error ? error.message : 'unknown'));

    expect(stale).toMatch(/concurren|version/i);
    // And the version the caller read publishes it.
    await send(harness, {
      commandName: 'workflow.publish-version',
      workflowVersionId: draft.workflowVersionId,
      expectedVersion: 1,
    });
  });

  it('keeps a version conflict distinct from a domain refusal', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    // A refusal names a catalogue key; a conflict is an exception. A caller can tell "somebody beat
    // you to it" from "what you asked for is not allowed".
    const refusal = await attempt(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: '  ',
      expectedVersion: 1,
    });

    expect(failureOf(refusal)).toBe('workflow.rejection.cancellation-reason-required');
  });
});
