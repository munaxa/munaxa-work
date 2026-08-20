import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ADMINISTRATOR,
  APPROVER,
  DEPUTY,
  OUTSIDER,
  REQUESTER,
  SECOND_APPROVER,
  ask,
  attempt,
  failureOf,
  harnessFor,
  must,
  type Harness,
} from './workflow-test-harness.js';
import { decideAs, publishedBranches, startedOn } from './workflow-scenarios.js';

/**
 * The two eligibility rules Phase 16D approved, through the real command.
 *
 * The domain suite proves the predicates; this proves they survive a command — that the requester the
 * *instance* recorded is the one refused, that a decision made through `workflow.decide-step` makes
 * somebody terminal, and that a refusal still writes nothing.
 *
 * **The delegation assertion is the one that would rot silently.** D-16D-15 (D) decided that
 * delegation belongs to decision execution and not to escalation eligibility, and the way that
 * decision breaks is not a failing test — it is somebody adding a "helpful" check years from now. So
 * the port is spied on, and the assertion is that escalation never asks it anything at all.
 */

const branchOf = (approvers: readonly string[]) =>
  approvers.map((approverMembershipId) => ({
    ordinal: 1,
    approverMembershipId,
    branchRule: 'majority' as const,
  }));

/** Two branches: an earlier one somebody answers, and a later one still being asked. */
const twoBranches = (earlier: string, later: readonly string[]) => [
  { ordinal: 1, approverMembershipId: earlier, branchRule: 'majority' as const },
  ...later.map((approverMembershipId) => ({
    ordinal: 2,
    approverMembershipId,
    branchRule: 'majority' as const,
  })),
];

const escalate = (
  harness: Harness,
  instanceId: string,
  approverMembershipId: string,
  ordinal = 1,
) =>
  harness.as(ADMINISTRATOR, () =>
    attempt(harness, {
      commandName: 'workflow.escalate-branch',
      instanceId,
      ordinal,
      approverMembershipId,
    }),
  );

describe('the requester, through the command', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();

    const process = await harness.as(ADMINISTRATOR, () =>
      publishedBranches(harness, branchOf([APPROVER, SECOND_APPROVER]), 'eligibility-requester'),
    );

    instanceId = await startedOn(harness, process, 'requisition-requester');
  });

  /**
   * The membership the *instance* recorded, not one the caller supplied.
   *
   * `startedOn` raises the approval as `REQUESTER`, so the identity being refused is the one
   * `startInstance` wrote onto the row — which is the only one that could be authoritative.
   */
  it('refuses the membership that raised the approval', async () => {
    expect(failureOf(await escalate(harness, instanceId, REQUESTER))).toBe(
      'workflow.rejection.escalation-approver-is-the-requester',
    );
  });

  it('admits anybody who did not raise it', async () => {
    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(true);
  });

  /** A refusal writes nothing: no step appears and the branch is what it was. */
  it('creates no step when it refuses the requester', async () => {
    expect((await escalate(harness, instanceId, REQUESTER)).ok).toBe(false);

    must(await escalate(harness, instanceId, OUTSIDER), 'a permitted escalation');

    const timeline = await harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );

    // Exactly one escalation happened, so the refused one wrote no entry of its own.
    expect(timeline.items.filter((item) => item.event === 'step-escalated')).toHaveLength(1);
  });
});

describe('D-5, through a real decision', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();

    const process = await harness.as(ADMINISTRATOR, () =>
      publishedBranches(
        harness,
        twoBranches(APPROVER, [DEPUTY, SECOND_APPROVER]),
        'eligibility-d5',
      ),
    );

    instanceId = await startedOn(harness, process, 'requisition-d5');
  });

  const decide = (as: string, decision: 'approved' | 'rejected') =>
    decideAs(harness, as, instanceId, decision);

  it('refuses somebody who already approved an earlier branch', async () => {
    await decide(APPROVER, 'approved');

    expect(failureOf(await escalate(harness, instanceId, APPROVER, 2))).toBe(
      'workflow.rejection.escalation-approver-already-decided',
    );
  });

  /**
   * Somebody who has answered nothing is admitted, which is the control this pair needs.
   *
   * Without it, a command that refused *everybody* at ordinal 2 would satisfy the assertion above.
   */
  it('admits somebody with no decision anywhere on the instance', async () => {
    await decide(APPROVER, 'approved');

    expect((await escalate(harness, instanceId, OUTSIDER, 2)).ok).toBe(true);
  });
});

describe('delegation stays out of escalation', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  /**
   * **Escalation asks the delegation port nothing** (D-16D-15, D).
   *
   * A delegation is granted and left in force across the escalation, so a check would have something
   * to find — a suite with no delegation present could not tell "delegation is ignored" from
   * "delegation happened to be empty". The spy then proves the stronger claim: not that the answer
   * was ignored, but that the question was never asked.
   */
  it('grants a delegation, escalates anyway, and never calls the port', async () => {
    const process = await harness.as(ADMINISTRATOR, () =>
      publishedBranches(harness, branchOf([APPROVER, SECOND_APPROVER]), 'eligibility-delegation'),
    );
    const instanceId = await startedOn(harness, process, 'requisition-delegation');

    harness.delegation.grant(APPROVER, OUTSIDER, {
      from: new Date('2020-01-01T00:00:00.000Z'),
      to: new Date('2030-01-01T00:00:00.000Z'),
    });

    const asked = vi.spyOn(harness.delegation, 'activeFor');

    // OUTSIDER is an active delegate of an approver already on this branch, and is added regardless.
    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(true);
    expect(asked).not.toHaveBeenCalled();

    asked.mockRestore();
  });
});

/**
 * The active-membership rule, on the write path (D-16D-12, A).
 *
 * **The command is the authority, and these are the assertions that say so.** A refusal here leaves
 * no step, no timeline entry and no moved tally — and an Identity that cannot answer aborts the whole
 * command rather than arriving at the domain disguised as "not eligible".
 */
describe('an approver Identity says may not act', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();

    const process = await harness.as(ADMINISTRATOR, () =>
      publishedBranches(harness, branchOf([APPROVER, SECOND_APPROVER]), 'eligibility-active'),
    );

    instanceId = await startedOn(harness, process, 'requisition-active');
  });

  const detail = () =>
    harness.as(ADMINISTRATOR, () =>
      ask<{
        steps: readonly unknown[];
        tallies?: readonly { assigned: number; outstanding: number }[];
      }>(harness, { queryName: 'workflow.read-instance', instanceId }),
    );

  const timeline = () =>
    harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );

  it('refuses by the approved single name', async () => {
    harness.membershipStanding.inactiveFor(OUTSIDER);

    expect(failureOf(await escalate(harness, instanceId, OUTSIDER))).toBe(
      'workflow.rejection.escalation-approver-not-eligible',
    );
  });

  it('admits somebody Identity says may act', async () => {
    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(true);
  });

  /** A refusal writes nothing at all — no step, no entry, and the branch is exactly what it was. */
  it('writes no step, no history and moves no tally', async () => {
    harness.membershipStanding.inactiveFor(OUTSIDER);

    const before = await detail();

    expect((await escalate(harness, instanceId, OUTSIDER)).ok).toBe(false);

    const after = await detail();
    const events = (await timeline()).items.map((item) => item.event);

    expect(after.steps).toHaveLength(before.steps.length);
    expect(after.tallies?.[0]).toStrictEqual(before.tallies?.[0]);
    expect(events).not.toContain('step-escalated');
  });

  /**
   * **Exactly one Identity read, for exactly the membership named.**
   *
   * Not for the approvers already on the branch, not for the requester, and not twice. The budget is
   * asserted as a whole array rather than a length, so a second read of the same person would fail
   * as visibly as a read of somebody else.
   */
  it('asks Identity once, about the person being added and nobody else', async () => {
    await escalate(harness, instanceId, OUTSIDER);

    expect(harness.membershipStanding.asked).toStrictEqual([OUTSIDER]);
  });

  /**
   * Still exactly one read when some other rule is the one that refuses.
   *
   * `escalateBranch` is pure, so its inputs are gathered before it runs and the read is
   * unconditional — the alternative would be a second copy of the branch rules in the handler,
   * deciding whether to ask. What must not happen is the read multiplying, or reaching anybody other
   * than the person named, and that is what this asserts on the path where the domain refuses for a
   * different reason entirely.
   */
  it('still asks exactly once, about only the named person, when another rule refuses', async () => {
    expect(failureOf(await escalate(harness, instanceId, APPROVER))).toBe(
      'workflow.rejection.escalation-approver-already-assigned',
    );
    expect(harness.membershipStanding.asked).toStrictEqual([APPROVER]);
  });
});

describe('when Identity cannot answer', () => {
  let harness: Harness;
  let instanceId: string;

  beforeEach(async () => {
    harness = harnessFor();

    const process = await harness.as(ADMINISTRATOR, () =>
      publishedBranches(harness, branchOf([APPROVER, SECOND_APPROVER]), 'eligibility-outage'),
    );

    instanceId = await startedOn(harness, process, 'requisition-outage');
  });

  /**
   * **It raises. It is not a refusal and it is not "not eligible".**
   *
   * The one case where a wrong choice fails open in one direction and silently in the other: treating
   * an outage as ineligible would refuse every escalation in the tenant while telling each
   * administrator to inspect a membership that is perfectly fine.
   */
  it('raises rather than refusing', async () => {
    harness.membershipStanding.failsWith(new Error('identity unavailable'));

    await expect(escalate(harness, instanceId, OUTSIDER)).rejects.toThrow('identity unavailable');
  });

  /** And nothing was written on the way out. */
  it('commits no step and no timeline entry', async () => {
    harness.membershipStanding.failsWith(new Error('identity unavailable'));

    await expect(escalate(harness, instanceId, OUTSIDER)).rejects.toThrow();

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
