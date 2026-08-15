import { describe, expect, it } from 'vitest';

import { workflowModule } from './workflow-module.js';
import type { ApprovalDelivery } from './workflow-ports.js';
import { inMemoryWorkflowStores } from './in-memory-stores.js';
import { ALL_WORKFLOW_PERMISSIONS, WorkflowPermissions } from './workflow-permissions.js';
import {
  APPROVER,
  ADMINISTRATOR,
  FixedClock,
  FakeDelegation,
  NOW,
  TENANT,
  attempt,
  attemptAsk,
  failureOf,
  harnessFor,
} from './workflow-test-harness.js';
import { runningApproval } from './workflow-scenarios.js';

/**
 * Every handler, opened by exactly one permission.
 *
 * The method is the one Phase 15 used and the one that actually catches a mistake: for each handler,
 * grant the caller **every Workflow permission except its own** and assert a refusal. A suite that
 * granted nothing would pass for a handler whose declared permission was a typo, because a caller
 * holding nothing is refused by every handler equally.
 *
 * The table is built from the module's own registration rather than typed out again, so a handler
 * added without a permission fails here rather than shipping.
 */

const dependenciesFor = (granted: readonly string[]) => ({
  unitOfWork: {
    execute: <TResult>(work: (transaction: never) => Promise<TResult>): Promise<TResult> =>
      work(undefined as never),
  },
  stores: inMemoryWorkflowStores(),
  delegation: new FakeDelegation(),
  businessDecision: {
    apply: (): Promise<ApprovalDelivery> => Promise.resolve({ kind: 'not-adopted' }),
  },
  permissions: { holds: (permission: string) => Promise.resolve(granted.includes(permission)) },
  clock: new FixedClock(NOW),
});

describe('every Workflow handler declares a permission', () => {
  const module = workflowModule(dependenciesFor(ALL_WORKFLOW_PERMISSIONS));

  it('registers nine commands and eight queries, each with one', () => {
    expect(module.commands).toHaveLength(9);
    expect(module.queries).toHaveLength(8);

    const declared = [
      ...(module.commands ?? []).map((handler) => handler.permission),
      ...(module.queries ?? []).map((handler) => handler.permission),
    ];

    expect(declared.filter((permission) => permission === undefined)).toStrictEqual([]);
    // No wildcard, no prefix, no permission from another module.
    for (const permission of declared) {
      expect(permission.startsWith('workflow.')).toBe(true);
      expect(permission).not.toContain('*');
      expect([...ALL_WORKFLOW_PERMISSIONS]).toContain(permission);
    }
  });

  it('publishes exactly the seven permissions it declares, and no more', () => {
    expect([...ALL_WORKFLOW_PERMISSIONS].sort()).toStrictEqual(
      [
        'workflow.approval.decide',
        'workflow.approval.read-own',
        'workflow.definition.manage',
        'workflow.definition.read',
        'workflow.instance.cancel',
        'workflow.instance.read',
        'workflow.instance.start',
      ].sort(),
    );
    expect(module.permissions).toStrictEqual(ALL_WORKFLOW_PERMISSIONS);
  });

  it('names no role, group or manager permission', () => {
    for (const permission of ALL_WORKFLOW_PERMISSIONS) {
      expect(permission).not.toMatch(/role|group|manager|team/i);
    }
  });
});

describe('holding every other permission opens nothing', () => {
  /** One dispatch per handler, with a body good enough to reach the permission check. */
  const attempts: readonly (readonly [string, string, Record<string, unknown>])[] = [
    [
      'workflow.create-definition',
      WorkflowPermissions.definitionManage,
      {
        commandName: 'workflow.create-definition',
        code: 'x',
        name: { en: 'x', ar: 'x' },
        subjectType: 'a.b',
      },
    ],
    [
      'workflow.retire-definition',
      WorkflowPermissions.definitionManage,
      { commandName: 'workflow.retire-definition', definitionId: 'd', expectedVersion: 1 },
    ],
    [
      'workflow.draft-version',
      WorkflowPermissions.definitionManage,
      { commandName: 'workflow.draft-version', definitionId: 'd' },
    ],
    [
      'workflow.add-step',
      WorkflowPermissions.definitionManage,
      {
        commandName: 'workflow.add-step',
        workflowVersionId: 'v',
        ordinal: 1,
        name: { en: 'x', ar: 'x' },
        approverMembershipId: APPROVER,
      },
    ],
    [
      'workflow.publish-version',
      WorkflowPermissions.definitionManage,
      { commandName: 'workflow.publish-version', workflowVersionId: 'v', expectedVersion: 1 },
    ],
    [
      'workflow.archive-version',
      WorkflowPermissions.definitionManage,
      { commandName: 'workflow.archive-version', workflowVersionId: 'v', expectedVersion: 1 },
    ],
    [
      'workflow.start-instance',
      WorkflowPermissions.instanceStart,
      {
        commandName: 'workflow.start-instance',
        definitionId: 'd',
        subjectType: 'a.b',
        subjectId: 's',
      },
    ],
    [
      'workflow.decide-step',
      WorkflowPermissions.approvalDecide,
      {
        commandName: 'workflow.decide-step',
        instanceId: 'i',
        decision: 'approved',
        expectedVersion: 1,
      },
    ],
    [
      'workflow.cancel-instance',
      WorkflowPermissions.instanceCancel,
      { commandName: 'workflow.cancel-instance', instanceId: 'i', reason: 'x', expectedVersion: 1 },
    ],
  ];

  for (const [name, required, command] of attempts) {
    it(`${name} refuses a caller holding every permission but ${required}`, async () => {
      const harness = harnessFor({
        permissions: ALL_WORKFLOW_PERMISSIONS.filter((permission) => permission !== required),
      });
      const refused = await harness.as(ADMINISTRATOR, () => attempt(harness, command));

      expect(failureOf(refused)).toBe(`forbidden:${required}`);
    });
  }

  const queries: readonly (readonly [string, string, Record<string, unknown>])[] = [
    [
      'workflow.search-definitions',
      WorkflowPermissions.definitionRead,
      { queryName: 'workflow.search-definitions' },
    ],
    [
      'workflow.read-definition',
      WorkflowPermissions.definitionRead,
      { queryName: 'workflow.read-definition', definitionId: 'd' },
    ],
    [
      'workflow.search-instances',
      WorkflowPermissions.instanceRead,
      { queryName: 'workflow.search-instances' },
    ],
    [
      'workflow.read-instance',
      WorkflowPermissions.instanceRead,
      { queryName: 'workflow.read-instance', instanceId: 'i' },
    ],
    [
      'workflow.read-history',
      WorkflowPermissions.instanceRead,
      { queryName: 'workflow.read-history', instanceId: 'i' },
    ],
    [
      'workflow.read-approval-status',
      WorkflowPermissions.instanceRead,
      { queryName: 'workflow.read-approval-status', approvalId: 'i' },
    ],
    [
      'workflow.pending-approvals',
      WorkflowPermissions.approvalReadOwn,
      { queryName: 'workflow.pending-approvals' },
    ],
    [
      'workflow.decided-approvals',
      WorkflowPermissions.approvalReadOwn,
      { queryName: 'workflow.decided-approvals' },
    ],
  ];

  for (const [name, required, query] of queries) {
    it(`${name} refuses a caller holding every permission but ${required}`, async () => {
      const harness = harnessFor({
        permissions: ALL_WORKFLOW_PERMISSIONS.filter((permission) => permission !== required),
      });
      const refused = await harness.as(ADMINISTRATOR, () => attemptAsk(harness, query));

      expect(failureOf(refused)).toBe(`forbidden:${required}`);
    });
  }
});

describe('the separations that matter', () => {
  it('does not let a caller who may start an approval cancel one', async () => {
    // Raising a request and ending somebody else's mid-flight are different acts, and the second is
    // the one that stops a decision from ever being made.
    const harness = harnessFor();
    const running = await runningApproval(harness, [APPROVER]);
    const restricted = harnessFor({
      permissions: [WorkflowPermissions.instanceStart, WorkflowPermissions.instanceRead],
    });
    const refused = await restricted.as(ADMINISTRATOR, () =>
      attempt(restricted, {
        commandName: 'workflow.cancel-instance',
        instanceId: running.instanceId,
        reason: 'x',
        expectedVersion: 1,
      }),
    );

    expect(failureOf(refused)).toBe(`forbidden:${WorkflowPermissions.instanceCancel}`);
  });

  it('does not let a caller who may read approvals decide one', async () => {
    const harness = harnessFor({
      permissions: [WorkflowPermissions.instanceRead, WorkflowPermissions.approvalReadOwn],
    });
    const refused = await harness.as(APPROVER, () =>
      attempt(harness, {
        commandName: 'workflow.decide-step',
        instanceId: 'i',
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

    expect(failureOf(refused)).toBe(`forbidden:${WorkflowPermissions.approvalDecide}`);
  });

  it('refuses everything to a caller holding nothing, including the queue', async () => {
    const harness = harnessFor({ permissions: [] });

    expect(
      failureOf(
        await harness.as(APPROVER, () =>
          attemptAsk(harness, { queryName: 'workflow.pending-approvals' }),
        ),
      ),
    ).toBe(`forbidden:${WorkflowPermissions.approvalReadOwn}`);
  });

  it('runs no handler at all outside a tenant context', async () => {
    const harness = harnessFor();
    const outside = await harness.dispatcher
      .ask({ queryName: 'workflow.search-definitions' } as never)
      .then(() => 'accepted')
      .catch((error: unknown) => (error instanceof Error ? error.message : 'unknown'));

    expect(outside).toMatch(/tenant/i);
    expect(TENANT).toBeDefined();
  });
});
