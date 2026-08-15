import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7, type HandlerFailure, type Result } from '@work/kernel';

import {
  APPROVER,
  B_APPROVER,
  CONNECTION,
  TENANT_A,
  TENANT_B,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';
import {
  decidedAlready,
  requisitionDecisions,
  requisitionRow,
  seedRequisition,
  startApproval,
} from './workflow-cross-module-seed.js';

/**
 * Two people deciding at once, two tenants, and the module that is not there.
 *
 * **Two real connections.** Each `dispatcher.send` enters its own `UnitOfWork.execute`, which takes
 * its own pooled connection and opens its own transaction, so two sends started together are two
 * genuinely concurrent sessions. No sleeps, no disabled constraints, and no helper that runs one
 * after the other.
 *
 * **Every outcome is named.** A lifecycle refusal, a stale version, a duplicate key and a convergence
 * are four different things, and a suite that accepted "an error happened" would pass for a typo in
 * the SQL as readily as for the invariant it came to check.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow–Recruitment race suite');

/** What one attempt did, in terms a reader can act on. */
const outcomeOf = async (attempt: Promise<Result<unknown, HandlerFailure>>): Promise<string> => {
  try {
    const result = await attempt;

    if (result.ok) return 'committed';
    if (result.error.kind === 'rejected')
      return `rejected:${result.error.reason.split('.').pop() ?? ''}`;
    if (result.error.kind === 'conflict') return `conflict:${result.error.reason}`;
    return result.error.kind;
  } catch (error: unknown) {
    return `raised:${error instanceof Error ? error.message : 'unknown'}`;
  }
};

suite('the Workflow to Recruitment seam, under contention', () => {
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

  const awaiting = async (
    tenantId: string,
    approver: string,
    label: string,
  ): Promise<{ readonly requisitionId: string; readonly instanceId: string }> => {
    const seeded = await seedRequisition(harness, tenantId);
    const started = await startApproval(harness, tenantId, {
      approver,
      subjectId: seeded.requisitionId,
      code: `approval-${label}`,
    });

    return { requisitionId: seeded.requisitionId, instanceId: started.instanceId };
  };

  const decide = (
    tenantId: string,
    membershipId: string,
    instanceId: string,
    decision: 'approved' | 'rejected' = 'approved',
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(tenantId, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision,
        expectedVersion: 1,
      }),
    );

  describe('two people deciding at once', () => {
    /**
     * **The same step, twice, simultaneously.**
     *
     * One commits. The other loses on a named invariant — Workflow's partial unique index on the
     * awaiting step, its optimistic version, or its own lifecycle rule that a decided step is no
     * longer awaiting — and Recruitment moves exactly once, with exactly one decision row.
     */
    it('lets one decision through and refuses the other, and Recruitment moves once', async () => {
      const { requisitionId, instanceId } = await awaiting(TENANT_A, APPROVER, 'race-step');
      const outcomes = await Promise.all([
        outcomeOf(decide(TENANT_A, APPROVER, instanceId)),
        outcomeOf(decide(TENANT_A, APPROVER, instanceId)),
      ]);
      const committed = outcomes.filter((outcome) => outcome === 'committed');

      expect(committed).toHaveLength(1);

      const [loser] = outcomes.filter((outcome) => outcome !== 'committed');

      // Named, not merely "an error": the loser is refused by a rule, not by chance.
      expect(loser).toMatch(/^(rejected:|conflict:|raised:)/);

      const requisition = await requisitionRow(harness, TENANT_A, requisitionId);

      expect(requisition?.status).toBe('approved');
      expect(requisition?.approval_id).toBe(instanceId);
      // One transition, one decision row. The whole point of the refusal above.
      await expect(requisitionDecisions(harness, TENANT_A, requisitionId)).resolves.toHaveLength(1);
    });

    /**
     * **The same approval, delivered twice at once, after Recruitment already applied it.**
     *
     * Both find the requisition carrying this approval with this outcome. Both converge on the
     * Recruitment side — nothing is asked of it — and Workflow's own invariants settle which of them
     * gets to record the decision.
     */
    it('converges both simultaneous redeliveries of the same approval', async () => {
      const { requisitionId, instanceId } = await awaiting(TENANT_A, APPROVER, 'race-converge');

      await decidedAlready(harness, TENANT_A, requisitionId, {
        status: 'approved',
        approvalId: instanceId,
      });

      const outcomes = await Promise.all([
        outcomeOf(decide(TENANT_A, APPROVER, instanceId)),
        outcomeOf(decide(TENANT_A, APPROVER, instanceId)),
      ]);

      expect(outcomes.filter((outcome) => outcome === 'committed')).toHaveLength(1);
      // Recruitment was never asked to move, by either of them.
      await expect(requisitionDecisions(harness, TENANT_A, requisitionId)).resolves.toEqual([]);
      await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
        status: 'approved',
        approval_id: instanceId,
      });
    });

    /**
     * **Two different approvals about the same requisition.**
     *
     * Both are legitimate Workflow approvals; only one may decide the requisition. The second meets
     * Recruitment's own rules — a stale version, or a requisition no longer awaiting a decision — and
     * the identifier written by the first is not overwritten.
     */
    it('lets one approval decide the requisition and refuses the second', async () => {
      const seeded = await seedRequisition(harness, TENANT_A);
      const first = await startApproval(harness, TENANT_A, {
        approver: APPROVER,
        subjectId: seeded.requisitionId,
        code: 'approval-first',
      });

      // A second approval about the same subject: the open-subject index permits it only once the
      // first is no longer running, so this one is raised after the first has been decided.
      await decide(TENANT_A, APPROVER, first.instanceId);

      const second = await startApproval(harness, TENANT_A, {
        approver: APPROVER,
        subjectId: seeded.requisitionId,
        code: 'approval-second',
      });
      const outcome = await outcomeOf(decide(TENANT_A, APPROVER, second.instanceId));

      expect(outcome).toMatch(/^rejected:/);

      const requisition = await requisitionRow(harness, TENANT_A, seeded.requisitionId);

      expect(requisition?.approval_id).toBe(first.instanceId);
      await expect(
        requisitionDecisions(harness, TENANT_A, seeded.requisitionId),
      ).resolves.toHaveLength(1);
    });

    /** And an approval racing a decision a person made directly in Recruitment loses to the person. */
    it('refuses a delivery that races a direct Recruitment decision', async () => {
      const { requisitionId, instanceId } = await awaiting(TENANT_A, APPROVER, 'race-direct');

      await decidedAlready(harness, TENANT_A, requisitionId, { status: 'approved' });

      const outcome = await outcomeOf(decide(TENANT_A, APPROVER, instanceId));

      expect(outcome).toBe('rejected:subject-decided-outside-workflow');
      await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
        status: 'approved',
        approval_id: null,
      });
    });
  });

  describe('tenant isolation', () => {
    /**
     * **An approval in one tenant cannot reach a requisition in another.**
     *
     * The subject identifier is the same value in both requests — the seam carries an opaque string
     * and nothing stops one being reused — and tenant A's approval still finds nothing, because every
     * read and every write on the way is scoped by the tenant the request resolved.
     */
    it('cannot decide another tenant’s requisition, even with the same identifier', async () => {
      const shared = uuidV7();

      await seedRequisition(harness, TENANT_B, { requisitionId: shared });

      const started = await startApproval(harness, TENANT_A, {
        approver: APPROVER,
        subjectId: shared,
        code: 'approval-crossing',
      });
      const outcome = await outcomeOf(decide(TENANT_A, APPROVER, started.instanceId));

      expect(outcome).toBe('rejected:subject-not-found');
      // Tenant B is exactly as it was, including the column this seam exists to write.
      await expect(requisitionRow(harness, TENANT_B, shared)).resolves.toEqual({
        status: 'pending_approval',
        approval_id: null,
      });
      await expect(requisitionDecisions(harness, TENANT_B, shared)).resolves.toEqual([]);
    });

    /** Each tenant's own seam works, so the refusal above is a boundary rather than a broken fixture. */
    it('applies each tenant’s approval to its own requisition', async () => {
      const inA = await awaiting(TENANT_A, APPROVER, 'tenant-a');
      const inB = await awaiting(TENANT_B, B_APPROVER, 'tenant-b');

      await decide(TENANT_A, APPROVER, inA.instanceId);
      await decide(TENANT_B, B_APPROVER, inB.instanceId);

      await expect(requisitionRow(harness, TENANT_A, inA.requisitionId)).resolves.toEqual({
        status: 'approved',
        approval_id: inA.instanceId,
      });
      await expect(requisitionRow(harness, TENANT_B, inB.requisitionId)).resolves.toEqual({
        status: 'approved',
        approval_id: inB.instanceId,
      });
      // Neither approval identifier appears in the other tenant.
      await expect(requisitionRow(harness, TENANT_B, inA.requisitionId)).resolves.toBeUndefined();
    });

    /** A membership belonging to another tenant is nobody here, and decides nothing. */
    it('refuses a membership from another tenant acting in this one', async () => {
      const { requisitionId, instanceId } = await awaiting(TENANT_A, APPROVER, 'foreign-member');
      const outcome = await outcomeOf(decide(TENANT_A, B_APPROVER, instanceId));

      expect(outcome).toMatch(/^rejected:/);
      await expect(requisitionRow(harness, TENANT_A, requisitionId)).resolves.toEqual({
        status: 'pending_approval',
        approval_id: null,
      });
    });
  });

  /**
   * **When Recruitment is not there at all.**
   *
   * The same production composition with the adopting module missing from the dispatcher. The
   * decision is refused and nothing is written on either side.
   *
   * **The refusal cannot distinguish "the module is down" from "the record is not there"**, and that
   * is stated rather than papered over: the dispatcher reports a missing handler as `not_found`,
   * which is the same shape as a missing requisition, so both arrive at `subject-not-found`. The
   * direction that matters is unaffected — neither becomes an approval — and inventing a distinction
   * from the shape of a resource string would be a guarantee this repository does not have.
   */
  describe('when Recruitment is unavailable', () => {
    let deaf: WorkflowCrossModuleHarness;

    beforeAll(async () => {
      deaf = harnessFor({
        connectionString: await applicationConnection(),
        withoutRecruitment: true,
      });
    });

    afterAll(async () => {
      await deaf.close();
    });

    it('refuses the decision and leaves both sides untouched', async () => {
      await deaf.truncate();

      const seeded = await seedRequisition(deaf, TENANT_A);
      const started = await startApproval(deaf, TENANT_A, {
        approver: APPROVER,
        subjectId: seeded.requisitionId,
        code: 'approval-deaf',
      });
      const outcome = await outcomeOf(
        deaf.inTenant(TENANT_A, APPROVER, () =>
          deaf.dispatcher.send({
            commandName: 'workflow.decide-step',
            instanceId: started.instanceId,
            decision: 'approved',
            expectedVersion: 1,
          }),
        ),
      );

      expect(outcome).toBe('rejected:subject-not-found');

      const requisition = await deaf.rowsIn<{ status: string; approval_id: string | null }>(
        TENANT_A,
        `select status, approval_id from recruitment_requisition where id = $1`,
        [seeded.requisitionId],
      );

      expect(requisition[0]).toEqual({ status: 'pending_approval', approval_id: null });

      const decisions = await deaf.rowsIn<{ id: string }>(
        TENANT_A,
        `select id from workflow_decision where instance_id = $1`,
        [started.instanceId],
      );

      expect(decisions).toEqual([]);
    });
  });
});
