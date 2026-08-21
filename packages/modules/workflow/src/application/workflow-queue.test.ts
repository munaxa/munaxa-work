import { beforeEach, describe, expect, it } from 'vitest';

import type { PendingApprovalView } from '../contracts/execution-views.js';
import { approveAs, runningApproval } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  NOW,
  OTHER_TENANT,
  OUTSIDER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  ask,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';
import type { Page } from './workflow-ports.js';

/**
 * "Which approvals are waiting for me" — the first `read-own` in this repository that is routed.
 *
 * Career, Learning, Performance, Leave, Payroll, Attendance, Compensation and Documents each declare
 * one and route it nowhere: a plan or a payslip is about an *employment*, and no principal resolves
 * to one (ADR-0032). An approval is addressed to a **membership**, which the request resolves before
 * any handler runs — so this query is answerable without accepting one identifier from the caller.
 *
 * **The control is an absence.** There is no `membershipId` parameter to default, to validate or to
 * forget to validate. Every assertion below is reached by changing *who is asking*, never by
 * changing what was asked.
 */

const queueOf = (harness: Harness, membership: string): Promise<Page<PendingApprovalView>> =>
  harness.as(membership, () =>
    ask<Page<PendingApprovalView>>(harness, { queryName: 'workflow.pending-approvals' }),
  );

describe('the caller’s own approval queue', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('shows the caller the step they are being asked to decide', async () => {
    const running = await runningApproval(harness, [APPROVER], 'requisition-mine');
    const queue = await queueOf(harness, APPROVER);

    expect(queue.total).toBe(1);
    expect(queue.items[0]?.instanceId).toBe(running.instanceId);
    expect(queue.items[0]?.subjectId).toBe('requisition-mine');
    expect(queue.items[0]?.ordinal).toBe(1);
  });

  it('shows a later approver nothing until the approval reaches them', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    expect((await queueOf(harness, SECOND_APPROVER)).total).toBe(0);

    await approveAs(harness, APPROVER, running.instanceId);

    // The queue moves with the approval, because it is a read over awaiting steps rather than a
    // table something has to keep current.
    expect((await queueOf(harness, SECOND_APPROVER)).total).toBe(1);
    expect((await queueOf(harness, APPROVER)).total).toBe(0);
  });

  it('shows one member nothing of another member’s queue', async () => {
    await runningApproval(harness, [APPROVER], 'requisition-theirs');

    expect((await queueOf(harness, OUTSIDER)).total).toBe(0);
    expect((await queueOf(harness, DEPUTY)).total).toBe(0);
  });

  it('accepts no identifier through which a caller could ask for somebody else’s queue', async () => {
    await runningApproval(harness, [APPROVER], 'requisition-idor');

    // Sending one anyway changes nothing: the handler reads the context and the extra field is not
    // part of the query. This is the assertion that would fail the day somebody adds a filter.
    const attempted = await harness.as(OUTSIDER, () =>
      ask<Page<PendingApprovalView>>(harness, {
        queryName: 'workflow.pending-approvals',
        membershipId: APPROVER,
        approverMembershipId: APPROVER,
      }),
    );

    expect(attempted.total).toBe(0);
  });

  it('answers a caller with no membership with nothing, rather than with everything', async () => {
    await runningApproval(harness, [APPROVER], 'requisition-anonymous');

    const queue = await harness.withoutMembership(() =>
      ask<Page<PendingApprovalView>>(harness, { queryName: 'workflow.pending-approvals' }),
    );

    // "We do not know which member you are" has exactly one safe answer.
    expect(queue).toStrictEqual({ items: [], total: 0 });
  });

  it('empties when the approval ends', async () => {
    const running = await runningApproval(harness, [APPROVER], 'requisition-ending');

    await approveAs(harness, APPROVER, running.instanceId);
    expect((await queueOf(harness, APPROVER)).total).toBe(0);
  });

  it('empties when the approval is cancelled, leaving no orphaned queue entry', async () => {
    const running = await runningApproval(harness, [APPROVER], 'requisition-cancelled');

    await ask(harness, { queryName: 'workflow.read-instance', instanceId: running.instanceId });
    await harness.as(APPROVER, () => ask(harness, { queryName: 'workflow.pending-approvals' }));

    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 1,
    });

    // A step still reading `pending` on a finished approval would be work somebody thinks they owe.
    expect((await queueOf(harness, APPROVER)).total).toBe(0);
  });

  it('carries the subject and the definition code, because identifiers alone are not actionable', async () => {
    await runningApproval(harness, [APPROVER], 'requisition-labelled');

    const [row] = (await queueOf(harness, APPROVER)).items;

    expect(row?.subjectType).toBe(SUBJECT_TYPE);
    expect(row?.definitionCode).toBe('approval-requisition-labelled');
    expect(row?.startedOn).toBe(NOW.toISOString());
    // The version a decision will be issued against, so the screen need not read the step again.
    expect(row?.version).toBe(1);
  });

  it('keeps two tenants apart even when the same membership identifier appears in both', async () => {
    // The identifiers other modules mint are not globally unique to a tenant's data, and a queue
    // keyed only on a membership would show one company's approvals to another's.
    const other = harnessFor({ tenantId: OTHER_TENANT });

    await runningApproval(harness, [APPROVER], 'requisition-a');
    await runningApproval(other, [APPROVER], 'requisition-b');

    const mine = await queueOf(harness, APPROVER);
    const theirs = await other.as(APPROVER, () =>
      ask<Page<PendingApprovalView>>(other, { queryName: 'workflow.pending-approvals' }),
    );

    expect([mine.total, theirs.total]).toStrictEqual([1, 1]);
    expect(mine.items[0]?.subjectId).toBe('requisition-a');
    expect(theirs.items[0]?.subjectId).toBe('requisition-b');
    // Each harness holds its own stores; row-level security is what enforces this in production,
    // and Checkpoint 3 proved it there against two real tenants.
    expect(mine.items[0]?.instanceId).not.toBe(theirs.items[0]?.instanceId);
  });
});

describe('what the caller decided', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('lists the caller’s own decisions and nobody else’s', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);
    await approveAs(harness, SECOND_APPROVER, running.instanceId);

    const first = await harness.as(APPROVER, () =>
      ask<{ total: number; items: readonly { decidedByMembershipId: string }[] }>(harness, {
        queryName: 'workflow.decided-approvals',
      }),
    );

    expect(first.total).toBe(1);
    expect(first.items[0]?.decidedByMembershipId).toBe(APPROVER);
    expect(
      (
        await harness.as(OUTSIDER, () =>
          ask<{ total: number }>(harness, { queryName: 'workflow.decided-approvals' }),
        )
      ).total,
    ).toBe(0);
  });

  it('answers a caller with no membership with nothing', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);

    const decided = await harness.withoutMembership(() =>
      ask<{ items: readonly unknown[]; total: number }>(harness, {
        queryName: 'workflow.decided-approvals',
      }),
    );

    expect(decided).toStrictEqual({ items: [], total: 0 });
  });
});
