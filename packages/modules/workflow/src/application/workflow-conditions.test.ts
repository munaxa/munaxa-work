import { beforeEach, describe, expect, it } from 'vitest';

import type { BranchCondition } from '../domain/condition.js';
import type { WorkflowInstanceDetailView, WorkflowHistoryView } from '../contracts/views.js';
import { decideAs, publishedBranches, startedOn } from './workflow-scenarios.js';
import {
  APPROVER,
  DEPUTY,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  ask,
  attempt,
  failureOf,
  harnessFor,
  send,
  type Harness,
} from './workflow-test-harness.js';
import type { Page } from './workflow-ports.js';

/**
 * Conditional branching, through the real handlers.
 *
 * A condition is `(key, operator, value)` read against the instance's own `context` — the payload
 * the requesting module supplied, stored since 16A and until this phase read by nothing. There is no
 * `or`, no nesting, no arithmetic and no cross-module read: the whole grammar is five operators
 * combined by `all-of`.
 *
 * **The rule this file exists for is that a condition which cannot be evaluated refuses the
 * operation.** A missing key, an unsupported operand and a type mismatch are each an error, and none
 * of them is `false`. Collapsing any of them into "the branch does not run" would route an approval
 * *somewhere* — quietly skipping the finance director because a requesting module spelled a key
 * differently — and the failure would look like a correctly working process to everybody involved.
 *
 * The application's job is to preserve that distinction rather than to make it: the domain returns a
 * refusal, and these assertions are that it reaches the caller and that nothing was written.
 */

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

const timelineOf = (harness: Harness, instanceId: string): Promise<Page<WorkflowHistoryView>> =>
  ask<Page<WorkflowHistoryView>>(harness, { queryName: 'workflow.read-history', instanceId });

const OVER_FIFTY: BranchCondition = { key: 'amount', operator: 'greater-than', value: 50_000 };

describe('a branch that runs only sometimes', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  /** Two branches: everybody, then a second one gated on the condition under test. */
  const gatedOn = async (
    condition: readonly BranchCondition[],
    context: Readonly<Record<string, unknown>>,
    subjectId: string,
  ): Promise<string> => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverMembershipId: SECOND_APPROVER, condition },
      ],
      `gated-${subjectId}`,
    );

    return startedOn(harness, process, subjectId, context);
  };

  it('runs the branch when its condition holds', async () => {
    const instanceId = await gatedOn([OVER_FIFTY], { amount: 60_000 }, 'requisition-over');

    await decideAs(harness, APPROVER, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    expect(detail.instance.status).toBe('running');
    expect(detail.awaitingSteps.map((step) => step.approverMembershipId)).toStrictEqual([
      SECOND_APPROVER,
    ]);
  });

  it('skips the branch when its condition does not hold, and says so in the timeline', async () => {
    const instanceId = await gatedOn([OVER_FIFTY], { amount: 10_000 }, 'requisition-under');

    await decideAs(harness, APPROVER, instanceId, 'approved');

    const detail = await detailOf(harness, instanceId);

    expect(detail.instance.status).toBe('completed');
    expect(
      detail.steps.find((step) => step.approverMembershipId === SECOND_APPROVER),
    ).toMatchObject({ status: 'skipped' });

    // A stage that existed and was not run has to appear: an approval that silently omitted it would
    // look like a process that never had that stage.
    const timeline = await timelineOf(harness, instanceId);

    expect(timeline.items.map((entry) => entry.event)).toContain('step-skipped');
    expect(timeline.items.map((entry) => entry.event)).toContain('instance-completed');
  });

  it('compares each of the five operators against the instance’s own context', async () => {
    const cases: readonly (readonly [BranchCondition, Record<string, unknown>, boolean])[] = [
      [{ key: 'kind', operator: 'equals', value: 'capital' }, { kind: 'capital' }, true],
      [{ key: 'kind', operator: 'not-equals', value: 'capital' }, { kind: 'capital' }, false],
      [{ key: 'amount', operator: 'greater-than', value: 100 }, { amount: 101 }, true],
      [{ key: 'amount', operator: 'less-than', value: 100 }, { amount: 101 }, false],
      [{ key: 'unit', operator: 'in', value: ['a', 'b'] }, { unit: 'b' }, true],
    ];

    for (const [index, [condition, context, runs]] of cases.entries()) {
      const instanceId = await gatedOn([condition], context, `requisition-op-${String(index)}`);

      await decideAs(harness, APPROVER, instanceId, 'approved');

      const detail = await detailOf(harness, instanceId);

      expect([condition.operator, detail.instance.status]).toStrictEqual([
        condition.operator,
        runs ? 'running' : 'completed',
      ]);
    }
  });

  it('runs a branch only when every condition of an all-of holds', async () => {
    const both: readonly BranchCondition[] = [
      OVER_FIFTY,
      { key: 'kind', operator: 'equals', value: 'capital' },
    ];
    const holds = await gatedOn(both, { amount: 60_000, kind: 'capital' }, 'requisition-both');
    const fails = await gatedOn(both, { amount: 60_000, kind: 'revenue' }, 'requisition-one');

    await decideAs(harness, APPROVER, holds, 'approved');
    await decideAs(harness, APPROVER, fails, 'approved');

    expect(await detailOf(harness, holds).then((detail) => detail.instance.status)).toBe('running');
    expect(await detailOf(harness, fails).then((detail) => detail.instance.status)).toBe(
      'completed',
    );
  });

  it('completes at the instant it started when every branch is gated out', async () => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, condition: [OVER_FIFTY] }],
      'gated-nobody',
    );
    const instanceId = await startedOn(harness, process, 'requisition-nobody', { amount: 10 });
    const detail = await detailOf(harness, instanceId);

    // A tenant configured "below this amount, nobody approves", and that is not the product
    // approving on their behalf: every step is skipped and the record says plainly nobody was asked.
    expect(detail.instance.status).toBe('completed');
    expect(detail.instance.completedOn).toBe(detail.instance.startedOn);
    expect(detail.steps.every((step) => step.status === 'skipped')).toBe(true);
    expect(detail.awaitingSteps).toStrictEqual([]);
  });
});

describe('a condition that cannot be evaluated refuses, and never resolves to false', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  const started = async (
    condition: BranchCondition,
    context: Readonly<Record<string, unknown>>,
    subjectId: string,
  ): Promise<{ readonly definitionId: string; readonly refusal: string | undefined }> => {
    const process = await publishedBranches(
      harness,
      [{ ordinal: 1, approverMembershipId: APPROVER, condition: [condition] }],
      `unevaluable-${subjectId}`,
    );
    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId,
        context,
      }),
    );

    return { definitionId: process.definitionId, refusal: failureOf(refused) };
  };

  it('refuses a start whose context is missing the key the condition reads', async () => {
    const attempted = await started(OVER_FIFTY, { total: 60_000 }, 'requisition-missing');

    expect(attempted.refusal).toBe('workflow.rejection.condition-key-missing');
  });

  it('refuses an operand it cannot compare and one of the wrong kind', async () => {
    const unsupported = await started(
      { key: 'amount', operator: 'equals', value: 1 },
      { amount: { nested: true } },
      'requisition-unsupported',
    );
    const mismatched = await started(OVER_FIFTY, { amount: 'lots' }, 'requisition-mismatched');

    // Three different mistakes and three different reasons. Collapsing them into one would tell an
    // administrator that somebody else's payload was malformed without saying how.
    expect(unsupported.refusal).toBe('workflow.rejection.condition-operand-unsupported');
    expect(mismatched.refusal).toBe('workflow.rejection.condition-operand-mismatched');
  });

  it('writes nothing at all when a start is refused', async () => {
    await started(OVER_FIFTY, { total: 1 }, 'requisition-nothing');

    const instances = await ask<Page<unknown>>(harness, {
      queryName: 'workflow.search-instances',
      subjectId: 'requisition-nothing',
    });

    // Fail closed means closed: no instance, no steps, no timeline. A start that half-wrote itself
    // would leave an approval nobody could complete and nobody raised.
    expect(instances.total).toBe(0);
  });

  /**
   * **The same rule at the other moment it matters**, and the one an earlier draft of the domain got
   * wrong: a condition that cannot be evaluated when the *next* branch is chosen must refuse the
   * decision rather than completing the approval as though nothing followed.
   */
  it('refuses a decision when the branch that would follow cannot be evaluated', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        {
          ordinal: 2,
          approverMembershipId: SECOND_APPROVER,
          condition: [{ key: 'absent', operator: 'equals', value: 'x' }],
        },
      ],
      'gated-later',
    );
    const instanceId = await startedOn(harness, process, 'requisition-later', { amount: 1 });
    const refused = await decideAs(harness, APPROVER, instanceId, 'approved');
    const detail = await detailOf(harness, instanceId);

    expect(failureOf(refused)).toBe('workflow.rejection.condition-key-missing');
    // The approval stays exactly where it was: no decision recorded, the approver still asked.
    expect(detail.decisions).toStrictEqual([]);
    expect(detail.instance.status).toBe('running');
    expect(detail.awaitingSteps.map((step) => step.approverMembershipId)).toStrictEqual([APPROVER]);
  });
});

describe('a running approval follows the process it started under', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('keeps its own copy of the condition, the rule and the approvers', async () => {
    const process = await publishedBranches(
      harness,
      [
        { ordinal: 1, approverMembershipId: APPROVER },
        { ordinal: 2, approverMembershipId: SECOND_APPROVER, condition: [OVER_FIFTY] },
      ],
      'snapshot-process',
    );
    const instanceId = await startedOn(harness, process, 'requisition-snapshot', {
      amount: 60_000,
    });

    // A second version, published after the approval started, routing somewhere else entirely: one
    // approver, nobody gated, and no second branch at all.
    const drafted = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });

    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: drafted.workflowVersionId,
      ordinal: 1,
      name: { en: 'Only', ar: 'فقط' },
      approverMembershipId: DEPUTY,
    });
    await send(harness, {
      commandName: 'workflow.publish-version',
      workflowVersionId: drafted.workflowVersionId,
      expectedVersion: 1,
    });

    const detail = await detailOf(harness, instanceId);

    // Nothing about the running approval moved: the version it follows, the people it asks and the
    // condition on its second branch are the ones it was started with.
    expect(detail.instance.workflowVersionId).toBe(process.workflowVersionId);
    expect(detail.steps.map((step) => step.approverMembershipId).sort()).toStrictEqual(
      [APPROVER, SECOND_APPROVER].sort(),
    );
    const gated = detail.steps.find((step) => step.approverMembershipId === SECOND_APPROVER);

    // The condition is on the step, copied at the start. Editing a definition cannot retroactively
    // re-route an approval half way through, which is AD-003 applied to routing rather than to steps.
    expect(gated?.condition).toStrictEqual([OVER_FIFTY]);

    await decideAs(harness, APPROVER, instanceId, 'approved');
    expect((await detailOf(harness, instanceId)).awaitingSteps).toHaveLength(1);
  });

  it('carries the branch rule and quorum onto every step of the branch', async () => {
    const process = await publishedBranches(
      harness,
      [APPROVER, SECOND_APPROVER, DEPUTY].map((approver) => ({
        ordinal: 1,
        approverMembershipId: approver,
        branchRule: 'majority' as const,
        quorum: 2,
      })),
      'snapshot-rule',
    );
    const instanceId = await startedOn(harness, process, 'requisition-rule');
    const detail = await detailOf(harness, instanceId);

    expect(detail.steps.every((step) => step.branchRule === 'majority')).toBe(true);
    expect(detail.steps.every((step) => step.quorum === 2)).toBe(true);
    expect(detail.tallies[0]).toMatchObject({ rule: 'majority', quorum: 2, threshold: 2 });
  });
});
