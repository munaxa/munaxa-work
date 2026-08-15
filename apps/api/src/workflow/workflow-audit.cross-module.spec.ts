import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { HandlerFailure, Result } from '@work/kernel';
import { DELEGABLE_SCOPES } from '@work/workflow';

import {
  APPROVER,
  CONNECTION,
  DEPUTY,
  TENANT_A,
  UNADOPTED,
  applicationConnection,
  harnessFor,
  requireDatabaseInCi,
  type WorkflowCrossModuleHarness,
} from './workflow-cross-module-harness.js';
import { seedDelegation, startApproval } from './workflow-cross-module-seed.js';
import { WorkflowDelegations } from './workflow-sources.js';
import { RecruitmentDecisions } from './recruitment-decisions.js';

/**
 * Three properties the Phase 16A audit found were assumed rather than asserted.
 *
 * Each is a real question with a security or correctness answer, and each was reachable only by
 * reading the code and believing it. Written here rather than folded into the delegation and
 * concurrency suites because they share one subject — **what the audit could not otherwise prove** —
 * and a reader looking for the gap should find it named rather than distributed.
 *
 * 1. **The delegation scope allowlist is exact.** `*` is honoured deliberately; nothing that merely
 *    resembles a wildcard is.
 * 2. **A cancellation racing a decision resolves to exactly one outcome**, and the loser is a named
 *    refusal rather than a second terminal state written over the first.
 * 3. **The outbound adapters hold exactly the capability they need**, which for the delegation
 *    adapter means no ability to send a command at all.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Workflow audit suite');

interface DecisionRow extends Record<string, unknown> {
  readonly authority: string;
}

interface InstanceRow extends Record<string, unknown> {
  readonly status: string;
  readonly cancellation_reason: string | null;
}

suite('the Phase 16A audit', () => {
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

  let sequence = 0;

  const approval = async (): Promise<{ instanceId: string }> => {
    sequence += 1;
    return startApproval(harness, TENANT_A, {
      subjectId: `audit-${String(sequence)}`,
      code: `audit-approval-${String(sequence)}`,
      subjectType: UNADOPTED,
    });
  };

  const decideAs = (
    membershipId: string,
    instanceId: string,
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(TENANT_A, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.decide-step',
        instanceId,
        decision: 'approved',
        expectedVersion: 1,
      }),
    );

  const cancelAs = (
    membershipId: string,
    instanceId: string,
    reason: string,
  ): Promise<Result<unknown, HandlerFailure>> =>
    harness.inTenant(TENANT_A, membershipId, () =>
      harness.dispatcher.send({
        commandName: 'workflow.cancel-instance',
        instanceId,
        reason,
        expectedVersion: 1,
      }),
    );

  /**
   * **The delegation allowlist is a set, not a pattern.**
   *
   * Workflow honours exactly two scopes: its own `workflow.approval.decide`, and the literal `*`
   * Identity may hand back for an unrestricted delegation. The risk this asserts against is the one
   * that never announces itself — somebody replacing the membership test with a prefix or a regular
   * expression, at which point a delegation granted for `workflow.approval.decide-nothing`, or for a
   * plausible-looking `workflow.*`, would silently let a deputy approve.
   *
   * Every string below is one somebody could reasonably store believing it grants approval. None of
   * them does, and each is proved against a real decision on a real approval rather than against the
   * list in isolation.
   */
  describe('the delegation scope allowlist', () => {
    it('honours exactly two scopes and no pattern that resembles them', () => {
      expect([...DELEGABLE_SCOPES].sort()).toEqual(['*', 'workflow.approval.decide']);
    });

    it('refuses every near-miss wildcard, on a real decision', async () => {
      for (const scope of [
        'workflow.*',
        'workflow.approval.*',
        '*.decide',
        'workflow.approval.decide.*',
        'workflow.approval.decide-anything',
        'WORKFLOW.APPROVAL.DECIDE',
        '**',
        '',
      ]) {
        const { instanceId } = await approval();

        await seedDelegation(harness, TENANT_A, { scope });

        const outcome = await decideAs(DEPUTY, instanceId);
        const decisions = await harness.rowsIn<DecisionRow>(
          TENANT_A,
          `select authority from workflow_decision where instance_id = $1`,
          [instanceId],
        );

        expect([scope, outcome.ok]).toEqual([scope, false]);
        expect([scope, decisions]).toEqual([scope, []]);
      }
    });

    /** And the two that do grant still grant, so the assertion above is not vacuous. */
    it('still honours the exact scope and the literal wildcard', async () => {
      for (const scope of ['workflow.approval.decide', '*']) {
        const { instanceId } = await approval();

        await seedDelegation(harness, TENANT_A, { scope });

        const outcome = await decideAs(DEPUTY, instanceId);
        const [decision] = await harness.rowsIn<DecisionRow>(
          TENANT_A,
          `select authority from workflow_decision where instance_id = $1`,
          [instanceId],
        );

        expect([scope, outcome.ok]).toEqual([scope, true]);
        expect([scope, decision?.authority]).toEqual([scope, 'delegated']);
      }
    });
  });

  /**
   * **A decision and a cancellation, at the same moment, on the same approval.**
   *
   * The one concurrency pair the other suites did not cover. Both are terminal and they disagree:
   * one ends the approval because somebody answered it, the other because nobody will. Two real
   * connections, no sleeps, and the invariant is that the approval reaches **one** terminal state —
   * never a cancelled instance carrying a decision row, and never a completed one carrying a
   * cancellation reason.
   *
   * **Each outcome is classified rather than counted.** A `ConcurrencyException` is not a `Result`:
   * it is raised out of the repository when a versioned update matches no row, travels past the
   * dispatcher, and is turned into a 409 by the shared Problem Details filter at the HTTP edge. A
   * test that caught everything and called it "the loser" would report the same success whether the
   * refusal was the domain's or a crash, so the three legitimate shapes are named separately.
   */
  describe('a decision racing a cancellation', () => {
    const REASON = 'Withdrawn while it was being decided';

    /**
     * One caller's outcome, as one of the three shapes this race may legitimately produce.
     *
     * Typed as `string` because the refusal carries the domain's own reason with it; the three
     * shapes are `committed`, `concurrency`, and `refused:<reason>`, and `classified` below is what
     * decides whether a value is one of them.
     */
    const outcomeOf = async (work: Promise<Result<unknown, HandlerFailure>>): Promise<string> => {
      try {
        const result = await work;

        if (result.ok) return 'committed';
        // `reason` belongs to two of the five failure kinds; the other three are described by their
        // kind alone. Narrowed rather than reached for, so a `forbidden` never reads as `undefined`.
        return result.error.kind === 'conflict' || result.error.kind === 'rejected'
          ? `refused:${result.error.kind}:${result.error.reason}`
          : `refused:${result.error.kind}`;
      } catch (error: unknown) {
        // Named by its constructor rather than by its message: this is the exception the shared
        // filter maps to 409, and anything else escaping here is a defect rather than a race.
        if (error instanceof Error && error.constructor.name === 'ConcurrencyException') {
          return 'concurrency';
        }
        throw error;
      }
    };

    const classified = (outcome: string): boolean =>
      outcome === 'committed' || outcome === 'concurrency' || outcome.startsWith('refused:');

    /** What the two tables say after one race, so the assertions can compare against one shape. */
    const settled = async (
      instanceId: string,
    ): Promise<{
      readonly status: string;
      readonly reason: string | null;
      readonly decisions: number;
    }> => {
      const [instance] = await harness.rowsIn<InstanceRow>(
        TENANT_A,
        `select status, cancellation_reason from workflow_instance where id = $1`,
        [instanceId],
      );
      const decisions = await harness.rowsIn<DecisionRow>(
        TENANT_A,
        `select authority from workflow_decision where instance_id = $1`,
        [instanceId],
      );

      return {
        status: instance?.status ?? 'missing',
        reason: instance?.cancellation_reason ?? null,
        decisions: decisions.length,
      };
    };

    /** One race, run and checked. Extracted so the loop below stays a loop rather than a method. */
    const race = async (): Promise<readonly string[]> => {
      const { instanceId } = await approval();
      const outcomes = await Promise.all([
        outcomeOf(decideAs(APPROVER, instanceId)),
        outcomeOf(cancelAs(APPROVER, instanceId, REASON)),
      ]);
      const after = await settled(instanceId);
      const decided = outcomes[0] === 'committed';

      // Exactly one of the two committed. Two would mean the approval was ended twice; none would
      // mean it was never ended at all.
      expect(outcomes.filter((outcome) => outcome === 'committed')).toHaveLength(1);
      // The record agrees with whichever won, on both sides of it: a cancelled approval carries a
      // reason and no decision, and a decided one carries a decision and no reason.
      expect(after).toEqual(
        decided
          ? { status: 'completed', reason: null, decisions: 1 }
          : { status: 'cancelled', reason: REASON, decisions: 0 },
      );

      return outcomes;
    };

    it('resolves to exactly one terminal state, and the other is a named refusal', async () => {
      const seen = new Set<string>();

      for (let attempt = 0; attempt < 6; attempt += 1) {
        for (const outcome of await race()) seen.add(outcome);
      }

      // Asserted as a set rather than per attempt: which shapes appear depends on which transaction
      // reached the row first, and pinning that per run would be asserting PostgreSQL's scheduling.
      // What must hold is that every shape seen across six real races is one of the three
      // legitimate ones — never an unclassified failure.
      for (const outcome of seen) expect([outcome, classified(outcome)]).toEqual([outcome, true]);
      expect(seen.has('committed')).toBe(true);
    });
  });

  /**
   * **An adapter that only reads another module cannot write to one.**
   *
   * Checkpoint 6's rule, asserted structurally rather than trusted to a comment. `WorkflowDelegations`
   * is constructed with `Asking`, which has one method; the Recruitment adapter is constructed with
   * `Sending`, which has two. The distinction is the authorization: an object with no `send` cannot
   * issue a command however it is called, and no future edit can give it one without changing the
   * type it was built from.
   */
  describe('the outbound capabilities', () => {
    it('gives the delegation adapter no way to send a command', () => {
      // Two probes with different shapes, handed to the production adapters. The delegation adapter
      // is constructed from a reader that has no `send` at all, so no future edit inside it can
      // reach one; the Recruitment adapter is constructed from a writer that does, because applying
      // a terminal decision is a write. What each holds is what it can do.
      const asked: string[] = [];
      const reader = {
        ask: () => {
          asked.push('ask');
          return Promise.resolve({ ok: true, value: { items: [] } });
        },
      };

      const delegation = new WorkflowDelegations(reader as never);
      const held = Object.values(delegation as unknown as Record<string, unknown>).filter(
        (value) => typeof value === 'object' && value !== null,
      );

      expect(held).toHaveLength(1);
      expect(Object.keys(held[0] as object)).toEqual(['ask']);
      expect(Object.keys(held[0] as object)).not.toContain('send');
    });

    /** And the one adapter that does write holds a capability that can, so the split is real. */
    it('gives the Recruitment adapter both, because applying a decision is a write', () => {
      const writer = {
        ask: () => Promise.resolve({ ok: true }),
        send: () => Promise.resolve({ ok: true }),
      };
      const decisions = new RecruitmentDecisions(writer as never);
      const held = Object.values(decisions as unknown as Record<string, unknown>).filter(
        (value) => typeof value === 'object' && value !== null,
      );

      expect(Object.keys(held[0] as object).sort()).toEqual(['ask', 'send']);
    });
  });
});
