import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowInstanceDetailView } from '../contracts/views.js';
import { approveAs, publishedProcess, runningApproval } from './workflow-scenarios.js';
import {
  APPROVER,
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

/**
 * Configuration, and an approval walking its steps in order.
 *
 * The suite dispatches real commands through the real dispatcher, so every domain rule and every
 * in-memory index stands between a test and its assertion. What it adds beyond the domain suites is
 * the part only the application has: the *set* facts a single aggregate cannot see, the write order
 * the indexes require, and the identity that comes from the request rather than from a field.
 */

const detailOf = (harness: Harness, instanceId: string): Promise<WorkflowInstanceDetailView> =>
  ask<WorkflowInstanceDetailView>(harness, { queryName: 'workflow.read-instance', instanceId });

describe('a workflow definition and its versions', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('refuses a second definition with the same code', async () => {
    await publishedProcess(harness, [APPROVER], 'shared-code');

    const again = await attempt(harness, {
      commandName: 'workflow.create-definition',
      code: 'shared-code',
      name: { en: 'Another', ar: 'آخر' },
      subjectType: SUBJECT_TYPE,
    });

    expect(failureOf(again)).toBe('workflow_definition_code_taken');
  });

  it('numbers versions itself rather than taking a number from the caller', async () => {
    const process = await publishedProcess(harness);
    const second = await send<{ versionNumber: number }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });

    // Deliberately not a command field: two administrators picking the same number would collide on
    // an index over a value neither of them chose.
    expect(second.versionNumber).toBe(2);
  });

  /**
   * **The second half of this test was inverted in Phase 16B rather than removed.**
   *
   * 16A refused a second step at one ordinal, and that was right while an ordinal was a position. An
   * ordinal is now a *branch* — the set of approvers asked at the same moment — so a second step
   * there is how parallel approval is configured, and the refusal would have refused the feature.
   * What is still refused is editing a version that has been published, which is AD-003 and did not
   * move.
   */
  it('refuses a step on a published version, and takes a second step at one ordinal on a draft', async () => {
    const process = await publishedProcess(harness);
    const late = await attempt(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: process.workflowVersionId,
      ordinal: 2,
      name: { en: 'Late', ar: 'متأخر' },
      approverMembershipId: SECOND_APPROVER,
    });

    expect(failureOf(late)).toBe('workflow.rejection.version-not-editable');

    const draft = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });
    const step = {
      commandName: 'workflow.add-step',
      workflowVersionId: draft.workflowVersionId,
      ordinal: 1,
      name: { en: 'One', ar: 'واحد' },
      approverMembershipId: APPROVER,
    };

    await send(harness, step);
    // A second approver at ordinal 1: two people asked at once, which is a branch.
    expect(
      failureOf(await attempt(harness, { ...step, approverMembershipId: SECOND_APPROVER })),
    ).toBe(undefined);
  });

  it('refuses to publish an empty version or a gapped order', async () => {
    const process = await publishedProcess(harness);
    const draft = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });
    const publish = {
      commandName: 'workflow.publish-version',
      workflowVersionId: draft.workflowVersionId,
      expectedVersion: 1,
    };

    expect(failureOf(await attempt(harness, publish))).toBe(
      'workflow.rejection.version-has-no-steps',
    );

    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: draft.workflowVersionId,
      ordinal: 2,
      name: { en: 'Two', ar: 'اثنان' },
      approverMembershipId: APPROVER,
    });
    expect(failureOf(await attempt(harness, publish))).toBe(
      'workflow.rejection.version-step-order-broken',
    );
  });

  it('starts an approval from the newest published version, not the newest draft', async () => {
    const process = await publishedProcess(harness, [APPROVER]);
    const draft = await send<{ workflowVersionId: string }>(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });
    const started = await harness.as(REQUESTER, () =>
      send<{ instanceId: string }>(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-draft',
      }),
    );
    const detail = await detailOf(harness, started.instanceId);

    expect(detail.instance.workflowVersionId).toBe(process.workflowVersionId);
    expect(detail.instance.workflowVersionId).not.toBe(draft.workflowVersionId);
  });

  it('refuses to start from a definition with nothing published', async () => {
    const definition = await send<{ definitionId: string }>(harness, {
      commandName: 'workflow.create-definition',
      code: 'unpublished',
      name: { en: 'Unpublished', ar: 'غير منشور' },
      subjectType: SUBJECT_TYPE,
    });
    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: definition.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-none',
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.definition-has-no-published-version');
  });

  it('refuses to start an approval about a subject the definition does not decide', async () => {
    const process = await publishedProcess(harness);
    const refused = await harness.as(REQUESTER, () =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: 'leave.request',
        subjectId: 'leave-1',
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.subject-type-not-this-definition');
  });

  it('retires a definition and refuses a new version against it', async () => {
    const process = await publishedProcess(harness);

    await send(harness, {
      commandName: 'workflow.retire-definition',
      definitionId: process.definitionId,
      expectedVersion: 1,
    });

    const refused = await attempt(harness, {
      commandName: 'workflow.draft-version',
      definitionId: process.definitionId,
    });

    expect(failureOf(refused)).toBe('workflow.rejection.definition-retired');
  });
});

describe('starting an approval', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('records the caller’s membership as the requester, from context and not from a field', async () => {
    const running = await runningApproval(harness);
    const detail = await detailOf(harness, running.instanceId);

    expect(detail.instance.requestedByMembershipId).toBe(REQUESTER);
    expect(detail.instance.subjectType).toBe(SUBJECT_TYPE);
  });

  it('leaves exactly one step awaiting, and it is the first', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);
    const detail = await detailOf(harness, running.instanceId);

    expect(detail.steps.filter((step) => step.status === 'awaiting')).toHaveLength(1);
    expect(detail.awaiting?.ordinal).toBe(1);
    expect(detail.awaiting?.approverMembershipId).toBe(APPROVER);
  });

  it('converges rather than erroring when the same subject is submitted twice', async () => {
    const running = await runningApproval(harness, [APPROVER], 'requisition-twice');
    const again = await harness.as(REQUESTER, () =>
      send<{ instanceId: string; created: boolean }>(harness, {
        commandName: 'workflow.start-instance',
        definitionId: running.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-twice',
      }),
    );

    // The same approval, and it says so. A conflict here would make a lost response
    // indistinguishable from a duplicate act.
    expect(again).toStrictEqual({ instanceId: running.instanceId, created: false });
  });

  it('refuses a caller whose membership did not resolve', async () => {
    const process = await publishedProcess(harness);
    const refused = await harness.withoutMembership(() =>
      attempt(harness, {
        commandName: 'workflow.start-instance',
        definitionId: process.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-anonymous',
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.membership-unresolved');
  });
});

describe('walking the steps in order', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('advances to the second approver and completes on the last', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);

    const midway = await detailOf(harness, running.instanceId);

    expect(midway.instance.status).toBe('running');
    expect(midway.awaiting?.approverMembershipId).toBe(SECOND_APPROVER);

    await approveAs(harness, SECOND_APPROVER, running.instanceId);

    const finished = await detailOf(harness, running.instanceId);

    expect(finished.instance.status).toBe('completed');
    expect(finished.awaiting).toBeUndefined();
    expect(finished.instance.completedOn).toBeDefined();
  });

  it('ends the approval on a rejection and skips the steps after it', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await harness.as(APPROVER, () =>
      send(harness, {
        commandName: 'workflow.decide-step',
        instanceId: running.instanceId,
        decision: 'rejected',
        comment: 'Not this quarter.',
        expectedVersion: 1,
      }),
    );

    const detail = await detailOf(harness, running.instanceId);

    expect(detail.instance.status).toBe('rejected');
    expect(detail.steps.map((step) => step.status)).toStrictEqual(['rejected', 'skipped']);
    // No tally ran: the second approver was never asked and never will be.
    expect(detail.decisions).toHaveLength(1);
  });

  it('refuses a second decision once the approval has ended', async () => {
    const running = await runningApproval(harness, [APPROVER]);

    await approveAs(harness, APPROVER, running.instanceId);

    const refused = await harness.as(APPROVER, () =>
      attempt(harness, {
        commandName: 'workflow.decide-step',
        instanceId: running.instanceId,
        decision: 'approved',
        expectedVersion: 2,
      }),
    );

    expect(failureOf(refused)).toBe('workflow.rejection.instance-has-no-awaiting-step');
  });

  it('cancels, skipping every open step, and is not a rejection', async () => {
    const running = await runningApproval(harness, [APPROVER, SECOND_APPROVER]);

    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'The vacancy was withdrawn.',
      expectedVersion: 1,
    });

    const detail = await detailOf(harness, running.instanceId);

    expect(detail.instance.status).toBe('cancelled');
    expect(detail.instance.status).not.toBe('rejected');
    expect(detail.steps.every((step) => step.status === 'skipped')).toBe(true);
    expect(detail.decisions).toStrictEqual([]);
  });

  it('refuses a cancellation with no reason', async () => {
    const running = await runningApproval(harness, [APPROVER]);
    const refused = await attempt(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: '   ',
      expectedVersion: 1,
    });

    expect(failureOf(refused)).toBe('workflow.rejection.cancellation-reason-required');
  });

  it('permits a fresh approval for the same subject once the first has ended', async () => {
    const running = await runningApproval(harness, [APPROVER], 'requisition-again');

    await send(harness, {
      commandName: 'workflow.cancel-instance',
      instanceId: running.instanceId,
      reason: 'Withdrawn.',
      expectedVersion: 1,
    });

    const second = await harness.as(REQUESTER, () =>
      send<{ instanceId: string; created: boolean }>(harness, {
        commandName: 'workflow.start-instance',
        definitionId: running.definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId: 'requisition-again',
      }),
    );

    // The index is partial on `running`, so asking again after an ending is an ordinary act — and it
    // is the only correction mechanism, because a decision is never rewritten.
    expect(second.created).toBe(true);
    expect(second.instanceId).not.toBe(running.instanceId);
  });
});
