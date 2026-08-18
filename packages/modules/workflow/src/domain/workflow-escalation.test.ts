import { describe, expect, it } from 'vitest';

import { ESCALATION_EVENT, escalateBranch, escalationIdentity } from './escalation.js';
import { WORKFLOW_HISTORY_EVENTS, type BranchRule } from './workflow-vocabulary.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * The escalation **act**: what it refuses, what asking twice does, and what it never touches.
 *
 * Split from `workflow-escalation-tally.test.ts` at the file-size budget, on the seam the capability
 * itself has. This file is about the *command* — the five refusals that existed before Phase 16D's
 * eligibility approvals, a duplicate that is judged on an identity written down, and the fact that
 * its whole output is one new step nobody has answered.
 * The arithmetic that step must not disturb is next door, because "the denominator did not move" is
 * a claim about the tally rather than about the act.
 *
 * The five refusals are five different situations for five different people to act on. A suite that
 * proved only that escalation "fails" on a bad request would let two of them collapse into one, and
 * an administrator would be sent to fix the wrong thing.
 *
 * **There are seven now.** D-16D-13 and D-16D-14 added the requester rule and instance-wide D-5, and
 * both live in `workflow-escalation-eligibility.test.ts` beside the fixture that can express them —
 * a second ordinal, which the single-ordinal branch below cannot build. The distinctness of all
 * seven together is asserted there rather than split across the two files.
 */

const AT = new Date('2026-08-18T09:00:00.000Z');
const LATER = new Date('2026-08-18T11:00:00.000Z');

const instance = (status: WorkflowInstanceState['status'] = 'running'): WorkflowInstanceState => ({
  instanceId: 'instance-1',
  definitionId: 'definition-1',
  workflowVersionId: 'version-1',
  subjectType: 'recruitment.requisition',
  subjectId: 'requisition-1',
  requestedByMembershipId: 'membership-requester',
  status,
  startedAt: AT,
  correlationId: 'correlation-1',
  context: {},
  version: 1,
});

/** One assigned approver of a branch, as `startInstance` would have written them. */
const assigned = (
  stepId: string,
  membership: string,
  rule: BranchRule,
  status: WorkflowStepState['status'] = 'awaiting',
): WorkflowStepState => ({
  stepId,
  instanceId: 'instance-1',
  ordinal: 1,
  approverKind: 'membership',
  approverMembershipId: membership,
  status,
  branchRule: rule,
  awaitingAt: AT,
  serviceLevel: { count: 2, unit: 'days' },
  version: 1,
});

/** A branch of `size` assigned approvers, all awaiting, under one rule. */
const branchOf = (size: number, rule: BranchRule): readonly WorkflowStepState[] =>
  Array.from({ length: size }, (_, index) =>
    assigned(`step-${String(index + 1)}`, `membership-${String(index + 1)}`, rule),
  );

const escalate = (steps: readonly WorkflowStepState[], membership = 'membership-new') =>
  escalateBranch(instance(), steps, {
    stepId: 'step-escalated',
    ordinal: 1,
    approverMembershipId: membership,
    at: LATER,
  });

const added = (steps: readonly WorkflowStepState[], membership = 'membership-new') => {
  const result = escalate(steps, membership);

  if (!result.ok) throw new Error(`Escalation refused: ${result.error.reason}.`);
  return result.value;
};

const refusal = (result: ReturnType<typeof escalate>): string =>
  result.ok ? 'accepted' : result.error.reason;

describe('what escalation refuses', () => {
  it('refuses when the instance is no longer running', () => {
    for (const status of ['cancelled', 'completed', 'rejected'] as const) {
      const result = escalateBranch(instance(status), branchOf(2, 'majority'), {
        stepId: 'step-escalated',
        ordinal: 1,
        approverMembershipId: 'membership-new',
        at: LATER,
      });

      expect([status, refusal(result)]).toStrictEqual([status, 'escalation-instance-not-running']);
    }
  });

  /** Not awaiting covers four situations, and one refusal is the honest name for all of them. */
  it.each([
    ['a branch whose steps were all answered', 'approved' as const],
    ['a branch a condition skipped', 'skipped' as const],
    ['a branch not yet reached', 'pending' as const],
  ])('refuses %s', (_situation, status) => {
    const steps = branchOf(2, 'majority').map((step) => ({ ...step, status }));

    expect(refusal(escalate(steps))).toBe('escalation-branch-not-awaiting');
  });

  it('refuses an ordinal with no steps at all', () => {
    expect(refusal(escalate([]))).toBe('escalation-branch-not-awaiting');
  });

  it('refuses somebody the instance already assigned to this branch', () => {
    expect(refusal(escalate(branchOf(2, 'majority'), 'membership-1'))).toBe(
      'escalation-approver-already-assigned',
    );
  });

  /** Every refusal is its own name. Collapsing two would send somebody to fix the wrong thing. */
  it('names five distinct failures', () => {
    const original = branchOf(2, 'majority');
    const named = [
      refusal(
        escalateBranch(instance('cancelled'), original, {
          stepId: 's',
          ordinal: 1,
          approverMembershipId: 'membership-new',
          at: LATER,
        }),
      ),
      refusal(escalate(original.map((step) => ({ ...step, status: 'approved' as const })))),
      refusal(escalate(branchOf(2, 'unanimous'))),
      refusal(escalate(original, 'membership-1')),
      refusal(escalate([...original, added(original)])),
    ];

    expect(new Set(named).size).toBe(5);
    expect(named).toStrictEqual([
      'escalation-instance-not-running',
      'escalation-branch-not-awaiting',
      'escalation-branch-is-unanimous',
      'escalation-approver-already-assigned',
      'escalation-already-escalated',
    ]);
  });
});

describe('asking twice', () => {
  const original = branchOf(3, 'majority');

  it('refuses the second identical request rather than adding a second step', () => {
    const once = [...original, added(original)];

    expect(refusal(escalate(once))).toBe('escalation-already-escalated');
  });

  it('is deterministic: the same request against the same branch gives the same answer', () => {
    expect(added(original)).toStrictEqual(added(original));
    expect(refusal(escalate(original, 'membership-1'))).toBe(
      refusal(escalate(original, 'membership-1')),
    );
  });

  /**
   * What a duplicate **is**, written down — and what this file does not claim to prove.
   *
   * The identity is the instance, the branch and the membership: not the request identifier, because
   * a retry is a new request about the same intent. The check above reads the steps it was handed,
   * so two concurrent transactions could each read a branch without the other's step and each decide
   * there is nothing to add. **That race is settled by a unique index, not by a read** (ADR-0071),
   * and Checkpoint 3 owns it. Nothing here should be read as evidence about concurrency.
   */
  it('judges a duplicate on the instance, the branch and the membership', () => {
    expect(escalationIdentity('instance-1', 1, 'membership-new')).toBe(
      escalationIdentity('instance-1', 1, 'membership-new'),
    );
    for (const other of [
      escalationIdentity('instance-2', 1, 'membership-new'),
      escalationIdentity('instance-1', 2, 'membership-new'),
      escalationIdentity('instance-1', 1, 'membership-other'),
    ]) {
      expect(other).not.toBe(escalationIdentity('instance-1', 1, 'membership-new'));
    }
  });
});

describe('what escalation never touches', () => {
  const original = branchOf(3, 'majority');

  it('returns only the new step, so no recorded decision can be overwritten', () => {
    const escalated = added(original);

    // The function's whole output is one step nobody has answered. It returns no existing step, so
    // there is no shape in which it could rewrite a decision or move one to `skipped`.
    expect(escalated.stepId).toBe('step-escalated');
    expect(escalated.status).toBe('awaiting');
    expect(original.map((step) => step.status)).toStrictEqual(['awaiting', 'awaiting', 'awaiting']);
  });

  /**
   * The escalated step is a membership like any other, and carries no group provenance.
   *
   * `sourceGroupId` says an approver came from a list. This one came from a person's decision to
   * bring somebody in, which is a different fact and has its own field.
   */
  it('adds a membership, not a new kind of approver', () => {
    const escalated = added(original);

    expect(escalated.approverKind).toBe('membership');
    expect(escalated.sourceGroupId).toBeUndefined();
  });

  /**
   * The history boundary, asserted rather than described.
   *
   * An escalation is not an answer, so it must never be recorded as one. Checkpoint 2 named the event
   * and deliberately kept it *out* of the closed vocabulary, because that list is checked against the
   * database's own constraint and the two had to widen together. Checkpoint 3's migration did that,
   * so the assertion moved with them: the event is now one of nine, and still none of the three
   * decisions.
   */
  it('names an event that is one of the nine and none of the three decisions', () => {
    for (const decision of ['step-approved', 'step-rejected', 'step-skipped']) {
      expect(ESCALATION_EVENT).not.toBe(decision);
    }
    expect([...WORKFLOW_HISTORY_EVENTS]).toContain(ESCALATION_EVENT);
    expect([...WORKFLOW_HISTORY_EVENTS]).toHaveLength(9);
  });
});
