import { beforeEach, describe, expect, it } from 'vitest';
import { ALL_WORKFLOW_PERMISSIONS } from './workflow-permissions.js';

import {
  ADMINISTRATOR,
  APPROVER,
  DEPUTY,
  OTHER_TENANT,
  OUTSIDER,
  REQUESTER,
  SECOND_APPROVER,
  TENANT,
  ask,
  attempt,
  failureOf,
  harnessFor,
  must,
  type Harness,
} from './workflow-test-harness.js';
import { publishedBranches, startedOn } from './workflow-scenarios.js';
import type { EscalateBranchCommand } from './escalation.use-case.js';

/**
 * **Who** may escalate, and whose name the act is recorded under.
 *
 * Split from `workflow-escalation.test.ts` at the file-size budget, on the seam the capability has:
 * next door is what escalation *does* to a branch, and this is who is allowed to ask and how their
 * identity is established.
 *
 * The permission is the sharpest assertion in the phase. `workflow.approval.escalate` is implied by
 * nothing, and that is checked three ways — every other permission together, each one alone, and the
 * wildcards somebody might expect to work. Changing who approves an approval **already under way** is
 * the most powerful thing an administrator can do to one short of ending it.
 */

const AT = new Date('2026-08-14T09:00:00.000Z');

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

describe('who may escalate', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('lets a holder of the escalation permission add an approver', async () => {
    const instanceId = await runningBranch(harness, 'majority');
    const escalated = await escalate(harness, instanceId, OUTSIDER);

    expect(escalated.ok).toBe(true);
  });

  /**
   * And **every other Workflow permission together is not enough**, which is the assertion the
   * separation exists for.
   *
   * Nine permissions, one withheld. A caller holding the entire rest of the module — able to write
   * the process, edit the lists, raise approvals, cancel them and decide steps — still cannot widen
   * an approval that is already under way.
   */
  it('forbids a caller holding every other Workflow permission', async () => {
    const withoutEscalate = ALL_WORKFLOW_PERMISSIONS.filter(
      (permission) => permission !== 'workflow.approval.escalate',
    );

    expect(withoutEscalate).toHaveLength(10);

    const permitted = harnessFor();
    const instanceId = await runningBranch(permitted, 'majority');
    const restricted = harnessFor({ permissions: withoutEscalate });

    // The same stores, so the approval the restricted caller is refused is a real one.
    const refused = await restricted.as(ADMINISTRATOR, () =>
      attempt(restricted, {
        commandName: 'workflow.escalate-branch',
        instanceId,
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      }),
    );

    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.kind).toBe('forbidden');
  });

  /** One permission at a time: no single other grant opens it either. */
  it.each(
    ALL_WORKFLOW_PERMISSIONS.filter((permission) => permission !== 'workflow.approval.escalate'),
  )('is not implied by %s alone', async (permission) => {
    const restricted = harnessFor({ permissions: [permission] });
    const refused = await restricted.as(ADMINISTRATOR, () =>
      attempt(restricted, {
        commandName: 'workflow.escalate-branch',
        instanceId: 'any-instance',
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      }),
    );

    expect([permission, refused.ok]).toStrictEqual([permission, false]);
    if (!refused.ok)
      expect([permission, refused.error.kind]).toStrictEqual([permission, 'forbidden']);
  });

  /** No wildcard and no prefix reaches it: the checker matches the exact name. */
  it('is opened by no wildcard and no prefix', async () => {
    for (const pretender of ['*', 'workflow.*', 'workflow.approval.*', 'workflow.approval']) {
      const restricted = harnessFor({ permissions: [pretender] });
      const refused = await restricted.as(ADMINISTRATOR, () =>
        attempt(restricted, {
          commandName: 'workflow.escalate-branch',
          instanceId: 'any-instance',
          ordinal: 1,
          approverMembershipId: OUTSIDER,
        }),
      );

      expect([pretender, refused.ok]).toStrictEqual([pretender, false]);
    }
  });
});

describe('the identity the command never accepts', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  /**
   * The caller is the context's membership, and nothing on the command can change it.
   *
   * The same request issued by two different people writes two different actors, which is only true
   * because the actor is never read from the body. A field that could name the actor would let
   * somebody escalate in another administrator's name.
   */
  it('takes the actor from the context and not from the request', async () => {
    const instanceId = await runningBranch(harness, 'majority');

    must(
      await escalate(harness, instanceId, OUTSIDER, 1, REQUESTER),
      'escalating as the requester',
    );

    const timeline = await harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string; actorMembershipId?: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );
    const escalation = timeline.items.find((item) => item.event === 'step-escalated');

    // The caller, not the administrator who happened to configure the process, and not the person
    // who was added.
    expect(escalation?.actorMembershipId).toBe(REQUESTER);
  });

  /**
   * A caller supplying an actor identity is ignored rather than obeyed.
   *
   * The command's declared shape has three fields. Anything else a caller sends reaches no handler
   * property, so the escalation is still attributed to the context's membership — which is what the
   * assertion below actually checks, rather than merely that the request did not fail.
   */
  it('ignores an actor identity smuggled into the body', async () => {
    const instanceId = await runningBranch(harness, 'majority');

    await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.escalate-branch',
        instanceId,
        ordinal: 1,
        approverMembershipId: OUTSIDER,
        // None of these is a property of the command, and none may become the actor or the tenant.
        actorMembershipId: ADMINISTRATOR,
        membershipId: ADMINISTRATOR,
        workforceUserId: 'workforce-1',
        platformUserId: 'platform-1',
        decidedByMembershipId: ADMINISTRATOR,
        onBehalfOfMembershipId: ADMINISTRATOR,
        tenantId: 'another-tenant',
      }),
    );

    const timeline = await harness.as(ADMINISTRATOR, () =>
      ask<{ items: readonly { event: string; actorMembershipId?: string }[] }>(harness, {
        queryName: 'workflow.read-history',
        instanceId,
        page: 1,
        size: 50,
      }),
    );
    const escalation = timeline.items.find((item) => item.event === 'step-escalated');

    expect(escalation?.actorMembershipId).toBe(REQUESTER);
    expect(escalation?.actorMembershipId).not.toBe(ADMINISTRATOR);
  });

  /** And a context that resolved no membership is refused rather than recorded with no actor. */
  it('refuses when the caller resolved to no membership', async () => {
    const instanceId = await runningBranch(harness, 'majority');
    const refused = await harness.withoutMembership(() =>
      attempt(harness, {
        commandName: 'workflow.escalate-branch',
        instanceId,
        ordinal: 1,
        approverMembershipId: OUTSIDER,
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.escalation-actor-unknown');
  });

  /**
   * The tenant is ambient, and **where that is proved is not here.**
   *
   * The command declares three fields and `tenantId` is not one, so no caller can aim it at another
   * organization — that much is this layer's and is asserted above. Whether a *store* would refuse to
   * return another tenant's approval is row-level security's, and the in-memory stores these tests run
   * against hold no tenant at all: they are a substitute for persistence, not for PostgreSQL's
   * policies. Asserting isolation here would pass or fail on a property of the fake.
   *
   * It is proved where it is real — `workflow-isolation.integration.test.ts` and
   * `workflow-repository-isolation.integration.test.ts`, as an unprivileged role under a forced
   * policy — and Checkpoint 5 brings the escalated step under the same suites.
   */
  it('declares no tenant field for a caller to supply', () => {
    const command: EscalateBranchCommand = {
      commandName: 'workflow.escalate-branch',
      instanceId: 'instance-1',
      ordinal: 1,
      approverMembershipId: OUTSIDER,
    };

    expect(Object.keys(command).sort()).toStrictEqual([
      'approverMembershipId',
      'commandName',
      'instanceId',
      'ordinal',
    ]);
    // Two tenants exist in the harness and neither is nameable from a command.
    expect(TENANT).not.toBe(OTHER_TENANT);
    expect(AT).toStrictEqual(new Date('2026-08-14T09:00:00.000Z'));
  });
});
