import { beforeEach, describe, expect, it } from 'vitest';

import { ALL_WORKFLOW_PERMISSIONS, WorkflowPermissions } from './workflow-permissions.js';
import { DEFAULT_DISCOVERY_PAGE, MAXIMUM_DISCOVERY_PAGE } from './due-reminders.query.js';
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
 * `workflow.due-reminders` — which steps a job runner should be handed, and which it must not be.
 *
 * The eligibility half of this suite is the same question the domain suite asks, asked through the
 * store instead of the pure function. That duplication is deliberate and is the point of §13: the
 * query and the command must agree at the boundary, and the only way to know they do is to ask both.
 *
 * The other half is about what a discovery query must never become — a directory of people, an
 * unbounded sweep, or something a human principal can reach.
 */

const THREE_HOURS = 3 * 60 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

interface Due {
  readonly instanceId: string;
  readonly stepId: string;
}

const overdueApproval = async (
  harness: Harness,
  subjectId = 'requisition-1',
): Promise<{ instanceId: string; stepId: string }> => {
  const process = await publishedBranches(
    harness,
    [{ ordinal: 1, approverMembershipId: APPROVER, serviceLevel: { count: 2, unit: 'hours' } }],
    `approval-${subjectId}`,
  );
  const started = await harness.as(REQUESTER, () =>
    send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: process.definitionId,
      subjectType: SUBJECT_TYPE,
      subjectId,
    }),
  );
  const page = await harness.as(REQUESTER, () =>
    ask<{ items: readonly { event: string; stepId?: string }[] }>(harness, {
      queryName: 'workflow.read-history',
      instanceId: started.instanceId,
    }),
  );
  const awaiting = page.items.find((entry) => entry.event === 'step-awaiting');

  if (awaiting?.stepId === undefined) throw new Error('the scenario produced no awaiting step');
  return { instanceId: started.instanceId, stepId: awaiting.stepId };
};

/** The discovery query, as a machine makes it. */
const discover = (
  harness: Harness,
  asAt: Date,
  extra: Record<string, unknown> = {},
): Promise<{ items: readonly Due[]; hasMore: boolean; nextCursor?: string }> =>
  harness.asMachine(() =>
    ask<{ items: readonly Due[]; hasMore: boolean; nextCursor?: string }>(harness, {
      queryName: 'workflow.due-reminders',
      asAt,
      ...extra,
    }),
  );

describe('which steps are discovered', () => {
  let harness: Harness;
  let ids: { instanceId: string; stepId: string };

  beforeEach(async () => {
    harness = harnessFor();
    ids = await overdueApproval(harness);
  });

  it('includes a running, awaiting step whose target has passed', async () => {
    const found = await discover(harness, new Date(NOW.getTime() + THREE_HOURS));

    expect(found.items).toStrictEqual([{ instanceId: ids.instanceId, stepId: ids.stepId }]);
  });

  /**
   * The boundary, from both sides of one millisecond — the assertion §13 asks for.
   *
   * `>` and not `>=`, matching `serviceLevelState` and therefore matching the command. A candidate
   * offered at exactly the due instant would be refused by the very command it was offered to, which
   * is the drift this test exists to prevent.
   */
  it('excludes a step at exactly the due instant, and includes it one millisecond later', async () => {
    const due = new Date(NOW.getTime() + TWO_HOURS);

    expect((await discover(harness, new Date(due.getTime() - 1))).items).toStrictEqual([]);
    expect((await discover(harness, due)).items).toStrictEqual([]);
    expect((await discover(harness, new Date(due.getTime() + 1))).items).toHaveLength(1);
  });

  it('excludes a step with no service level', async () => {
    const bare = harnessFor();
    const process = await publishedBranches(bare, [{ ordinal: 1, approverMembershipId: APPROVER }]);

    await bare.as(REQUESTER, () =>
      send(bare, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-1',
      }),
    );

    expect((await discover(bare, new Date(NOW.getTime() + THREE_HOURS))).items).toStrictEqual([]);
  });

  it('excludes a step whose instance is no longer running', async () => {
    await harness.as(REQUESTER, () =>
      send(harness, {
        commandName: 'workflow.cancel-instance',
        instanceId: ids.instanceId,
        reason: 'no longer needed',
        expectedVersion: 1,
      }),
    );

    expect((await discover(harness, new Date(NOW.getTime() + THREE_HOURS))).items).toStrictEqual(
      [],
    );
  });

  it('excludes a step that is no longer awaiting', async () => {
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'workflow.decide-step',
        instanceId: ids.instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect((await discover(harness, new Date(NOW.getTime() + THREE_HOURS))).items).toStrictEqual(
      [],
    );
  });

  /**
   * Already reminded, so not offered again — an optimisation, **not** the guarantee.
   *
   * The database decides who wins; this only avoids handing a runner work that is certainly done.
   * The companion assertion below says so from the other direction.
   */
  it('excludes a step that has already been reminded', async () => {
    harness.clock.advanceTo(new Date(NOW.getTime() + THREE_HOURS));
    await harness.asMachine(() =>
      attempt(harness, {
        commandName: 'workflow.remind-step',
        instanceId: ids.instanceId,
        stepId: ids.stepId,
      }),
    );

    expect((await discover(harness, new Date(NOW.getTime() + THREE_HOURS))).items).toStrictEqual(
      [],
    );
  });
});

describe('discovery is a narrowing, not an authority', () => {
  /**
   * **Two runners may discover the same step, and that is correct.**
   *
   * If this ever started refusing the second reader, somebody would have moved the guarantee out of
   * the database and into a read — which is the mistake ADR-0071 exists to prevent. The command is
   * where duplication is stopped, and the integration suite proves that half against a real index.
   */
  it('offers the same candidate to two separate reads', async () => {
    const harness = harnessFor();
    const ids = await overdueApproval(harness);
    const asAt = new Date(NOW.getTime() + THREE_HOURS);

    const first = await discover(harness, asAt);
    const second = await discover(harness, asAt);

    expect(first.items).toStrictEqual(second.items);
    expect(first.items[0]?.stepId).toBe(ids.stepId);
  });
});

describe('what the answer carries', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = harnessFor();
    await overdueApproval(harness);
  });

  it('returns two identifiers and nothing else', async () => {
    const [item] = (await discover(harness, new Date(NOW.getTime() + THREE_HOURS))).items;

    expect(Object.keys(item ?? {}).sort()).toStrictEqual(['instanceId', 'stepId']);
  });

  /**
   * **No person, under any spelling** — the assertion that keeps D-16D-16 closed.
   *
   * A discovery query that returned the approver would be a directory with a schedule attached to it.
   * The recipient is resolved later, separately, from the step the command re-reads.
   */
  it('names nobody, and no tenant', async () => {
    const found = await discover(harness, new Date(NOW.getTime() + THREE_HOURS));
    const body = JSON.stringify(found.items);

    for (const leaked of [
      'approver',
      'membership',
      'workforce',
      'user',
      'manager',
      'requester',
      'delegat',
      'tenant',
      'permission',
      'actor',
      'profile',
      'email',
      'serviceLevel',
      'awaitingAt',
      'status',
    ]) {
      expect([leaked, body.toLowerCase().includes(leaked.toLowerCase())]).toStrictEqual([
        leaked,
        false,
      ]);
    }
  });
});

describe('who may discover', () => {
  const asAt = new Date(NOW.getTime() + THREE_HOURS);

  it('admits a machine holding workflow.reminder.execute', async () => {
    const harness = harnessFor({ permissions: [WorkflowPermissions.reminderExecute] });

    await overdueApproval(harnessFor());
    expect((await discover(harness, asAt)).items).toBeDefined();
  });

  /**
   * Every other Workflow permission, one at a time, and none of them opens it.
   *
   * Driven off `ALL_WORKFLOW_PERMISSIONS` so a permission added later is covered the day it exists.
   * This is what stops the discovery query becoming a read a human administrator can make.
   */
  it.each(
    ALL_WORKFLOW_PERMISSIONS.filter(
      (permission) => permission !== WorkflowPermissions.reminderExecute,
    ),
  )('is not opened by %s alone', async (permission) => {
    const harness = harnessFor({ permissions: [permission] });

    const outcome = await harness.asMachine(() =>
      attempt(harness, { queryName: 'workflow.due-reminders', asAt }),
    );

    expect(outcome.ok).toBe(false);
  });

  it.each(['*', 'workflow.*', 'workflow.reminder.*', 'workflow.reminder'])(
    'is not opened by %s',
    async (pretender) => {
      const harness = harnessFor({ permissions: [pretender] });

      const outcome = await harness.asMachine(() =>
        attempt(harness, { queryName: 'workflow.due-reminders', asAt }),
      );

      expect(outcome.ok).toBe(false);
    },
  );

  /** And it added no permission: the vocabulary is the same length Phase 16E left it. */
  it('registers no new permission', () => {
    expect(ALL_WORKFLOW_PERMISSIONS).toHaveLength(11);
    expect(ALL_WORKFLOW_PERMISSIONS.filter((p) => p.includes('discover'))).toStrictEqual([]);
    expect(ALL_WORKFLOW_PERMISSIONS.filter((p) => p.includes('scheduler'))).toStrictEqual([]);
    expect(ALL_WORKFLOW_PERMISSIONS.filter((p) => p.includes('automation'))).toStrictEqual([]);
  });
});

describe('machine semantics', () => {
  /**
   * A machine holds no membership, and this query never asks for one.
   *
   * `pending-approvals` cannot be used by a runner precisely because it resolves from the caller's
   * membership. This one takes no identifier at all, which is why it can be.
   */
  it('needs no membership, and fabricates none', async () => {
    const harness = harnessFor();
    const ids = await overdueApproval(harness);

    const found = await discover(harness, new Date(NOW.getTime() + THREE_HOURS));

    expect(found.items[0]?.stepId).toBe(ids.stepId);
  });
});

describe('bounds', () => {
  it('clamps a request above the maximum to the maximum', () => {
    expect(MAXIMUM_DISCOVERY_PAGE).toBe(200);
    expect(DEFAULT_DISCOVERY_PAGE).toBeLessThan(MAXIMUM_DISCOVERY_PAGE);
  });

  it('never returns more than the requested size', async () => {
    const harness = harnessFor();

    for (const subject of ['a', 'b', 'c']) await overdueApproval(harness, subject);

    const found = await discover(harness, new Date(NOW.getTime() + THREE_HOURS), { size: 2 });

    expect(found.items).toHaveLength(2);
    expect(found.hasMore).toBe(true);
    expect(found.nextCursor).toBe(found.items[1]?.stepId);
  });

  /**
   * A continuation that neither repeats a candidate nor skips one.
   *
   * The reason the cursor is the step's own identifier rather than an offset: a discovery loop runs
   * against a table being written to, and an offset shifts underneath it.
   */
  it('continues without duplicating or skipping', async () => {
    const harness = harnessFor();

    for (const subject of ['a', 'b', 'c']) await overdueApproval(harness, subject);

    const asAt = new Date(NOW.getTime() + THREE_HOURS);
    const first = await discover(harness, asAt, { size: 2 });
    const second = await discover(harness, asAt, { size: 2, cursor: first.nextCursor });
    const seen = [...first.items, ...second.items].map((item) => item.stepId);

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
    expect(second.hasMore).toBe(false);
  });

  it('orders deterministically, so two reads agree', async () => {
    const harness = harnessFor();

    for (const subject of ['a', 'b', 'c']) await overdueApproval(harness, subject);

    const asAt = new Date(NOW.getTime() + THREE_HOURS);

    expect((await discover(harness, asAt)).items).toStrictEqual(
      (await discover(harness, asAt)).items,
    );
  });
});
