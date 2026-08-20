import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  B_APPROVER,
  CONNECTION,
  DEPUTY,
  OUTSIDER,
  REQUESTER,
  TENANT_A,
  applicationConnection,
  attempt,
  harnessFor,
  requireDatabaseInCi,
  roleIsUnprivileged,
  send,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';

/**
 * The active-membership rule end to end: two modules, two real tables, no fakes.
 *
 * **Nothing on this path is a stub.** Identity answers `identity.membership-standing` from
 * `tenant_membership` under its own policy; Workflow is composed by `workflowModuleFor`, the
 * production function, so the adapter under test is the one that ships. What the application suite
 * proves against a fake port — that the rule refuses, that a refusal writes nothing — this proves
 * against the real seam, including the two things a fake cannot show: that the service grant carries
 * exactly one permission, and that row-level security is what makes another tenant's membership
 * indistinguishable from one that never existed.
 *
 * **The role is unprivileged**, asserted before any isolation result is believed.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow escalation eligibility cross-module suite');

/** A branch of two under `majority`, which is a rule escalation is permitted to widen (D-16D-08). */
const aWidenableApproval = (harness: WorkflowCrossModuleHarness, code: string): Promise<string> =>
  harness.inTenant(TENANT_A, REQUESTER, async () => {
    const definition = await send<{ definitionId: string }>(harness, {
      commandName: 'workflow.create-definition',
      code,
      name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
      description: { en: 'Raised for a requisition', ar: 'يُرفع لطلب توظيف' },
      subjectType: 'recruitment.requisition',
    });
    const version = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: definition.definitionId,
    });

    for (const approverMembershipId of [APPROVER, DEPUTY]) {
      await send(harness, {
        commandName: 'workflow.add-step',
        workflowVersionId: version.workflowVersionId,
        ordinal: 1,
        name: { en: 'Approve', ar: 'اعتماد' },
        approverMembershipId,
        branchRule: 'majority',
      });
    }
    await send(harness, {
      commandName: 'workflow.publish-version',
      workflowVersionId: version.workflowVersionId,
      expectedVersion: 1,
    });

    const instance = await send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: definition.definitionId,
      subjectType: 'recruitment.requisition',
      subjectId: code,
    });

    return instance.instanceId;
  });

suite('escalation eligibility, across the module boundary', () => {
  let harness: WorkflowCrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
  });

  it('asserts through a role that cannot bypass row-level security', async () => {
    await expect(roleIsUnprivileged(harness.pool)).resolves.toStrictEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  const escalate = (instanceId: string, approverMembershipId: string) =>
    harness.inTenant(TENANT_A, APPROVER, () =>
      attempt(harness, {
        commandName: 'workflow.escalate-branch',
        instanceId,
        ordinal: 1,
        approverMembershipId,
      }),
    );

  /** Suspending somebody is Identity's own act; the owner pool seeds another module's world only. */
  const suspend = (membershipId: string): Promise<unknown> =>
    harness.owner.query(
      `update tenant_membership set status = 'suspended', updated_at = now() where id = $1`,
      [membershipId],
    );

  it('adds an approver Identity says may act', async () => {
    const instanceId = await aWidenableApproval(harness, 'eligible-active');
    const outcome = await escalate(instanceId, OUTSIDER);

    expect(outcome.ok).toBe(true);
  });

  /**
   * **One grant, one permission**, recorded by the harness rather than asserted from the source.
   *
   * The whole authorization for reaching into Identity is that the reach is bounded, and a grant
   * naming a second permission would widen it without anybody deciding to. `identity.membership.read`
   * is the one D-16D-18 approved; the four it must never carry are named so a later addition fails
   * here rather than shipping.
   */
  it('elevates exactly once, naming exactly identity.membership.read', async () => {
    const instanceId = await aWidenableApproval(harness, 'eligible-grant');

    harness.elevations.length = 0;
    await escalate(instanceId, OUTSIDER);

    const standing = harness.elevations.filter(
      (elevation) => elevation.operation === 'read-membership-standing',
    );

    expect(standing).toHaveLength(1);
    expect(standing[0]?.permission).toBe('identity.membership.read');
    for (const wider of [
      'identity.profile.read',
      'identity.membership.manage',
      'identity.membership.*',
      'identity.*',
    ]) {
      expect([wider, standing[0]?.permission === wider]).toStrictEqual([wider, false]);
    }
  });

  it('refuses a membership Identity says may not act', async () => {
    const instanceId = await aWidenableApproval(harness, 'eligible-suspended');

    await suspend(OUTSIDER);

    const outcome = await escalate(instanceId, OUTSIDER);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok)
      expect(JSON.stringify(outcome.error)).toContain('escalation-approver-not-eligible');
  });

  /**
   * **The same refusal for three different Identity answers**, which is D-16D-17 (A) end to end.
   *
   * A suspended member, an identifier naming nobody, and a membership that exists only in a
   * neighbouring tenant. Identity tells the three apart; Workflow publishes one refusal, and the
   * third is the one that matters for security — row-level security is what makes another tenant's
   * membership arrive as absence rather than as a fact worth reporting.
   */
  it('answers alike for suspended, unknown and another tenant’s membership', async () => {
    const instanceId = await aWidenableApproval(harness, 'eligible-alike');

    await suspend(OUTSIDER);

    const reasons = await Promise.all(
      [OUTSIDER, '01930000-0000-7000-8000-0000000000ff', B_APPROVER].map(async (membershipId) => {
        const outcome = await escalate(instanceId, membershipId);

        return outcome.ok ? 'accepted' : JSON.stringify(outcome.error);
      }),
    );

    for (const reason of reasons) {
      expect(reason).toContain('escalation-approver-not-eligible');
    }
    // And nothing distinguishes them: a caller cannot tell which of the three situations applied.
    expect(new Set(reasons).size).toBe(1);
  });

  /** A refusal writes nothing: the branch still has the two steps it started with. */
  it('creates no step when the membership may not act', async () => {
    const instanceId = await aWidenableApproval(harness, 'eligible-atomic');

    await suspend(OUTSIDER);
    expect((await escalate(instanceId, OUTSIDER)).ok).toBe(false);

    const rows = await harness.rowsIn<{ count: string }>(
      TENANT_A,
      'select count(*)::text as count from workflow_step where instance_id = $1',
      [instanceId],
    );

    expect(rows[0]?.count).toBe('2');
  });
});
