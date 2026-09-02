import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HandlerFailure, Query, Result } from '@work/kernel';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  OUTSIDER,
  TENANT_A,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  roleIsUnprivileged,
  type WorkflowCrossModuleHarness,
  UNADOPTED,
} from './workflow-cross-module-harness.js';
import {
  noLongerInForce,
  notYetInForce,
  seedDelegation,
  startApproval,
} from './workflow-cross-module-seed.js';

/**
 * The mandatory production scenario: an approval decided by a deputy, end to end.
 *
 * **Nothing in the path is simulated.** A real dispatcher; Workflow assembled by the production
 * `workflowModuleFor`; its real PostgreSQL repositories; the real `WorkflowDelegations` adapter
 * reaching Identity through a real bounded service grant; Identity's own module answering
 * `identity.active-delegations-for` from its own repository against the real `delegation` table; and
 * all of it on a PostgreSQL role that is neither a superuser nor `BYPASSRLS`, so every policy is
 * genuinely in force.
 *
 * The question the suite answers is the one Phase 16A exists for: **can somebody decide a step that
 * was not assigned to them, and is the record of that decision honest?** Two memberships are
 * involved in a delegated approval and they must never collapse into one — the deputy is who acted,
 * the approver is whose authority was used, and an auditor reading the row a year later must be able
 * to tell them apart.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow cross-module delegation suite');

/** A query a suite sends, typed so the compiler still insists on the field that names it. */
type SentQuery = Query & Record<string, unknown>;

interface DecisionRow extends Record<string, unknown> {
  readonly decision: string;
  readonly decided_by_membership_id: string;
  readonly authority: string;
  readonly on_behalf_of_membership_id: string | null;
}

suite('workflow delegation, across modules', () => {
  let harness: WorkflowCrossModuleHarness;

  beforeAll(async () => {
    harness = harnessFor({ connectionString: await applicationConnection() });
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await harness.truncate();
    harness.elevations.length = 0;
  });

  /** One approval in a tenant, assigned to `APPROVER`. */
  const approvalIn = (
    tenantId: string,
    subjectId = 'requisition-1',
  ): Promise<{ instanceId: string }> =>
    startApproval(harness, tenantId, {
      subjectId,
      code: `approval-${subjectId}`,
      subjectType: UNADOPTED,
    });

  /** A decision attempt by a named membership, on the caller's own request. */
  const decideAs = (
    tenantId: string,
    membershipId: string | undefined,
    instanceId: string,
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(tenantId, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

  /** A query sent inside a tenant, with the payload kept open and the name still checked. */
  const askIn = <TResult>(
    tenantId: string,
    membershipId: string,
    query: SentQuery,
  ): Promise<Result<TResult, HandlerFailure>> =>
    harness.inTenant(tenantId, membershipId, () => harness.dispatcher.ask<TResult>(query));

  const decisionsIn = (tenantId: string, instanceId: string): Promise<DecisionRow[]> =>
    harness.rowsIn<DecisionRow>(
      tenantId,
      `select decision, decided_by_membership_id, authority, on_behalf_of_membership_id
         from workflow_decision where instance_id = $1`,
      [instanceId],
    );

  /**
   * Before anything is claimed about isolation or delegation, the role has to be able to be refused.
   *
   * The database belongs to `work`, which is a superuser, and a superuser bypasses every policy there
   * is. A suite that connected as one would report that row-level security holds without ever having
   * given it the chance to refuse.
   */
  it('runs as a role that is neither a superuser nor exempt from row-level security', async () => {
    await expect(roleIsUnprivileged(harness.pool)).resolves.toEqual({
      rolsuper: false,
      rolbypassrls: false,
    });
  });

  describe('the assigned approver', () => {
    it('decides their own step, on their own authority, with no delegation involved', async () => {
      const { instanceId } = await approvalIn(TENANT_A);
      const outcome = await decideAs(TENANT_A, APPROVER, instanceId);

      expect(outcome.ok).toBe(true);

      const [decision] = await decisionsIn(TENANT_A, instanceId);

      expect(decision?.decision).toBe('approved');
      expect(decision?.authority).toBe('assigned');
      expect(decision?.decided_by_membership_id).toBe(APPROVER);
      expect(decision?.on_behalf_of_membership_id).toBeNull();
      // Identity is not consulted at all: the caller is the approver, so there is nothing to ask.
      expect(harness.elevations).toEqual([]);
    });
  });

  describe('the deputy', () => {
    /**
     * **The scenario this whole checkpoint is for.**
     *
     * The delegation lives in Identity's table. Workflow never reads that table; it asks Identity's
     * published query, through the adapter, inside a bounded grant, at the instant of the decision.
     */
    it('decides a step delegated to them, and both memberships are recorded', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A);

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(true);

      const [decision] = await decisionsIn(TENANT_A, instanceId);

      // The delegate is the actor.
      expect(decision?.decided_by_membership_id).toBe(DEPUTY);
      // The assigned approver is the authority.
      expect(decision?.on_behalf_of_membership_id).toBe(APPROVER);
      expect(decision?.authority).toBe('delegated');
      // And the two are never the same person, which is the whole point of two columns.
      expect(decision?.decided_by_membership_id).not.toBe(decision?.on_behalf_of_membership_id);
    });

    /** The grant that made it possible: one permission, named, for the length of one call. */
    it('reads Identity under exactly one bounded grant, carrying the request’s own identity', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A);
      await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(harness.elevations).toHaveLength(1);

      const [elevation] = harness.elevations;

      expect(elevation?.module).toBe('workflow');
      expect(elevation?.operation).toBe('read-active-delegations');
      expect(elevation?.permission).toBe('identity.delegation.read');
      // Tenant, actor and correlation all survive the hop into another module untouched.
      expect(elevation?.tenantId).toBe(TENANT_A);
      expect(elevation?.actor).toBe('user:workflow-admin');
      expect(elevation?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('when no delegation applies', () => {
    it('refuses a decision by somebody with no delegation at all', async () => {
      const { instanceId } = await approvalIn(TENANT_A);
      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    /** Not yet in force: the period begins after the decision. */
    it('refuses a delegation that has not started', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, {
        ...notYetInForce(),
        status: 'scheduled',
      });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    /**
     * Over: the period ended before the decision.
     *
     * **Nothing expired it.** There is no `JobPort` in this repository and no sweep runs anywhere; an
     * arrangement that has ended is simply not in the answer Identity gives for this instant, which
     * is why Workflow needs no expiry state of its own and keeps none.
     */
    it('refuses a delegation whose period has ended', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, {
        ...noLongerInForce(),
        status: 'active',
      });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    it('refuses a delegation that was revoked, even while its period runs', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, { status: 'revoked' });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    /**
     * **A delegation for another domain is not a delegation for this one.**
     *
     * Identity keeps `scope` opaque and says the consuming domain agrees the key. Workflow's key is
     * its own permission name, so being asked to cover somebody's leave approvals does not let you
     * decide their workflow steps — which is the difference between delegating an authority and
     * handing over an account.
     */
    it('refuses a delegation granted for a different scope', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, { scope: 'leave.request.approve' });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    /** And the wildcard Identity may hand back, which Workflow does honour. */
    it('accepts a delegation granted for every scope', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, { scope: '*' });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(true);

      const [decision] = await decisionsIn(TENANT_A, instanceId);

      expect(decision?.authority).toBe('delegated');
    });

    /**
     * **Somebody else's delegation is not yours.**
     *
     * A delegation from the approver to the deputy does not let a third person decide, and the check
     * that stops it is the delegate identity Identity was asked about — which came from the request
     * rather than from anything the caller sent.
     */
    it('refuses a caller holding no delegation while another person holds one', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, { delegator: APPROVER, delegate: DEPUTY });

      const outcome = await decideAs(TENANT_A, OUTSIDER, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });

    /** A delegation from somebody who is not this step's approver decides nothing here either. */
    it('refuses a delegation granted by a person who is not this step’s approver', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A, { delegator: OUTSIDER, delegate: DEPUTY });

      const outcome = await decideAs(TENANT_A, DEPUTY, instanceId);

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });
  });

  describe('identity comes from the request', () => {
    /**
     * **A request that resolved no membership decides nothing.**
     *
     * Not "everybody", not "all pending approvals", not an anonymous authority: the command is
     * refused before a repository is reached. This is the seam Checkpoint 4 added, doing the one job
     * it was added for.
     */
    it('refuses a decision when the request carries no membership', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A);

      const outcome = await decideAs(TENANT_A, undefined, instanceId);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? undefined : outcome.error.kind).toBe('rejected');
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
      // Identity was never asked: there was nobody to ask about.
      expect(harness.elevations).toEqual([]);
    });

    /**
     * **A caller cannot name somebody else to change the authority.**
     *
     * `workflow.decide-step` has no approver field, so the only way to try is to put one on the
     * message anyway. It is ignored — the membership comes from the resolved request — and the
     * decision is refused exactly as it would have been without it.
     */
    it('ignores a membership a caller puts on the command', async () => {
      const { instanceId } = await approvalIn(TENANT_A);

      await seedDelegation(harness, TENANT_A);

      const outcome = await harness.inTenant(TENANT_A, OUTSIDER, () =>
        harness.dispatcher.send({
          commandName: 'workflow.decide-step',
          instanceId,
          decision: 'approved',
          expectedVersion: 1,
          // None of these is a field of the command. A caller sending them changes nothing.
          decidedByMembershipId: APPROVER,
          approverMembershipId: APPROVER,
          onBehalfOfMembershipId: APPROVER,
          membershipId: DEPUTY,
        }),
      );

      expect(outcome.ok).toBe(false);
      await expect(decisionsIn(TENANT_A, instanceId)).resolves.toEqual([]);
    });
  });

  /**
   * The delegated decision is the only one that consults Identity, and it consults it once.
   *
   * Stated because the alternative — a lookup on every read, or one per step — is how a bounded
   * cross-module read becomes a per-row one that nobody notices until a tenant grows.
   */
  it('asks Identity once per decision, and not at all for anything else', async () => {
    const { instanceId } = await approvalIn(TENANT_A);

    await seedDelegation(harness, TENANT_A);

    harness.elevations.length = 0;

    await askIn(TENANT_A, DEPUTY, {
      queryName: 'workflow.pending-approvals',
      page: 1,
      size: 10,
    });

    expect(harness.elevations).toEqual([]);

    await decideAs(TENANT_A, DEPUTY, instanceId);

    expect(harness.elevations).toHaveLength(1);
  });
});
