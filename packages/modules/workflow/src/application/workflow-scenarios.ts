import type { HandlerFailure, Result } from '@work/kernel';

import type { BranchCondition } from '../domain/condition.js';
import type { ApprovalDecisionKind, BranchRule } from '../domain/workflow-vocabulary.js';
import {
  APPROVER,
  REQUESTER,
  SECOND_APPROVER,
  SUBJECT_TYPE,
  attempt,
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

/** One step of a version, as a caller configures it. Whatever the case under test needs. */
export interface StepSpec {
  readonly ordinal: number;
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchCondition[];
}

/**
 * A published process whose steps are given one by one, branches and all.
 *
 * `publishedProcess` above builds the sequential chain 16A had — one approver per ordinal — and is
 * kept because most suites want exactly that. This one exists for the shapes only Phase 16B can
 * express: two approvers at one ordinal, a group, a majority rule, a condition.
 */
export const publishedBranches = async (
  harness: Harness,
  steps: readonly StepSpec[],
  code = 'branched-approval',
): Promise<PublishedProcess> => {
  const definition = await send<{ definitionId: string }>(harness, {
    commandName: 'workflow.create-definition',
    code,
    name: { en: 'Branched approval', ar: 'اعتماد متفرع' },
    subjectType: SUBJECT_TYPE,
  });
  const version = await send<{ workflowVersionId: string }>(harness, {
    commandName: 'workflow.draft-version',
    definitionId: definition.definitionId,
  });

  for (const [index, step] of steps.entries()) {
    await send(harness, {
      commandName: 'workflow.add-step',
      workflowVersionId: version.workflowVersionId,
      name: { en: `Step ${String(index + 1)}`, ar: `خطوة ${String(index + 1)}` },
      ...step,
    });
  }
  await send(harness, {
    commandName: 'workflow.publish-version',
    workflowVersionId: version.workflowVersionId,
    expectedVersion: 1,
  });
  return { definitionId: definition.definitionId, workflowVersionId: version.workflowVersionId };
};

/** An approval raised by `REQUESTER` against a published process, with whatever context it carries. */
export const startedOn = async (
  harness: Harness,
  process: PublishedProcess,
  subjectId: string,
  context?: Readonly<Record<string, unknown>>,
): Promise<string> => {
  const started = await harness.as(REQUESTER, () =>
    send<{ instanceId: string }>(harness, {
      commandName: 'workflow.start-instance',
      definitionId: process.definitionId,
      subjectType: SUBJECT_TYPE,
      subjectId,
      ...(context === undefined ? {} : { context }),
    }),
  );

  return started.instanceId;
};

/** A group with the memberships on it, created through the real commands. */
export const approvalGroup = async (
  harness: Harness,
  members: readonly string[],
  code = 'capital-approvers',
): Promise<string> => {
  const group = await send<{ approvalGroupId: string }>(harness, {
    commandName: 'workflow.create-approval-group',
    code,
    name: { en: 'Capital approvers', ar: 'معتمدو النفقات' },
  });

  for (const membershipId of members) {
    await send(harness, {
      commandName: 'workflow.add-group-member',
      approvalGroupId: group.approvalGroupId,
      membershipId,
    });
  }
  return group.approvalGroupId;
};

export interface DecisionOptions {
  readonly stepId?: string;
  readonly expectedVersion?: number;
  readonly comment?: string;
}

/** Answers the caller's own step of the open branch, naming one only where a branch asks twice. */
export const decideAs = (
  harness: Harness,
  membershipId: string,
  instanceId: string,
  decision: ApprovalDecisionKind,
  options: DecisionOptions = {},
): Promise<Result<unknown, HandlerFailure>> =>
  harness.as(membershipId, () =>
    attempt(harness, {
      commandName: 'workflow.decide-step',
      instanceId,
      decision,
      expectedVersion: options.expectedVersion ?? 1,
      ...(options.stepId === undefined ? {} : { stepId: options.stepId }),
      ...(options.comment === undefined ? {} : { comment: options.comment }),
    }),
  );

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
