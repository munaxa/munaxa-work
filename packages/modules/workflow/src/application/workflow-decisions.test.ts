import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '../contracts/views.js';
import type { HandlerFailure, Result } from '@work/kernel';

import { runningApproval } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  NOW,
  OUTSIDER,
  SECOND_APPROVER,
  ask,
  attempt,
  failureOf,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';

/**
 * Who may decide, on whose authority, and what the record says afterwards.
 *
 * **The caller is the membership on the request.** `workflow.decide-step` carries no approver field,
 * so there is nothing a caller could supply — holding the permission lets you decide *your own*
 * steps rather than any step in the tenant. Every refusal below is reached without the command
 * naming anybody.
 *
 * **Delegation is Identity's answer, asked at the instant of the decision.** The double filters by
 * period and by scope exactly as Identity's aggregate does; an expired arrangement is simply not in
 * what Identity returns, which is why Workflow needs no expiry state and no expiry job.
 */

const hour = (offset: number): Date => new Date(NOW.getTime() + offset * 3_600_000);

const decide = (
  harness: Harness,
  membership: string,
  instanceId: string,
  decision: 'approved' | 'rejected' = 'approved',
): Promise<Result<unknown, HandlerFailure>> =>
  harness.as(membership, () =>
    attempt(harness, {
      commandName: 'workflow.decide-step',
      instanceId,
      decision,
      expectedVersion: 1,
    }),
  );

describe('deciding a step', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('accepts the assigned approver and records them as the actor', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    await decide(harness, APPROVER, running.instanceId);

    const detail = await ask<WorkflowInstanceDetailView>(harness, {
      queryName: 'workflow.read-instance',
      instanceId: running.instanceId,
    });
    const [decision] = detail.decisions;

    expect(decision?.decidedByMembershipId).toBe(APPROVER);
    expect(decision?.authority).toBe('assigned');
    // No delegation was involved, so nothing pretends one was.
    expect(decision?.onBehalfOfMembershipId).toBeUndefined();
  });

  it('refuses somebody who is neither the approver nor a delegate', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    expect(failureOf(await decide(harness, OUTSIDER, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('refuses the approver of a *later* step from answering the current one', async () => {
    // The second approver holds the same permission and is genuinely part of this approval. Being
    // asked later is not being asked now, and the queue is what says so.
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    expect(failureOf(await decide(harness, SECOND_APPROVER, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('refuses a caller whose membership did not resolve', async () => {
    const running = await runningApproval(harness, [APPROVER]);
    const refused = await harness.withoutMembership(() =>
      attempt(harness, {
        commandName: 'workflow.decide-step',
        instanceId: running.instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.membership-unresolved');
  });

  it('keeps the comment on the decision and out of the timeline', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'workflow.decide-step',
        instanceId: running.instanceId,
        decision: 'rejected',
        comment: 'The headcount was not budgeted.',
        expectedVersion: 1,
      }),
    );

    const detail = await ask<WorkflowInstanceDetailView>(harness, {
      queryName: 'workflow.read-instance',
      instanceId: running.instanceId,
    });
    const history = await ask<{ items: readonly unknown[] }>(harness, {
      queryName: 'workflow.read-history',
      instanceId: running.instanceId,
    });

    expect(detail.decisions[0]?.comment).toBe('The headcount was not budgeted.');
    // A rejection comment is one person's written opinion of another's request. It lives where a
    // permission decides who reads it, not in a timeline beside a name.
    expect(JSON.stringify(history.items)).not.toContain('budgeted');
  });
});

describe('a delegated decision', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('is refused when Identity knows of no delegation', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('succeeds under an active delegation, recording the delegate and the authority apart', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) });
    await decide(harness, DEPUTY, running.instanceId);

    const detail = await ask<WorkflowInstanceDetailView>(harness, {
      queryName: 'workflow.read-instance',
      instanceId: running.instanceId,
    });
    const [decision] = detail.decisions;

    // Two identities, two fields. Nobody is impersonated: the deputy decided, using the approver's
    // authority, and the record says both.
    expect(decision?.decidedByMembershipId).toBe(DEPUTY);
    expect(decision?.onBehalfOfMembershipId).toBe(APPROVER);
    expect(decision?.authority).toBe('delegated');
    expect(detail.instance.status).toBe('completed');
  });

  it('is refused once the delegation has elapsed', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-48), to: hour(-1) });
    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('is refused before the delegation begins', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(1), to: hour(48) });
    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('is refused at the exclusive end of the period, and accepted at the inclusive start', async () => {
    // Identity's period is half-open, so two periods never overlap and the boundary belongs to
    // exactly one of them. The double keeps that property rather than approximating it.
    const ending = await runningApproval(harness, [APPROVER], 'requisition-end');

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-24), to: NOW });
    expect(failureOf(await decide(harness, DEPUTY, ending.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );

    const starting = await runningApproval(harness, [APPROVER], 'requisition-start');

    harness.delegation.grant(APPROVER, DEPUTY, { from: NOW, to: hour(24) });
    expect(failureOf(await decide(harness, DEPUTY, starting.instanceId))).toBeUndefined();
  });

  it('is refused once the delegation is revoked, without Workflow storing anything', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) });
    harness.delegation.revokeAll();

    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('is refused when the delegation was granted for something else entirely', async () => {
    // Identity keeps `scope` opaque and lets the consumer agree the key. Workflow's key is its own
    // permission name — so delegating leave approval does not hand over workflow approvals.
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) }, 'leave.approve');
    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('accepts a wildcard delegation', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) }, '*');
    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBeUndefined();
  });

  it('does not let one person’s delegation decide another person’s step', async () => {
    // The deputy genuinely acts for `APPROVER`. The step in front of them belongs to
    // `SECOND_APPROVER`, and holding somebody else's authority is not holding theirs.
    const running = await runningApproval(harness, [SECOND_APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) });
    expect(failureOf(await decide(harness, DEPUTY, running.instanceId))).toBe(
      'workflow.rejection.decision-not-the-assigned-approver',
    );
  });

  it('shows the decision in the delegate’s own record and not in the approver’s', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    harness.delegation.grant(APPROVER, DEPUTY, { from: hour(-1), to: hour(24) });
    await decide(harness, DEPUTY, running.instanceId);

    const deputys = await harness.as(DEPUTY, () =>
      ask<{ total: number }>(harness, { queryName: 'workflow.decided-approvals' }),
    );
    const approvers = await harness.as(APPROVER, () =>
      ask<{ total: number }>(harness, { queryName: 'workflow.decided-approvals' }),
    );

    // The deputy decided it. The approver's authority was used and the approver did not act.
    expect([deputys.total, approvers.total]).toStrictEqual([1, 0]);
  });
});
