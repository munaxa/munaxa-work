import { describe, expect, it } from 'vitest';

import { addStep, createDefinition, draftVersion, publishVersion } from './definition.js';
import { decide } from './decision.js';
import { startInstance, type StartedInstance } from './instance.js';
import { startHistory } from './history.js';
import { must, AT } from './workflow-fixtures.js';
import type { BranchCondition } from './condition.js';
import type { BranchRule } from './workflow-vocabulary.js';
import type { BranchVote } from './branch.js';

/**
 * Parallel branches and conditional routing, as an approval actually runs them.
 *
 * The tally arithmetic and the condition grammar have suites of their own, and the group snapshot
 * has a neighbouring file. This is about what happens to an **instance**: who is asked at once, what
 * becomes of the people who no longer need to answer, and which branch runs next.
 */

const NAME = { en: 'Step', ar: 'خطوة' };
const A = 'membership-a';
const B = 'membership-b';
const C = 'membership-c';

interface BranchSpec {
  readonly ordinal: number;
  readonly approvers: readonly string[];
  readonly rule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchCondition[];
}

/** A published version whose branches are exactly as described, built through the real constructors. */
const publishedBranches = (branches: readonly BranchSpec[]) => {
  const definition = must(
    createDefinition({
      definitionId: 'definition-1',
      code: 'branching',
      name: { en: 'Branching', ar: 'تفرع' },
      subjectType: 'a.subject',
    }),
    'a definition',
  );
  const draft = must(
    draftVersion(definition, { workflowVersionId: 'version-1', versionNumber: 1 }),
    'a draft',
  );
  let sequence = 0;
  const templates = branches.flatMap((branch) =>
    branch.approvers.map((approver) => {
      sequence += 1;
      return must(
        addStep(draft, {
          stepTemplateId: `template-${String(sequence)}`,
          ordinal: branch.ordinal,
          name: NAME,
          approverKind: 'membership',
          approverMembershipId: approver,
          ...(branch.rule === undefined ? {} : { branchRule: branch.rule }),
          ...(branch.quorum === undefined ? {} : { quorum: branch.quorum }),
          ...(branch.condition === undefined ? {} : { condition: branch.condition }),
        }),
        `a step at ordinal ${String(branch.ordinal)}`,
      );
    }),
  );

  return {
    version: must(publishVersion(draft, templates, AT, 'user:admin'), 'a published version'),
    templates,
  };
};

const start = (
  branches: readonly BranchSpec[],
  context: Readonly<Record<string, unknown>> = {},
): StartedInstance => {
  const { version, templates } = publishedBranches(branches);

  return must(
    startInstance(version, templates, {
      instanceId: 'instance-1',
      subjectType: 'a.subject',
      subjectId: 'subject-1',
      requestedByMembershipId: 'membership-requester',
      correlationId: 'correlation-1',
      context,
      at: AT,
      stepIds: templates.map((_, index) => `step-${String(index + 1)}`),
    }),
    'a started instance',
  );
};

/** One approval by the membership assigned to a named step, carrying the votes already cast. */
const approve = (
  started: StartedInstance,
  stepId: string,
  votes: readonly BranchVote[] = [],
  decision: 'approved' | 'rejected' = 'approved',
) => {
  const step = started.steps.find((candidate) => candidate.stepId === stepId);

  if (step === undefined) throw new Error(`No step ${stepId}.`);

  return must(
    decide(
      started.instance,
      step,
      started.steps,
      {
        decisionId: `decision-${stepId}`,
        decision,
        decidedByMembershipId: step.approverMembershipId,
        authority: 'assigned',
        at: AT,
      },
      votes,
    ),
    `a decision on ${stepId}`,
  );
};

describe('a parallel branch', () => {
  it('asks everybody at once, and keeps the approval running until the rule is satisfied', () => {
    const started = start([{ ordinal: 1, approvers: [A, B, C], rule: 'majority' }]);

    expect(started.steps.map((step) => step.status)).toStrictEqual([
      'awaiting',
      'awaiting',
      'awaiting',
    ]);

    const first = approve(started, 'step-1');

    expect(first.tally).toMatchObject({
      assigned: 3,
      approvals: 1,
      threshold: 2,
      outcome: 'awaiting',
    });
    expect(first.instance.status).toBe('running');
    // Nobody else's queue moved: the branch is still open.
    expect(first.next).toStrictEqual([]);
    expect(first.skipped).toStrictEqual([]);
  });

  /**
   * The early termination rule: two of three is a majority, so the third no longer needs to answer
   * and their step is **skipped**. Leaving it awaiting would keep a decided approval on somebody's
   * queue, which is the whole reason `skipped` exists.
   */
  it('skips the approvers who no longer need to answer once the outcome is determined', () => {
    const started = start([{ ordinal: 1, approvers: [A, B, C], rule: 'majority' }]);
    const votes: BranchVote[] = [{ stepId: 'step-1', decision: 'approved', decidedAt: AT }];
    const second = approve(started, 'step-2', votes);

    expect(second.tally.outcome).toBe('approved');
    expect(second.instance.status).toBe('completed');
    expect(second.skipped.map((step) => step.stepId)).toStrictEqual(['step-3']);
    expect(second.skipped.map((step) => step.status)).toStrictEqual(['skipped']);
  });

  it('rejects the instance when the branch cannot be approved', () => {
    const started = start([{ ordinal: 1, approvers: [A, B, C], rule: 'unanimous' }]);
    const rejected = approve(started, 'step-1', [], 'rejected');

    expect(rejected.tally.outcome).toBe('rejected');
    expect(rejected.instance.status).toBe('rejected');
    expect(rejected.skipped.map((step) => step.stepId).sort()).toStrictEqual(['step-2', 'step-3']);
  });

  /** And a second branch opens for everybody in it, not for one of them. */
  it('opens the whole of the next branch when this one is approved', () => {
    const started = start([
      { ordinal: 1, approvers: [A] },
      { ordinal: 2, approvers: [B, C], rule: 'unanimous' },
    ]);
    const decided = approve(started, 'step-1');

    expect(decided.instance.status).toBe('running');
    expect(decided.next.map((step) => step.stepId)).toStrictEqual(['step-2', 'step-3']);
    expect(decided.next.every((step) => step.status === 'awaiting')).toBe(true);
  });
});

describe('a condition decides whether a branch runs', () => {
  const gated: readonly BranchCondition[] = [
    { key: 'amount', operator: 'greater-than', value: 10_000 },
  ];

  it('opens the gated branch when it holds', () => {
    const started = start(
      [
        { ordinal: 1, approvers: [A] },
        { ordinal: 2, approvers: [B], condition: gated },
      ],
      { amount: 50_000 },
    );
    const decided = approve(started, 'step-1');

    expect(decided.next.map((step) => step.stepId)).toStrictEqual(['step-2']);
    expect(decided.instance.status).toBe('running');
  });

  it('skips the gated branch when it does not, and completes if nothing follows', () => {
    const started = start(
      [
        { ordinal: 1, approvers: [A] },
        { ordinal: 2, approvers: [B], condition: gated },
      ],
      { amount: 500 },
    );
    const decided = approve(started, 'step-1');

    expect(decided.next).toStrictEqual([]);
    expect(decided.skipped.map((step) => step.stepId)).toStrictEqual(['step-2']);
    expect(decided.instance.status).toBe('completed');
  });

  /**
   * Fail closed. A condition naming a key the request did not carry refuses the **decision** — the
   * approver is told, nothing is written, and the approval stays exactly where it was. An earlier
   * draft of `approvedOutcome` swallowed this and completed the approval instead.
   */
  it('refuses the decision when a condition cannot be evaluated', () => {
    const started = start(
      [
        { ordinal: 1, approvers: [A] },
        {
          ordinal: 2,
          approvers: [B],
          condition: [{ key: 'absent', operator: 'equals', value: 1 }],
        },
      ],
      { amount: 500 },
    );
    const step = started.steps[0];

    if (step === undefined) throw new Error('no first step');

    const refused = decide(started.instance, step, started.steps, {
      decisionId: 'd',
      decision: 'approved',
      decidedByMembershipId: step.approverMembershipId,
      authority: 'assigned',
      at: AT,
    });

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.reason).toBe('condition-key-missing');
  });

  /**
   * Every branch gated out: nobody is asked, so the approval is complete the instant it is raised.
   *
   * A tenant configured that — "below this amount, nobody approves" — and the record says so plainly:
   * every step skipped, and an `instance-completed` entry. It is not the product approving on their
   * behalf, which is what `AutoApprovingPort` did and why it was replaced.
   */
  it('completes at once when no branch runs, and says so in the timeline', () => {
    const started = start([{ ordinal: 1, approvers: [A], condition: gated }], { amount: 500 });

    expect(started.instance.status).toBe('completed');
    expect(started.instance.completedAt).toStrictEqual(AT);
    expect(started.steps.map((step) => step.status)).toStrictEqual(['skipped']);

    const history = startHistory(started, ['h1', 'h2', 'h3']);

    expect(history.map((entry) => entry.event)).toStrictEqual([
      'instance-started',
      'step-skipped',
      'instance-completed',
    ]);
  });

  it('refuses to start at all when an opening condition cannot be evaluated', () => {
    const { version, templates } = publishedBranches([
      { ordinal: 1, approvers: [A], condition: gated },
    ]);
    const refused = startInstance(version, templates, {
      instanceId: 'i',
      subjectType: 'a.subject',
      subjectId: 's',
      requestedByMembershipId: 'membership-requester',
      correlationId: 'c',
      context: {},
      at: AT,
      stepIds: ['s1'],
    });

    expect(refused.ok).toBe(false);
  });
});

describe('what a version may be published with', () => {
  const reasonOf = (branches: readonly BranchSpec[]): string => {
    try {
      publishedBranches(branches);
      return 'accepted';
    } catch (error: unknown) {
      return error instanceof Error ? error.message : 'unknown';
    }
  };

  it('refuses a branch whose steps disagree about the rule', () => {
    expect(reasonOf([{ ordinal: 1, approvers: [A] }])).toBe('accepted');
    // Two steps at one ordinal, one saying majority and one saying unanimous.
    const definition = must(
      createDefinition({
        definitionId: 'd',
        code: 'mixed',
        name: { en: 'Mixed', ar: 'مختلط' },
        subjectType: 'a.subject',
      }),
      'a definition',
    );
    const draft = must(
      draftVersion(definition, { workflowVersionId: 'v', versionNumber: 1 }),
      'a draft',
    );
    const one = must(
      addStep(draft, {
        stepTemplateId: 't1',
        ordinal: 1,
        name: NAME,
        approverKind: 'membership',
        approverMembershipId: A,
        branchRule: 'majority',
      }),
      'a step',
    );
    const other = must(
      addStep(draft, {
        stepTemplateId: 't2',
        ordinal: 1,
        name: NAME,
        approverKind: 'membership',
        approverMembershipId: B,
        branchRule: 'unanimous',
      }),
      'a step',
    );
    const refused = publishVersion(draft, [one, other], AT, 'user:admin');

    expect(refused.ok).toBe(false);
    expect(refused.ok ? '' : refused.error.reason).toBe('branch-rule-inconsistent');
  });

  it('refuses a quorum larger than its branch', () => {
    expect(reasonOf([{ ordinal: 1, approvers: [A, B], quorum: 3 }])).toContain(
      'branch-quorum-exceeds-approvers',
    );
  });

  it('refuses a step naming both a person and a group, and one naming neither', () => {
    const definition = must(
      createDefinition({
        definitionId: 'd',
        code: 'ambiguous',
        name: { en: 'A', ar: 'أ' },
        subjectType: 'a.subject',
      }),
      'a definition',
    );
    const draft = must(
      draftVersion(definition, { workflowVersionId: 'v', versionNumber: 1 }),
      'a draft',
    );
    const both = addStep(draft, {
      stepTemplateId: 't',
      ordinal: 1,
      name: NAME,
      approverKind: 'membership',
      approverMembershipId: A,
      approverGroupId: 'g',
    });
    const neither = addStep(draft, {
      stepTemplateId: 't',
      ordinal: 1,
      name: NAME,
      approverKind: 'group',
    });

    expect(both.ok ? '' : both.error.reason).toBe('step-approver-ambiguous');
    expect(neither.ok ? '' : neither.error.reason).toBe('step-approver-required');
  });
});
