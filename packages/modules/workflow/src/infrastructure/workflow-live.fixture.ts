import {
  Dispatcher,
  RecordingNotificationPort,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type Result,
} from '@work/kernel';

import { workflowModule } from '../application/workflow-module.js';
import {
  FakeBusinessDecisions,
  FakeDelegation,
  FakeMembershipStanding,
  FakeReminderRecipient,
  FakeReportingLine,
  FixedClock,
} from '../application/workflow-test-harness.js';
import type { WorkflowInstanceDetailView } from '../contracts/views.js';
import {
  APPROVER,
  REQUESTER,
  SUBJECT_TYPE,
  TENANT_A,
  type WorkflowFixture,
} from './workflow-database.fixture.js';
import { NOW, aCode } from './workflow-states.js';

/**
 * The Workflow module as production composes it, over a real PostgreSQL connection.
 *
 * The real commands, the real queries, the real domain, the real `PostgresUnitOfWork` and the
 * PostgreSQL repositories — with doubles for the only two things that are not this module: Identity's
 * delegation register, and the business module that asked for the approval.
 *
 * Split from the suites it serves at the file-size budget, along the seam a fixture always has. What
 * lives here is the *arrangement* — a list, a published process, a started approval — and what lives
 * in the suites is what is being asserted about it.
 */

export interface Live {
  readonly dispatcher: Dispatcher;
  readonly delegation: FakeDelegation;
  readonly membershipStanding: FakeMembershipStanding;
  readonly reminderRecipient: FakeReminderRecipient;
  readonly notifications: RecordingNotificationPort;
  /**
   * Employment and Identity, answering who somebody's manager is.
   *
   * A double for the same reason the delegation register is one: it is not this module. The adapter
   * that will answer it from a real Identity query is Checkpoint 7's, and nothing in the persistence
   * layer imports either module — asserted over the infrastructure source in the manager suite.
   */
  readonly reportingLine: FakeReportingLine;
  readonly business: FakeBusinessDecisions;
  as<TResult>(
    tenantId: string,
    membershipId: string,
    work: () => Promise<TResult>,
  ): Promise<TResult>;
}

/** Every step of a version, as a caller configures it. */
export interface StepSpec {
  readonly ordinal: number;
  readonly approverMembershipId?: string;
  readonly approverGroupId?: string;
  /** `manager`, for the one kind that names nobody. Absent means the kind is derived, as before. */
  readonly approverKind?: 'manager';
  readonly branchRule?: 'unanimous' | 'majority' | 'first-response';
  readonly quorum?: number;
  readonly condition?: readonly Record<string, unknown>[];
  readonly serviceLevel?: { readonly count: number; readonly unit: string };
}

export interface LiveWorkflow extends Live {
  send<TResult>(
    command: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ): Promise<TResult>;
  attempt(
    command: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ): Promise<Result<unknown, HandlerFailure>>;
  ask<TResult>(
    query: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ): Promise<TResult>;
  detailOf(instanceId: string): Promise<WorkflowInstanceDetailView>;
  aList(members: readonly string[], tenantId?: string): Promise<string>;
  aProcess(steps: readonly StepSpec[], tenantId?: string): Promise<string>;
  start(
    definitionId: string,
    subjectId: string,
    context?: Record<string, unknown>,
    tenantId?: string,
  ): Promise<string>;
  decide(
    instanceId: string,
    membershipId: string,
    decision: 'approved' | 'rejected',
  ): Promise<Result<unknown, HandlerFailure>>;
}

export const liveWorkflow = (fixture: WorkflowFixture): LiveWorkflow => {
  const live = liveModule(fixture);
  const dispatch = dispatching(live);

  return { ...live, ...dispatch, ...arranging(dispatch) };
};

/** Sending and asking, as a named membership in a named tenant. Refusals are returned, not thrown. */
interface Dispatching {
  readonly send: <TResult>(
    command: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ) => Promise<TResult>;
  readonly attempt: (
    command: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ) => Promise<Result<unknown, HandlerFailure>>;
  readonly ask: <TResult>(
    query: Record<string, unknown>,
    membershipId?: string,
    tenantId?: string,
  ) => Promise<TResult>;
  readonly detailOf: (instanceId: string) => Promise<WorkflowInstanceDetailView>;
}

const dispatching = (live: Live): Dispatching => {
  const send = async <TResult>(
    command: Record<string, unknown>,
    membershipId = APPROVER,
    tenantId = TENANT_A,
  ): Promise<TResult> => {
    const result = await live.as(tenantId, membershipId, () =>
      live.dispatcher.send<TResult>(command as never),
    );

    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  const attempt = (
    command: Record<string, unknown>,
    membershipId = APPROVER,
    tenantId = TENANT_A,
  ): Promise<Result<unknown, HandlerFailure>> =>
    live.as(tenantId, membershipId, () => live.dispatcher.send(command as never));

  const ask = async <TResult>(
    query: Record<string, unknown>,
    membershipId = APPROVER,
    tenantId = TENANT_A,
  ): Promise<TResult> => {
    const result = await live.as(tenantId, membershipId, () =>
      live.dispatcher.ask<TResult>(query as never),
    );

    if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  const detailOf = (instanceId: string): Promise<WorkflowInstanceDetailView> =>
    ask<WorkflowInstanceDetailView>({ queryName: 'workflow.read-instance', instanceId });

  return { send, attempt, ask, detailOf };
};

/**
 * The arrangements a scenario needs, built through the real commands rather than seeded.
 *
 * A list is created and filled the way an administrator fills one; a process goes through create →
 * draft → add-step → publish; an approval is raised by the requester. A fixture that inserted rows
 * directly could describe a state no command can produce, and a suite resting on one would be
 * asserting against a database the product cannot reach.
 */
const arranging = ({
  send,
  attempt,
}: Dispatching): Omit<LiveWorkflow, keyof Live | keyof Dispatching> => {
  const aProcess = (steps: readonly StepSpec[], tenantId = TENANT_A): Promise<string> =>
    publishedProcess(send, steps, tenantId);

  /** A list, filled through the real commands. */
  const aList = async (members: readonly string[], tenantId = TENANT_A): Promise<string> => {
    const group = await send<{ approvalGroupId: string }>(
      {
        commandName: 'workflow.create-approval-group',
        code: aCode('list'),
        name: { en: 'Capital approvers', ar: 'معتمدو النفقات' },
      },
      APPROVER,
      tenantId,
    );

    for (const membershipId of members) {
      await send(
        {
          commandName: 'workflow.add-group-member',
          approvalGroupId: group.approvalGroupId,
          membershipId,
        },
        APPROVER,
        tenantId,
      );
    }
    return group.approvalGroupId;
  };

  const start = async (
    definitionId: string,
    subjectId: string,
    context?: Record<string, unknown>,
    tenantId = TENANT_A,
  ): Promise<string> => {
    const started = await send<{ instanceId: string }>(
      {
        commandName: 'workflow.start-instance',
        definitionId,
        subjectType: SUBJECT_TYPE,
        subjectId,
        ...(context === undefined ? {} : { context }),
      },
      REQUESTER,
      tenantId,
    );

    return started.instanceId;
  };

  const decide = (
    instanceId: string,
    membershipId: string,
    decision: 'approved' | 'rejected',
  ): Promise<Result<unknown, HandlerFailure>> =>
    attempt(
      { commandName: 'workflow.decide-step', instanceId, decision, expectedVersion: 1 },
      membershipId,
    );

  return { aList, aProcess, start, decide };
};

/** The module, wired and registered. Nothing here is a double except the two ports named above. */
const liveModule = (fixture: WorkflowFixture): Live => {
  const permissions = { holds: (): Promise<boolean> => Promise.resolve(true) };
  const dispatcher = new Dispatcher(permissions);
  const delegation = new FakeDelegation();
  const reportingLine = new FakeReportingLine();
  const membershipStanding = new FakeMembershipStanding();
  const reminderRecipient = new FakeReminderRecipient();
  const notifications = new RecordingNotificationPort();
  const business = new FakeBusinessDecisions();
  const module = workflowModule({
    unitOfWork: fixture.unitOfWork,
    stores: fixture.stores,
    delegation,
    membershipStanding,
    reminderRecipient,
    notifications,
    reportingLine,
    businessDecision: business,
    permissions,
    clock: new FixedClock(NOW),
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    delegation,
    membershipStanding,
    reminderRecipient,
    notifications,
    reportingLine,
    business,
    as: (tenantId, membershipId, work) =>
      runInContext(
        { tenantId, correlationId: uuidV7(), actor: `user:${membershipId}`, membershipId },
        work,
      ),
  };
};

/**
 * A published process: create the definition, draft a version, add every step, publish.
 *
 * Its own function rather than a closure because it is the longest arrangement here and the only one
 * that issues four different commands — and because a version is what every scenario in these suites
 * starts from, whatever it goes on to assert.
 */
const publishedProcess = async (
  send: Dispatching['send'],
  steps: readonly StepSpec[],
  tenantId: string,
): Promise<string> => {
  const definition = await send<{ definitionId: string }>(
    {
      commandName: 'workflow.create-definition',
      code: aCode('process'),
      name: { en: 'Requisition approval', ar: 'اعتماد طلب' },
      subjectType: SUBJECT_TYPE,
    },
    APPROVER,
    tenantId,
  );
  const version = await send<{ workflowVersionId: string }>(
    { commandName: 'workflow.draft-version', definitionId: definition.definitionId },
    APPROVER,
    tenantId,
  );

  for (const [index, step] of steps.entries()) {
    await send(
      {
        commandName: 'workflow.add-step',
        workflowVersionId: version.workflowVersionId,
        name: { en: `Step ${String(index + 1)}`, ar: `خطوة ${String(index + 1)}` },
        ...step,
      },
      APPROVER,
      tenantId,
    );
  }
  await send(
    {
      commandName: 'workflow.publish-version',
      workflowVersionId: version.workflowVersionId,
      expectedVersion: 1,
    },
    APPROVER,
    tenantId,
  );
  return definition.definitionId;
};
