import { describe, expect, it } from 'vitest';

import { tallyOf, type BranchVote } from './branch.js';
import { escalateBranch } from './escalation.js';
import type { BranchRule } from './workflow-vocabulary.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * The arithmetic an escalation must not disturb, per rule.
 *
 * **The denominator is the assertion this file exists for.** 16B locked it as the approver set
 * snapshotted when the instance started, and the tally reads it from the steps — so a step added
 * later would move `assigned`, move `threshold`, and could revert a decided branch to `awaiting`.
 * Every test below that touches a tally checks the two numbers *after* escalation as well as before,
 * because a change in either is the failure this design exists to prevent.
 *
 * **`unanimous` is refused rather than reinterpreted** (D-16D-08). Its threshold *is* its
 * denominator, so an added approver either completes the branch without an assigned approver's
 * consent — a replacement in everything but name — or moves the denominator. The refusal is by name
 * and distinct from the other four, because they send an administrator to fix different things.
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

const vote = (stepId: string, decision: 'approved' | 'rejected', minute = 0): BranchVote => ({
  stepId,
  decision,
  decidedAt: new Date(AT.getTime() + minute * 60_000),
});

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

describe('escalating a majority branch', () => {
  const original = branchOf(3, 'majority');

  it('adds an approver without moving the denominator or the threshold', () => {
    const before = tallyOf({ rule: 'majority' }, original, []);
    const after = tallyOf({ rule: 'majority' }, [...original, added(original)], []);

    // Three assigned, a threshold of two — `floor(3 / 2) + 1` — before and after. A fourth *row*
    // exists; a fourth *assigned approver* does not.
    expect([before.assigned, before.threshold]).toStrictEqual([3, 2]);
    expect([after.assigned, after.threshold]).toStrictEqual([3, 2]);
  });

  it('counts an escalated approval fully toward the outcome', () => {
    const steps = [...original, added(original)];
    const votes = [vote('step-1', 'approved'), vote('step-escalated', 'approved', 1)];
    const tally = tallyOf({ rule: 'majority' }, steps, votes);

    // One assigned approval and one escalated approval reach the threshold of two, which is the
    // whole of option (iii) for `majority`: a wider pool answering a number that did not move.
    expect(tally.outcome).toBe('approved');
    expect([tally.assigned, tally.threshold, tally.approvals]).toStrictEqual([3, 2, 2]);
  });

  it('marks the escalated step and leaves every assigned step unmarked', () => {
    const escalated = added(original);

    expect(escalated.escalatedAt).toStrictEqual(LATER);
    for (const step of original) {
      expect([step.stepId, step.escalatedAt]).toStrictEqual([step.stepId, undefined]);
    }
  });

  /**
   * A branch that could still be approved is not rejected because the assigned set ran out.
   *
   * Two assigned approvers have rejected and the third has approved, so **`outstanding` is zero** —
   * and the escalated approver has not answered. Counting only the assigned ones would put the
   * threshold out of reach and reject a branch whose escalated approver could still carry it.
   */
  it('keeps an escalated approver’s answer reachable after every assigned one has responded', () => {
    const steps = [...original, added(original)];
    const votes = [
      vote('step-1', 'approved'),
      vote('step-2', 'rejected', 1),
      vote('step-3', 'rejected', 2),
    ];
    const tally = tallyOf({ rule: 'majority' }, steps, votes);

    expect(tally.outstanding).toBe(0);
    expect(tally.outcome).toBe('awaiting');
    // And it does become rejected once nobody is left who could approve.
    const closed = tallyOf({ rule: 'majority' }, steps, [
      ...votes,
      vote('step-escalated', 'rejected', 3),
    ]);

    expect(closed.outcome).toBe('rejected');
  });
});

describe('escalating a first-response branch', () => {
  const original = branchOf(2, 'first-response');

  it('lets an escalated first response decide the branch', () => {
    const steps = [...original, added(original)];
    const tally = tallyOf({ rule: 'first-response' }, steps, [
      vote('step-escalated', 'approved', 5),
    ]);

    expect(tally.outcome).toBe('approved');
    expect([tally.assigned, tally.threshold]).toStrictEqual([2, 1]);
  });

  /** The order is the instant and then the identifier, escalated or not — 16B's rule, untouched. */
  it('keeps first-response ordering deterministic across escalated and assigned votes', () => {
    const steps = [...original, added(original)];
    const cast = [vote('step-escalated', 'rejected', 9), vote('step-1', 'approved', 2)];

    // The assigned approver answered first, so the branch is approved however the votes are ordered
    // in the array.
    expect(tallyOf({ rule: 'first-response' }, steps, cast).outcome).toBe('approved');
    expect(tallyOf({ rule: 'first-response' }, steps, [...cast].reverse()).outcome).toBe(
      'approved',
    );
  });

  it('restarts nothing: every assigned step keeps the instant its clock started', () => {
    const escalated = added(original);

    for (const step of original) {
      expect([step.stepId, step.awaitingAt]).toStrictEqual([step.stepId, AT]);
    }
    // The newcomer's own clock starts when they were added, which is P-5 rather than an exception.
    expect(escalated.awaitingAt).toStrictEqual(LATER);
    // And the target is the branch's, unchanged and not recomputed.
    expect(escalated.serviceLevel).toStrictEqual({ count: 2, unit: 'days' });
  });
});

describe('escalating a unanimous branch', () => {
  const original = branchOf(2, 'unanimous');

  it('refuses by its own name, distinct from every other refusal', () => {
    expect(refusal(escalate(original))).toBe('escalation-branch-is-unanimous');
  });

  it('creates no step, so the branch is exactly what it was', () => {
    const result = escalate(original);

    expect(result.ok).toBe(false);
    // Nothing to add means nothing added: the tally over the original steps is the only tally there
    // is, and no decision or history could exist for a step that was never created.
    const tally = tallyOf({ rule: 'unanimous' }, original, [vote('step-1', 'approved')]);

    expect([tally.assigned, tally.threshold, tally.outstanding]).toStrictEqual([2, 2, 1]);
    expect(tally.outcome).toBe('awaiting');
  });

  /**
   * The reason it is refused rather than reinterpreted, stated as arithmetic.
   *
   * For `unanimous` the threshold *is* the denominator. Had a third approver been added and counted,
   * two approvals would have reached a threshold of two while an assigned approver had never
   * answered — the branch completing without their consent, which is not what unanimity means.
   */
  it('would have completed without an assigned approver’s consent, which is why it cannot', () => {
    const hypothetical = tallyOf({ rule: 'unanimous' }, original, []);

    expect(hypothetical.threshold).toBe(hypothetical.assigned);
  });
});

describe('outstanding, over a branch that was escalated', () => {
  const original = branchOf(2, 'majority');

  /** The case the approval named: one assigned approver still owes an answer, and it reads as one. */
  it('counts the assigned approvers who have not answered, never a subtraction', () => {
    const steps = [...original, added(original)];
    const tally = tallyOf({ rule: 'majority' }, steps, [
      vote('step-1', 'approved'),
      vote('step-escalated', 'approved', 1),
    ]);

    // Two assigned, one of them silent. `assigned - responses` would be **zero** here and would say
    // nobody is owed an answer while `step-2` has never replied.
    expect(tally.outstanding).toBe(1);
    expect([tally.assigned, tally.threshold, tally.responses]).toStrictEqual([2, 2, 2]);
  });

  /** And it reaches zero honestly, without going below it. */
  it('reaches zero when every assigned approver has answered, and never goes negative', () => {
    const steps = [...original, added(original)];
    const tally = tallyOf({ rule: 'majority' }, steps, [
      vote('step-1', 'approved'),
      vote('step-2', 'approved', 1),
      vote('step-escalated', 'approved', 2),
    ]);

    // Three responses against a denominator of two. The old subtraction would have published −1.
    expect(tally.outstanding).toBe(0);
    expect(tally.responses).toBe(3);
    expect([tally.assigned, tally.threshold]).toStrictEqual([2, 2]);
  });

  it('never reports a negative outstanding, however many escalated approvers answer', () => {
    const many = [...original, added(original, 'membership-a'), added(original, 'membership-b')];
    const tally = tallyOf(
      { rule: 'majority' },
      many.map((step, index) => ({ ...step, stepId: `s${String(index)}` })),
      [
        vote('s0', 'approved'),
        vote('s1', 'approved', 1),
        vote('s2', 'approved', 2),
        vote('s3', 'approved', 3),
      ],
    );

    expect(tally.outstanding).toBeGreaterThanOrEqual(0);
    expect(tally.assigned).toBe(2);
  });
});
