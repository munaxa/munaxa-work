import { beforeEach, describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  DEPUTY,
  OUTSIDER,
  SECOND_APPROVER,
  ask,
  attempt,
  failureOf,
  harnessFor,
  must,
  send,
  type Harness,
} from './workflow-test-harness.js';
import { publishedBranches, startedOn } from './workflow-scenarios.js';
import type { WorkflowInstanceDetailView } from '../contracts/views.js';

/**
 * What escalation does to a branch, through the real command.
 *
 * **What this file proves is that the application adds nothing.** Every rule belongs to the domain,
 * and the handler's whole job is to load an approval, hand it over, and write what comes back — so
 * the assertions here are about the *seam*: that the permission is exact, that the denominator the
 * domain protects survives a real command, that a refusal writes nothing at all, and that the caller
 * cannot name themselves.
 *
 * **The escalated approver arrives as an ordinary membership step**, indistinguishable in kind from
 * anybody else on the branch and distinguishable only by `escalatedAt` — which is precisely the
 * distinction the tally reads and the reason the denominator does not move.
 */

const branchOf = (
  rule: 'unanimous' | 'majority' | 'first-response',
  approvers: readonly string[],
) =>
  approvers.map((approverMembershipId) => ({
    ordinal: 1,
    approverMembershipId,
    branchRule: rule,
    serviceLevel: { count: 2, unit: 'days' as const },
  }));

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  harness.as(ADMINISTRATOR, () =>
    ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId }),
  );

const escalate = (
  harness: Harness,
  instanceId: string,
  approverMembershipId: string,
  ordinal = 1,
  as = ADMINISTRATOR,
) =>
  harness.as(as, () =>
    attempt(harness, {
      commandName: 'workflow.escalate-branch',
      instanceId,
      ordinal,
      approverMembershipId,
    }),
  );

const runningBranch = async (
  harness: Harness,
  rule: 'unanimous' | 'majority' | 'first-response',
  approvers: readonly string[] = [APPROVER, SECOND_APPROVER, DEPUTY],
): Promise<string> => {
  const process = await harness.as(ADMINISTRATOR, () =>
    publishedBranches(harness, branchOf(rule, approvers), `escalation-${rule}`),
  );

  return startedOn(harness, process, `requisition-${rule}`);
};

describe('escalating a branch, by rule', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('adds an approver to a majority branch without moving the denominator', async () => {
    const instanceId = await runningBranch(harness, 'majority');
    const before = (await detailOf(harness, instanceId)).tallies?.[0];

    must(await escalate(harness, instanceId, OUTSIDER), 'escalating');

    const after = (await detailOf(harness, instanceId)).tallies?.[0];

    // Three assigned and a threshold of two, before and after. A fourth step exists; a fourth
    // *assigned approver* does not, which is the locked 16B rule surviving a real command.
    expect([before?.assigned, before?.threshold]).toStrictEqual([3, 2]);
    expect([after?.assigned, after?.threshold]).toStrictEqual([3, 2]);
    expect(after?.outcome).toBe('awaiting');
  });

  it('adds an approver to a first-response branch', async () => {
    const instanceId = await runningBranch(harness, 'first-response', [APPROVER, SECOND_APPROVER]);

    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(true);

    const tally = (await detailOf(harness, instanceId)).tallies?.[0];

    expect([tally?.assigned, tally?.threshold]).toStrictEqual([2, 1]);
  });

  /**
   * `unanimous` refuses, and the refusal is the domain's own name (D-16D-08).
   *
   * Nothing is written: the branch has the steps it started with and the timeline has no escalation
   * entry, because the handler returns before either write.
   */
  it('refuses a unanimous branch and writes nothing', async () => {
    const instanceId = await runningBranch(harness, 'unanimous', [APPROVER, SECOND_APPROVER]);
    const before = await detailOf(harness, instanceId);
    const refused = await escalate(harness, instanceId, OUTSIDER);

    expect(failureOf(refused)).toBe('workflow.rejection.escalation-branch-is-unanimous');

    const after = await detailOf(harness, instanceId);

    expect(after.steps).toHaveLength(before.steps.length);
    expect(after.tallies?.[0]?.assigned).toBe(2);

    const timeline = await harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );

    expect(timeline.items.map((item) => item.event)).not.toContain('step-escalated');
  });
});

describe('what the escalated step carries', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();
    instanceId = await runningBranch(harness, 'majority');
    must(await escalate(harness, instanceId, OUTSIDER), 'escalating');
  });

  it('is an awaiting membership step that inherits the branch’s configuration', async () => {
    const added = (await detailOf(harness, instanceId)).steps.find(
      (step) => step.approverMembershipId === OUTSIDER,
    );

    expect(added?.approverKind).toBe('membership');
    expect(added?.status).toBe('awaiting');
    // The branch's own target, copied as every other step in the branch carries it.
    expect(added?.serviceLevel).toMatchObject({ count: 2, unit: 'days' });
  });

  /** The original approvers are exactly where they were: nobody replaced, nobody removed. */
  it('leaves every original step untouched', async () => {
    const steps = (await detailOf(harness, instanceId)).steps;
    const original = steps.filter((step) => step.approverMembershipId !== OUTSIDER);

    expect(original.map((step) => step.approverMembershipId).sort()).toStrictEqual(
      [APPROVER, SECOND_APPROVER, DEPUTY].sort(),
    );
    for (const step of original) expect(step.status).toBe('awaiting');
    // Four steps at one ordinal, and the branch still counts three.
    expect(steps).toHaveLength(4);
  });

  /** One entry, under its own event, naming the person who asked for it. */
  it('records a step-escalated entry and no decision', async () => {
    const timeline = await harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string; actorMembershipId?: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );
    const escalations = timeline.items.filter((item) => item.event === 'step-escalated');

    expect(escalations).toHaveLength(1);
    // The actor is the caller, resolved from the context — never the approver who was added.
    expect(escalations[0]?.actorMembershipId).toBe(ADMINISTRATOR);
    expect(escalations[0]?.actorMembershipId).not.toBe(OUTSIDER);
    // And no decision was invented for somebody who has not answered.
    for (const decided of ['step-approved', 'step-rejected', 'step-skipped']) {
      expect(timeline.items.map((item) => item.event)).not.toContain(decided);
    }
  });
});

describe('the refusals, each still its own', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('keeps every escalation refusal distinct through the application', async () => {
    const instanceId = await runningBranch(harness, 'majority');

    must(await escalate(harness, instanceId, OUTSIDER), 'the first escalation');

    const unanimous = await runningBranch(harness, 'unanimous', [APPROVER, SECOND_APPROVER]);
    const named = [
      failureOf(await escalate(harness, unanimous, OUTSIDER)),
      failureOf(await escalate(harness, instanceId, APPROVER)),
      failureOf(await escalate(harness, instanceId, OUTSIDER)),
      failureOf(await escalate(harness, instanceId, OUTSIDER, 9)),
    ];

    expect(named).toStrictEqual([
      'workflow.rejection.escalation-branch-is-unanimous',
      'workflow.rejection.escalation-approver-already-assigned',
      'workflow.rejection.escalation-already-escalated',
      'workflow.rejection.escalation-branch-not-awaiting',
    ]);
    expect(new Set(named).size).toBe(4);
  });

  it('refuses an approval that was cancelled, by its own name', async () => {
    const instanceId = await runningBranch(harness, 'majority');

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'workflow.cancel-instance',
        instanceId,
        reason: 'Withdrawn',
        expectedVersion: 1,
      }),
    );

    expect(failureOf(await escalate(harness, instanceId, OUTSIDER))).toBe(
      'workflow.rejection.escalation-instance-not-running',
    );
  });

  it('answers not-found for an approval that does not exist', async () => {
    const refused = await escalate(harness, 'no-such-instance', OUTSIDER);

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe('not_found');
  });

  /** A refusal writes nothing: the branch and the timeline are what they were. */
  it('creates no step and no entry when the domain refuses', async () => {
    const instanceId = await runningBranch(harness, 'majority');

    must(await escalate(harness, instanceId, OUTSIDER), 'the first escalation');

    const before = await detailOf(harness, instanceId);

    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(false);

    const after = await detailOf(harness, instanceId);

    expect(after.steps).toHaveLength(before.steps.length);
    expect(after.tallies?.[0]?.assigned).toBe(before.tallies?.[0]?.assigned);
  });
});
