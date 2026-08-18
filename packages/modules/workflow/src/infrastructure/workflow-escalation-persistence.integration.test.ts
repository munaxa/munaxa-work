import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  OUTSIDER,
  SECOND_APPROVER,
  TENANT_A,
  TENANT_B,
  openWorkflowFixture,
  requireDatabaseInCi,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { liveWorkflow, type LiveWorkflow } from './workflow-live.fixture.js';
import type { WorkflowStepState } from '../domain/instance.js';

/**
 * Escalation through the real handlers and the real columns.
 *
 * **This is the suite Checkpoint 4 said would be needed, and it is the one that would have caught the
 * gap it left.** The command was complete a checkpoint before its column was mapped: every
 * application test passed against in-memory maps while `escalated_at` was dropped on the way to
 * PostgreSQL. What an in-memory store cannot show is that the *marker* survives — and the marker is
 * not a decoration. The tally counts the steps without it, so a mapper that lost it would silently
 * enlarge the assigned denominator of every escalated branch on the next read, changing the threshold
 * and possibly the outcome of an approval already under way.
 *
 * So the assertions here are deliberately about the **second** read: not that the command returned a
 * step, but that the branch read back out of PostgreSQL still counts three assigned approvers when
 * four rows exist.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi("Workflow's escalation persistence suite");

const BRANCH = [APPROVER, SECOND_APPROVER, DEPUTY];

suite('an escalated approver, through PostgreSQL', () => {
  let fixture: WorkflowFixture;
  let live: LiveWorkflow;

  beforeAll(async () => {
    fixture = await openWorkflowFixture('workflow_escalation_live_role');
    live = liveWorkflow(fixture);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** The role every claim below rests on. A superuser would see rows a policy should have hidden. */
  it('runs as a role that is neither a superuser nor exempt from row-level security', async () => {
    const { rows } = await fixture.admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = $1`,
      [fixture.roleName],
    );

    expect(rows[0]).toStrictEqual({ rolsuper: false, rolbypassrls: false });
  });

  const runningBranch = async (
    rule: 'unanimous' | 'majority' | 'first-response',
    approvers: readonly string[] = BRANCH,
    tenantId = TENANT_A,
  ): Promise<string> => {
    const definitionId = await live.aProcess(
      approvers.map((approverMembershipId) => ({
        ordinal: 1,
        approverMembershipId,
        branchRule: rule,
        serviceLevel: { count: 2, unit: 'days' },
      })),
      tenantId,
    );

    return live.start(definitionId, `requisition-${rule}`, undefined, tenantId);
  };

  /** The step **states**, as the repository returns them. `escalatedAt` lives here and not on a view. */
  const stepsOf = (instanceId: string): Promise<readonly WorkflowStepState[]> =>
    fixture.inTenant(TENANT_A, (transaction) =>
      fixture.stores.steps.forInstance(transaction, instanceId),
    );

  /** The branch's tally, as the read query publishes it. One branch per approval in this suite. */
  const branchTally = async (instanceId: string) => {
    const [tally] = (await live.detailOf(instanceId)).tallies ?? [];

    if (tally === undefined) throw new Error('The approval published no tally.');
    return tally;
  };

  const escalate = (instanceId: string, approverMembershipId: string, ordinal = 1) =>
    live.attempt(
      { commandName: 'workflow.escalate-branch', instanceId, ordinal, approverMembershipId },
      APPROVER,
    );

  describe('the marker survives the round trip', () => {
    it('stores null for a snapshotted approver and an instant for an escalated one', async () => {
      const instanceId = await runningBranch('majority');

      expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

      // Read back through the **repository**, not through raw SQL and not through the published
      // view: the question is whether the mapper returns what the column holds, and `escalatedAt` is
      // deliberately not on `WorkflowStepView` — no contract publishes it and this checkpoint adds
      // none.
      const steps = await stepsOf(instanceId);
      const added = steps.find((step) => step.approverMembershipId === OUTSIDER);
      const original = steps.filter((step) => step.approverMembershipId !== OUTSIDER);

      expect(original).toHaveLength(3);
      // Absent, not null: `escalatedAt === undefined` is the predicate the tally filters on.
      for (const step of original) {
        expect([step.approverMembershipId, step.escalatedAt]).toStrictEqual([
          step.approverMembershipId,
          undefined,
        ]);
      }
      expect(added?.escalatedAt).toBeInstanceOf(Date);
    });

    /** The exact instant, to the millisecond, and not a civil date. */
    it('returns the same instant the command wrote', async () => {
      const instanceId = await runningBranch('majority');

      expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

      const added = (await stepsOf(instanceId)).find(
        (step) => step.approverMembershipId === OUTSIDER,
      );
      const { rows } = await fixture.admin.query<{ escalated_at: Date }>(
        `select escalated_at from workflow_step
          where tenant_id = $1 and approver_membership_id = $2`,
        [TENANT_A, OUTSIDER],
      );

      expect(added?.escalatedAt?.toISOString()).toBe(rows[0]?.escalated_at.toISOString());
      // A `timestamptz`, so the round trip keeps the instant rather than a day.
      expect(added?.escalatedAt?.toISOString()).toMatch(/T\d\d:\d\d:\d\d\.\d\d\dZ$/);
    });
  });

  /**
   * **The assertion this checkpoint exists for.**
   *
   * Four rows at ordinal 1 and a denominator of three, read back out of the database. Without the
   * mapper the fourth row would come back looking snapshotted, `assigned` would be four, the majority
   * threshold would move from two to three, and an approval somebody was already answering would
   * quietly need one more approval than it was started with.
   */
  it('keeps the assigned denominator at three when a fourth row exists', async () => {
    const instanceId = await runningBranch('majority');
    const before = await branchTally(instanceId);

    expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

    const after = await live.detailOf(instanceId);
    const tally = await branchTally(instanceId);

    expect(after.steps).toHaveLength(4);
    expect([before.assigned, before.threshold]).toStrictEqual([3, 2]);
    expect([tally.assigned, tally.threshold]).toStrictEqual([3, 2]);
    // And `outstanding` is counted rather than subtracted, so it stays a whole non-negative number.
    expect(tally.outstanding).toBe(3);
    expect(tally.outcome).toBe('awaiting');
  });

  it('lets an escalated approval count fully toward a majority', async () => {
    const instanceId = await runningBranch('majority');

    expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

    // Both decisions are made by the *members*, which is how a decision is addressed: the escalated
    // approver answers their own step and an assigned approver answers theirs.
    await live.decide(instanceId, OUTSIDER, 'approved');
    await live.decide(instanceId, APPROVER, 'approved');

    const tally = await branchTally(instanceId);

    // Two approvals against a threshold of two — one assigned, one escalated — over a denominator
    // that never moved.
    expect([tally.assigned, tally.threshold, tally.approvals]).toStrictEqual([3, 2, 2]);
    expect(tally.outcome).toBe('approved');
    // **Two** of the three assigned approvers never answered, and `outstanding` counts them rather
    // than subtracting responses from the denominator. The subtraction would have given `3 - 2 = 1`
    // here and would go negative the moment a third escalated answer arrived — which is exactly why
    // D-16D-08 fixed the definition as a count.
    expect(tally.outstanding).toBe(2);
  });

  it('refuses a unanimous branch and leaves the database exactly as it was', async () => {
    const instanceId = await runningBranch('unanimous', [APPROVER, SECOND_APPROVER]);
    const refused = await escalate(instanceId, OUTSIDER);

    expect(refused.ok).toBe(false);

    const detail = await live.detailOf(instanceId);

    expect(detail.steps).toHaveLength(2);
    expect((await branchTally(instanceId)).assigned).toBe(2);

    const { rows } = await fixture.admin.query<{ count: string }>(
      `select count(*)::text as count from workflow_step
        where tenant_id = $1 and escalated_at is not null`,
      [TENANT_A],
    );

    expect(rows[0]?.count).toBe('0');
  });

  describe('the timeline', () => {
    it('records exactly one step-escalated and rewrites no decision', async () => {
      const instanceId = await runningBranch('majority');

      expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

      const { rows } = await fixture.admin.query<{ event: string; actor_membership_id: string }>(
        `select event, actor_membership_id from workflow_history
          where tenant_id = $1 and event = 'step-escalated'`,
        [TENANT_A],
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.actor_membership_id).toBe(APPROVER);

      const decisions = await fixture.admin.query<{ count: string }>(
        `select count(*)::text as count from workflow_decision where tenant_id = $1`,
        [TENANT_A],
      );

      // Nobody answered anything, so the decision table is untouched by an escalation.
      expect(decisions.rows[0]?.count).toBe('0');
    });
  });

  /**
   * Row-level security, over the column this checkpoint added.
   *
   * The escalated step is an ordinary `workflow_step` row and the policy does not know it is special,
   * which is exactly why it is asserted: a reader in the wrong tenant must find nothing, and the
   * unique index — enforced by the system rather than by the querying role — must not refuse a
   * neighbour's identical write.
   */
  describe('across a tenant boundary', () => {
    it('hides an escalated step and its timeline from the neighbouring tenant', async () => {
      const instanceId = await runningBranch('majority');

      expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);

      const seen = await fixture.asTenant(TENANT_B, async (client) => {
        const steps = await client.query<{ count: string }>(
          `select count(*)::text as count from workflow_step where escalated_at is not null`,
        );
        const history = await client.query<{ count: string }>(
          `select count(*)::text as count from workflow_history where event = 'step-escalated'`,
        );

        return [steps.rows[0]?.count, history.rows[0]?.count];
      });

      expect(seen).toStrictEqual(['0', '0']);
    });

    it('cannot escalate an approval belonging to another tenant', async () => {
      const instanceId = await runningBranch('majority');
      const refused = await live.attempt(
        {
          commandName: 'workflow.escalate-branch',
          instanceId,
          ordinal: 1,
          approverMembershipId: OUTSIDER,
        },
        APPROVER,
        TENANT_B,
      );

      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.kind).toBe('not_found');

      const { rows } = await fixture.admin.query<{ count: string }>(
        `select count(*)::text as count from workflow_step
          where tenant_id = $1 and escalated_at is not null`,
        [TENANT_B],
      );

      expect(rows[0]?.count).toBe('0');
    });

    /** The same logical escalation in two tenants, and the index refuses neither. */
    it('lets both tenants escalate the same membership onto their own branch', async () => {
      const mine = await runningBranch('majority');
      const theirs = await runningBranch('majority', BRANCH, TENANT_B);

      expect((await escalate(mine, OUTSIDER)).ok).toBe(true);
      expect(
        (
          await live.attempt(
            {
              commandName: 'workflow.escalate-branch',
              instanceId: theirs,
              ordinal: 1,
              approverMembershipId: OUTSIDER,
            },
            APPROVER,
            TENANT_B,
          )
        ).ok,
      ).toBe(true);
    });
  });

  /**
   * The duplicate, refused twice over.
   *
   * The domain refuses the second request by reading the branch, which is what a caller sees. What
   * makes it safe under concurrency is the partial unique index, and that is asserted directly in
   * `workflow-escalation-uniqueness.integration.test.ts` on two real connections. Nothing here adds a
   * preflight query, a lock or a retry — the check inside the domain is a courtesy, and the index is
   * the guarantee.
   */
  it('refuses the same escalation twice and leaves one row', async () => {
    const instanceId = await runningBranch('majority');

    expect((await escalate(instanceId, OUTSIDER)).ok).toBe(true);
    expect((await escalate(instanceId, OUTSIDER)).ok).toBe(false);

    const { rows } = await fixture.admin.query<{ count: string }>(
      `select count(*)::text as count from workflow_step
        where tenant_id = $1 and escalated_at is not null`,
      [TENANT_A],
    );

    expect(rows[0]?.count).toBe('1');
  });
});
