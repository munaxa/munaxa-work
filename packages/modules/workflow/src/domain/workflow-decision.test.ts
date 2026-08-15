import { describe, expect, it } from 'vitest';

import { approvalStateOf, authorityIsCoherent, decide } from './decision.js';
import { cancelInstance } from './instance.js';
import { AT, must, startedInstance } from './workflow-fixtures.js';
import { AUTO_APPROVAL, REACHABLE_APPROVAL_STATES } from './workflow-vocabulary.js';

const reasonOf = (result: { ok: boolean; error?: { reason: string } }): string | undefined =>
  result.ok ? undefined : result.error?.reason;

/** One approval by the assigned approver of whichever step is currently awaiting. */
const approveCurrent = (
  state: ReturnType<typeof startedInstance>,
  steps: readonly { readonly stepId: string; readonly approverMembershipId: string }[],
  index: number,
): ReturnType<typeof decide> => {
  const step = state.steps[index];

  if (step === undefined) throw new Error('The fixture has no such step.');

  return decide(state.instance, { ...step, status: 'awaiting' }, state.steps, {
    decisionId: `decision-${String(index + 1)}`,
    decision: 'approved',
    decidedByMembershipId: steps[index]?.approverMembershipId ?? '',
    authority: 'assigned',
    at: AT,
  });
};

describe('deciding a step', () => {
  it('advances to the next branch by ordinal and leaves the instance running', () => {
    const started = startedInstance(3);
    const decided = must(approveCurrent(started, started.steps, 0), 'an approval');

    expect(decided.step.status).toBe('approved');
    // `next` is the branch that opens, not a step. A sequential chain opens a branch of one, which
    // is what every 16A version produces and why their behaviour is unchanged.
    expect(decided.next.map((step) => step.ordinal)).toEqual([2]);
    expect(decided.next.map((step) => step.status)).toEqual(['awaiting']);
    expect(decided.instance.status).toBe('running');
    expect(decided.skipped).toStrictEqual([]);
    // And the branch of one was decided by the one person in it.
    expect(decided.tally).toMatchObject({
      assigned: 1,
      approvals: 1,
      threshold: 1,
      outcome: 'approved',
    });
  });

  it('completes the instance when the last step is approved', () => {
    const started = startedInstance(1);
    const decided = must(approveCurrent(started, started.steps, 0), 'an approval');

    // An empty branch rather than an absent one: `next` is "who is asked now", and nobody is.
    expect(decided.next).toStrictEqual([]);
    expect(decided.instance.status).toBe('completed');
    expect(decided.instance.completedAt).toStrictEqual(AT);
  });

  it('ends the instance on a rejection and skips every remaining step', () => {
    const started = startedInstance(3);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    const decided = must(
      decide(started.instance, first, started.steps, {
        decisionId: 'decision-1',
        decision: 'rejected',
        decidedByMembershipId: first.approverMembershipId,
        authority: 'assigned',
        at: AT,
        comment: 'Not this quarter.',
      }),
      'a rejection',
    );

    expect(decided.step.status).toBe('rejected');
    expect(decided.instance.status).toBe('rejected');
    expect(decided.skipped.map((step) => step.ordinal)).toStrictEqual([2, 3]);
    // An empty branch rather than an absent one: `next` is "who is asked now", and nobody is.
    expect(decided.next).toStrictEqual([]);
  });

  it('runs no tally: one rejection at step one ends it, whatever the later steps would have said', () => {
    // The assertion that keeps Phase 16B out of 16A. There is no denominator, no threshold and no
    // majority anywhere — a rejection is the end because one step is awaiting at a time (D-6).
    const started = startedInstance(5);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    const decided = must(
      decide(started.instance, first, started.steps, {
        decisionId: 'd',
        decision: 'rejected',
        decidedByMembershipId: first.approverMembershipId,
        authority: 'assigned',
        at: AT,
      }),
      'a rejection',
    );

    expect(decided.skipped).toHaveLength(4);
    expect(decided.instance.status).toBe('rejected');
  });

  it('refuses a decision on a step that is not awaiting one', () => {
    const started = startedInstance(3);
    const second = started.steps[1];

    if (second === undefined) throw new Error('The fixture has no second step.');

    expect(
      reasonOf(
        decide(started.instance, second, started.steps, {
          decisionId: 'd',
          decision: 'approved',
          decidedByMembershipId: second.approverMembershipId,
          authority: 'assigned',
          at: AT,
        }),
      ),
    ).toBe('step-not-awaiting-a-decision');
  });

  it('refuses a decision once the instance has ended', () => {
    const started = startedInstance(2);
    const cancelled = must(
      cancelInstance(started.instance, started.steps, { by: 'u', reason: 'stopped', at: AT }),
      'a cancellation',
    );
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    expect(
      reasonOf(
        decide(cancelled.instance, first, started.steps, {
          decisionId: 'd',
          decision: 'approved',
          decidedByMembershipId: first.approverMembershipId,
          authority: 'assigned',
          at: AT,
        }),
      ),
    ).toBe('instance-not-running');
  });

  it('refuses a step belonging to another instance', () => {
    const started = startedInstance(1);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    expect(
      reasonOf(
        decide(started.instance, { ...first, instanceId: 'another' }, started.steps, {
          decisionId: 'd',
          decision: 'approved',
          decidedByMembershipId: first.approverMembershipId,
          authority: 'assigned',
          at: AT,
        }),
      ),
    ).toBe('step-not-on-this-instance');
  });

  it('refuses the auto-approving actor outright', () => {
    const started = startedInstance(1);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    expect(
      reasonOf(
        decide(started.instance, { ...first, approverMembershipId: AUTO_APPROVAL }, started.steps, {
          decisionId: 'd',
          decision: 'approved',
          decidedByMembershipId: AUTO_APPROVAL,
          authority: 'assigned',
          at: AT,
        }),
      ),
    ).toBe('decision-requires-a-person');
  });
});

describe('who may decide, and on whose authority', () => {
  const step = {
    stepId: 'step-1',
    instanceId: 'instance-1',
    ordinal: 1,
    approverKind: 'membership' as const,
    approverMembershipId: 'membership-one',
    status: 'awaiting' as const,
    version: 1,
  };
  const base = { decisionId: 'd', decision: 'approved' as const, at: AT };

  it('accepts the assigned approver acting for themselves', () => {
    const checked = authorityIsCoherent(step, {
      ...base,
      decidedByMembershipId: 'membership-one',
      authority: 'assigned',
    });

    expect(checked.ok && checked.value).toBe('assigned');
  });

  it('refuses somebody who is not the assigned approver', () => {
    expect(
      reasonOf(
        authorityIsCoherent(step, {
          ...base,
          decidedByMembershipId: 'membership-two',
          authority: 'assigned',
        }),
      ),
    ).toBe('decision-not-the-assigned-approver');
  });

  it('accepts a delegate acting for the assigned approver, and records both', () => {
    const started = startedInstance(1);
    const first = started.steps[0];

    if (first === undefined) throw new Error('The fixture has no first step.');

    const decided = must(
      decide(started.instance, first, started.steps, {
        decisionId: 'd',
        decision: 'approved',
        decidedByMembershipId: 'membership-deputy',
        authority: 'delegated',
        onBehalfOfMembershipId: first.approverMembershipId,
        at: AT,
      }),
      'a delegated approval',
    );

    // Nobody is impersonated: the actor is the delegate, and the authority is recorded beside it.
    expect(decided.decision.decidedByMembershipId).toBe('membership-deputy');
    expect(decided.decision.onBehalfOfMembershipId).toBe(first.approverMembershipId);
    expect(decided.decision.authority).toBe('delegated');
  });

  it('refuses a delegation that names somebody other than this step’s approver', () => {
    expect(
      reasonOf(
        authorityIsCoherent(step, {
          ...base,
          decidedByMembershipId: 'membership-deputy',
          authority: 'delegated',
          onBehalfOfMembershipId: 'membership-three',
        }),
      ),
    ).toBe('delegation-names-another-approver');
  });

  it('refuses a delegated decision that names nobody, and an assigned one that names somebody', () => {
    expect(
      reasonOf(
        authorityIsCoherent(step, {
          ...base,
          decidedByMembershipId: 'membership-deputy',
          authority: 'delegated',
        }),
      ),
    ).toBe('delegation-subject-required');

    expect(
      reasonOf(
        authorityIsCoherent(step, {
          ...base,
          decidedByMembershipId: 'membership-one',
          authority: 'assigned',
          onBehalfOfMembershipId: 'membership-one',
        }),
      ),
    ).toBe('authority-not-delegated');
  });

  it('refuses a delegation the approver did not need', () => {
    expect(
      reasonOf(
        authorityIsCoherent(step, {
          ...base,
          decidedByMembershipId: 'membership-one',
          authority: 'delegated',
          onBehalfOfMembershipId: 'membership-one',
        }),
      ),
    ).toBe('delegation-not-required');
  });
});

describe('the state this module reports at the port', () => {
  it('maps every instance status onto ApprovalPort’s vocabulary', () => {
    expect(approvalStateOf('running')).toBe('pending');
    expect(approvalStateOf('completed')).toBe('approved');
    expect(approvalStateOf('rejected')).toBe('rejected');
    expect(approvalStateOf('cancelled')).toBe('cancelled');
  });

  it('never reports expired, because nothing in 16A expires anything', () => {
    const reported = (['running', 'completed', 'rejected', 'cancelled'] as const).map(
      approvalStateOf,
    );

    expect(reported).not.toContain('expired');
    expect([...REACHABLE_APPROVAL_STATES]).not.toContain('expired');
  });
});
