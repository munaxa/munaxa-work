import {
  APPROVER,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  send,
  type Harness,
} from './workflow-test-harness.js';

/**
 * The arrangements the application suites keep building: a published process, and an approval
 * running against it.
 *
 * Built by **dispatching the real commands**, never by writing into the stores. A scenario that
 * seeded state directly would happily produce a published version with gapped ordinals or an
 * instance with two awaiting steps — the exact shapes the domain and the indexes exist to refuse —
 * and every assertion resting on it would be about a state the product cannot reach. Going through
 * the dispatcher also makes each fixture, incidentally, a test that the path used to build it works.
 */

export interface PublishedProcess {
  readonly definitionId: string;
  readonly workflowVersionId: string;
}

/** A definition with a published version whose steps are assigned to `approvers`, in order. */
export const publishedProcess = async (
  harness: Harness,
  approvers: readonly string[] = [APPROVER],
  code = 'requisition-approval',
): Promise<PublishedProcess> => {
  const definition = await send<{ definitionId: string }>(harness, {
    commandName: 'workflow.create-definition',
    code,
    name: { en: 'Requisition approval', ar: 'اعتماد طلب التوظيف' },
    subjectType: SUBJECT_TYPE,
  });
  const version = await send<{ workflowVersionId: string }>(harness, {
    commandName: 'workflow.draft-version',
    definitionId: definition.definitionId,
  });

  for (const [index, approver] of approvers.entries()) {
    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version.workflowVersionId,
      ordinal: index + 1,
      name: { en: `Step ${String(index + 1)}`, ar: `خطوة ${String(index + 1)}` },
      approverMembershipId: approver,
    });
  }
  await send(harness, {
    commandName: 'workflow.publish-version',
    workflowVersionId: version.workflowVersionId,
    expectedVersion: 1,
  });
  return { definitionId: definition.definitionId, workflowVersionId: version.workflowVersionId };
};

export interface RunningApproval extends PublishedProcess {
  readonly instanceId: string;
}

/** A published process and one approval running against it, raised by `REQUESTER`. */
export const runningApproval = async (
  harness: Harness,
  approvers: readonly string[] = [APPROVER, SECOND_APPROVER],
  subjectId = 'requisition-1',
): Promise<RunningApproval> => {
  const process = await publishedProcess(harness, approvers, `approval-${subjectId}`);
  const started = await harness.as(REQUESTER, () =>
    send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: process.definitionId,
      subjectType: SUBJECT_TYPE,
      subjectId,
    }),
  );

  return { ...process, instanceId: started.instanceId };
};

/** Approves whichever step is currently awaiting, as the membership assigned to it. */
export const approveAs = (
  harness: Harness,
  membershipId: string,
  instanceId: string,
  expectedVersion = 1,
): Promise<unknown> =>
  harness.as(membershipId, () =>
    send(harness, {
      commandName: 'workflow.decide-step',
      instanceId,
      decision: 'approved',
      expectedVersion,
    }),
  );
