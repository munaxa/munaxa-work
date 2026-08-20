import { describe, expect, it } from 'vitest';

import { escalateBranch } from './escalation.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * Who may be asked, once the branch itself is eligible.
 *
 * The sibling suite proves the three refusals that are about the **branch** — an approval that has
 * ended, a branch nobody is waiting on, a `unanimous` rule — and the two duplicates. This one is
 * about the two rules Phase 16D's approvals added, which are about the **person**: the requester may
 * not be asked to approve their own request (D-16D-13, B), and somebody already terminal on the
 * instance may not be asked again (D-16D-14, A).
 *
 * **The `skipped` case is the sharpest test here**, and it is a rule rather than an omission. A
 * skipped step is what happens to the steps after a rejection or a cancellation, and to steps a
 * condition excluded — the person it names never had a say. Refusing them would be refusing somebody
 * on the grounds that the process passed them by, so `skipped` is deliberately not terminal, and the
 * test below would fail if a later reader "tidied" the three statuses into one list.
 */

const AT = new Date('2026-08-18T09:00:00.000Z');
const LATER = new Date('2026-08-18T11:00:00.000Z');

const REQUESTER = 'membership-requester';

const instance = (status: WorkflowInstanceState['status'] = 'running'): WorkflowInstanceState => ({
  instanceId: 'instance-1',
  definitionId: 'definition-1',
  workflowVersionId: 'version-1',
  subjectType: 'recruitment.requisition',
  subjectId: 'requisition-1',
  requestedByMembershipId: REQUESTER,
  status,
  startedAt: AT,
  correlationId: 'correlation-1',
  context: {},
  version: 1,
});

const step = (
  stepId: string,
  membership: string,
  ordinal: number,
  status: WorkflowStepState['status'],
): WorkflowStepState => ({
  stepId,
  instanceId: 'instance-1',
  ordinal,
  approverKind: 'membership',
  approverMembershipId: membership,
  status,
  branchRule: 'majority',
  awaitingAt: AT,
  version: 1,
});

/**
 * An earlier branch somebody already answered, and a current branch of two being asked.
 *
 * Two ordinals rather than one, because the whole of D-5 is that it looks past the branch: a suite
 * built on a single ordinal could not tell "already terminal on the instance" from "already assigned
 * to this branch", and the second refusal would pass every test the first one did.
 */
const running = (earlier: WorkflowStepState['status'], who = 'membership-earlier') => [
  step('step-earlier', who, 1, earlier),
  step('step-1', 'membership-1', 2, 'awaiting'),
  step('step-2', 'membership-2', 2, 'awaiting'),
];

const escalate = (
  steps: readonly WorkflowStepState[],
  membership: string,
  ordinal = 2,
  status: WorkflowInstanceState['status'] = 'running',
) =>
  escalateBranch(instance(status), steps, {
    stepId: 'step-new',
    ordinal,
    approverMembershipId: membership,
    at: LATER,
    // Active, so these suites keep testing the rule each was written for. The eligibility rule has
    // its own suite; a fixture that defaulted to inactive would refuse here for the wrong reason.
    approverIsActive: true,
  });

const reasonOf = (
  steps: readonly WorkflowStepState[],
  membership: string,
  ordinal = 2,
  status: WorkflowInstanceState['status'] = 'running',
): string | undefined => {
  const outcome = escalate(steps, membership, ordinal, status);

  return outcome.ok ? undefined : outcome.error.reason;
};

describe('the requester may not be escalated', () => {
  it('refuses the membership that raised the approval, by its own name', () => {
    expect(reasonOf(running('approved'), REQUESTER)).toBe('escalation-approver-is-the-requester');
  });

  /**
   * **Its own refusal, not `manager-is-the-requester`.**
   *
   * The two say different things to different people. Manager routing's means "your reporting line
   * points at you", which is somebody's data to fix; this one means "you chose yourself", which is
   * the request to fix. An administrator sent to the reporting line by this refusal would find
   * nothing wrong there.
   */
  it('does not reuse the manager routing refusal', () => {
    expect(reasonOf(running('approved'), REQUESTER)).not.toBe('manager-is-the-requester');
  });

  it('still admits anybody else', () => {
    expect(escalate(running('approved'), 'membership-new').ok).toBe(true);
  });
});

describe('D-5, applied across the whole instance', () => {
  it.each([
    ['approved', 'escalation-approver-already-decided'],
    ['rejected', 'escalation-approver-already-decided'],
  ] as const)('refuses somebody who already %s at another ordinal', (status, expected) => {
    expect(reasonOf(running(status), 'membership-earlier')).toBe(expected);
  });

  /**
   * **`skipped` is not terminal for this rule** (D-16D-14, A).
   *
   * A step is skipped when a rejection, a cancellation or a condition removed it, so the person it
   * names was never asked anything. They are as eligible as somebody with no history at all, and
   * this asserts the *success* rather than the absence of one refusal — a test checking only that
   * the reason was not `already-decided` would pass if some other refusal had fired instead.
   */
  it('admits somebody whose earlier step was skipped', () => {
    expect(escalate(running('skipped'), 'membership-earlier').ok).toBe(true);
  });

  /** A step still waiting elsewhere is not terminal either: they have not had their say yet. */
  it('admits somebody still awaiting at another ordinal', () => {
    expect(escalate(running('awaiting'), 'membership-earlier').ok).toBe(true);
  });

  it('admits somebody with no prior step at all', () => {
    expect(escalate(running('approved'), 'membership-stranger').ok).toBe(true);
  });

  /**
   * The order of the refusals, where two could both be true.
   *
   * Somebody assigned to *this* branch who has already answered on it is both "already assigned" and
   * "already decided". The branch answer is the one that fires, because it is the one an
   * administrator can act on: they are on this branch already, and there is nothing to add.
   */
  it('prefers the branch refusal when somebody decided on the branch being escalated', () => {
    const steps = [
      step('step-earlier', 'membership-earlier', 1, 'approved'),
      step('step-1', 'membership-1', 2, 'approved'),
      step('step-2', 'membership-2', 2, 'awaiting'),
    ];

    expect(reasonOf(steps, 'membership-1')).toBe('escalation-approver-already-assigned');
  });

  /** Every refusal on this path is still its own, which is what makes the messages worth reading. */
  it('keeps the two new refusals distinct from each other and from the duplicates', () => {
    const named = [
      reasonOf(running('approved'), REQUESTER),
      reasonOf(running('approved'), 'membership-earlier'),
      reasonOf(running('approved'), 'membership-1'),
    ];

    expect(named).toStrictEqual([
      'escalation-approver-is-the-requester',
      'escalation-approver-already-decided',
      'escalation-approver-already-assigned',
    ]);
    expect(new Set(named).size).toBe(3);
  });
});

describe('what these rules do not do', () => {
  /**
   * The branch is judged before the person, still.
   *
   * A `unanimous` branch refuses for being unanimous even when the person named would also have been
   * refused — the branch cannot be escalated at all, so telling an administrator to pick somebody
   * else would send them to fix a request that has no fixed form.
   */
  it('refuses a unanimous branch before it considers who was named', () => {
    const steps = [
      { ...step('step-1', 'membership-1', 2, 'awaiting'), branchRule: 'unanimous' as const },
    ];

    expect(reasonOf(steps, REQUESTER)).toBe('escalation-branch-is-unanimous');
  });

  /** Nothing about an accepted escalation changed: it is still one awaiting membership step. */
  it('leaves the accepted step exactly as it was', () => {
    const outcome = escalate(running('skipped'), 'membership-new');

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toMatchObject({
      ordinal: 2,
      approverKind: 'membership',
      approverMembershipId: 'membership-new',
      status: 'awaiting',
      escalatedAt: LATER,
    });
  });
});

/**
 * All seven, in one place, each its own.
 *
 * The sibling suite asserts the five that existed before this phase and this file asserts the two it
 * added, but neither on its own shows that the **whole** set is distinct — and distinctness is the
 * property that makes a refusal worth reading, because each one sends a different person to fix a
 * different thing. Collapsing any two would still pass a suite that only checked them in groups.
 */
describe('every escalation refusal, distinct', () => {
  it('names seven different situations', () => {
    const awaiting = running('skipped');
    const escalated: WorkflowStepState = {
      ...step('step-added', 'membership-added', 2, 'awaiting'),
      escalatedAt: LATER,
    };
    const named = [
      reasonOf(awaiting, 'membership-new', 2, 'cancelled'),
      reasonOf(awaiting, 'membership-new', 9),
      reasonOf(
        [{ ...step('step-u', 'membership-u', 2, 'awaiting'), branchRule: 'unanimous' }],
        'membership-new',
      ),
      reasonOf(awaiting, 'membership-1'),
      reasonOf([...awaiting, escalated], 'membership-added'),
      reasonOf(awaiting, REQUESTER),
      reasonOf(running('approved'), 'membership-earlier'),
    ];

    expect(named).toStrictEqual([
      'escalation-instance-not-running',
      'escalation-branch-not-awaiting',
      'escalation-branch-is-unanimous',
      'escalation-approver-already-assigned',
      'escalation-already-escalated',
      'escalation-approver-is-the-requester',
      'escalation-approver-already-decided',
    ]);
    expect(new Set(named).size).toBe(7);
  });
});

/**
 * The seventh rule: the person must be able to act at all (D-16D-12, A).
 *
 * The fact is Identity's and arrives resolved, so what the domain owns — and what these assert — is
 * only what it *means*: one refusal for both of Identity's negative answers (D-16D-17, A), checked
 * after everything the branch could already have said.
 */
describe('an approver who may not act', () => {
  const inactive = (steps: readonly WorkflowStepState[], membership: string) =>
    escalateBranch(instance(), steps, {
      stepId: 'step-new',
      ordinal: 2,
      approverMembershipId: membership,
      at: LATER,
      approverIsActive: false,
    });

  it('refuses by the approved single name', () => {
    const outcome = inactive(running('skipped'), 'membership-new');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe('escalation-approver-not-eligible');
  });

  /**
   * **The same refusal whichever way Identity said no**, which is the whole of D-16D-17 (A).
   *
   * Both of Identity's negative answers — a membership that exists and may not act, and an identifier
   * naming nobody — reach the domain as `false`, and the domain has one name for the pair. Asserting
   * the *name* rather than merely "it refused" is what stops a later reader splitting it back into
   * two without a decision.
   */
  it('says nothing about which of the two reasons applied', () => {
    const outcome = inactive(running('skipped'), 'membership-stranger');

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.reason).toBe('escalation-approver-not-eligible');
      for (const split of ['inactive', 'suspended', 'ended', 'not-found', 'missing']) {
        expect([split, outcome.error.reason.includes(split)]).toStrictEqual([split, false]);
      }
    }
  });

  /**
   * **Checked last**, so a branch problem is still reported as a branch problem.
   *
   * An inactive membership named on a `unanimous` branch is refused for the branch: that request has
   * no valid form at all, and telling an administrator to pick somebody else would send them to solve
   * the wrong problem. The same holds for somebody already on the branch.
   */
  it.each([
    [
      'a unanimous branch',
      [{ ...step('step-u', 'membership-u', 2, 'awaiting'), branchRule: 'unanimous' as const }],
      'membership-new',
      'escalation-branch-is-unanimous',
    ],
    [
      'somebody already assigned',
      running('skipped'),
      'membership-1',
      'escalation-approver-already-assigned',
    ],
    ['the requester', running('skipped'), REQUESTER, 'escalation-approver-is-the-requester'],
  ])('yields to %s', (_what, steps, membership, expected) => {
    const outcome = inactive(steps, membership);

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.reason).toBe(expected);
  });

  /** And all eight refusals are still distinct from one another. */
  it('is an eighth name, not a rename of an existing one', () => {
    const named = [
      reasonOf(running('skipped'), 'membership-new', 2, 'cancelled'),
      reasonOf(running('skipped'), 'membership-new', 9),
      reasonOf(
        [{ ...step('step-u', 'membership-u', 2, 'awaiting'), branchRule: 'unanimous' }],
        'membership-new',
      ),
      reasonOf(running('skipped'), 'membership-1'),
      reasonOf(running('skipped'), REQUESTER),
      reasonOf(running('approved'), 'membership-earlier'),
      'escalation-approver-not-eligible',
    ];

    expect(new Set(named).size).toBe(7);
    expect(named).toContain('escalation-approver-not-eligible');
  });
});
