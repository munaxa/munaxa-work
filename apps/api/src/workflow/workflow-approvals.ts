import type {
  ApprovalPort,
  ApprovalRequest,
  ApprovalStatus,
  ApprovalStep,
  Command,
  HandlerFailure,
  PagedResult,
  Query,
} from '@work/kernel';
import type { ApprovalStatusView, WorkflowDefinitionView } from '@work/workflow';

import type { Sending } from './sending.js';

/**
 * Workflow answering the kernel's `ApprovalPort` — the **inbound** half of the seam.
 *
 * A business module asks for a decision to be routed and later asks what became of it. That port has
 * existed since Phase 2 (ADR-0024) precisely so that the five domains needing approvals before
 * Workflow existed would not have to change when it arrived, and its only implementation until now
 * was `AutoApprovingPort`, which approves everything as `system:auto-approval` and says so in its own
 * comment. This is the first implementation that routes a decision to a person.
 *
 * **The kernel interface is unchanged and this file adds nothing to it** (D-8). `request`, `status`
 * and `cancel`, with the signatures and the `Date`s the port declares — the conversion from
 * Workflow's ISO strings happens here, at the boundary, which is the one place it can happen without
 * a `Date` leaking into a module that publishes strings.
 *
 * **This is not the return path.** How a *decided* approval reaches the module that asked for it is
 * `BusinessDecisionPort`, a separate seam in Workflow's own application layer, because this interface
 * has no method for it: the kernel's own answer is an event, and D-9 refused event-carried
 * correctness on delivery that is in-process and at-most-once with no outbox. The two seams point in
 * opposite directions and neither substitutes for the other.
 *
 * **Nothing here is wired to a consumer yet.** Recruitment does not request routing — M-1 authorizes
 * writing the reserved column and accepting the decide command, and nothing more — so this is the
 * capability sitting ready rather than a path in use. Said plainly because an implementation nobody
 * calls is easy to mistake for one that is load-bearing.
 */

/** The one definition a subject type routes through, resolved by Workflow's own published read. */
interface SearchDefinitionsQuery extends Query {
  readonly queryName: 'workflow.search-definitions';
  readonly subjectType: string;
  readonly status: string;
  readonly page: number;
  readonly size: number;
}

interface StartInstanceCommand extends Command {
  readonly commandName: 'workflow.start-instance';
  readonly definitionId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly context: Readonly<Record<string, unknown>>;
}

interface ReadApprovalStatusQuery extends Query {
  readonly queryName: 'workflow.read-approval-status';
  readonly approvalId: string;
}

interface ReadInstanceQuery extends Query {
  readonly queryName: 'workflow.read-instance';
  readonly instanceId: string;
}

interface CancelInstanceCommand extends Command {
  readonly commandName: 'workflow.cancel-instance';
  readonly instanceId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

const instantOf = (iso: string | undefined): Date | undefined =>
  iso === undefined ? undefined : new Date(iso);

/**
 * Workflow's view in the port's own vocabulary.
 *
 * The two shapes already agree on everything but the temporal type, because the query was written in
 * `ApprovalPort`'s shape for exactly this moment. `expired` is one of the port's five states and can
 * never appear: nothing in Phase 16A expires anything.
 */
const statusOf = (view: ApprovalStatusView): ApprovalStatus => ({
  approvalId: view.approvalId,
  state: view.state,
  steps: view.steps.map((step): ApprovalStep => ({
    approver: step.approver,
    ...(step.decision === undefined ? {} : { decision: step.decision }),
    ...(instantOf(step.decidedOn) === undefined ? {} : { decidedAt: instantOf(step.decidedOn) }),
  })),
  ...(instantOf(view.completedOn) === undefined
    ? {}
    : { completedAt: instantOf(view.completedOn) }),
});

const failed = (what: string, failure: HandlerFailure): Error =>
  new Error(`${what} (${failure.kind})`);

export class WorkflowApprovals implements ApprovalPort {
  public constructor(private readonly dispatcher: Sending) {}

  /**
   * Routes a decision about a subject, and hands back the approval it created.
   *
   * The definition is resolved from the **subject type**, which is the only thing the port carries
   * that could name one: a requesting module knows what it is asking about and has no business
   * knowing which workflow a tenant configured for it. An active definition with no published
   * version, or no definition at all, is a refusal rather than an auto-approval — the whole point of
   * replacing `AutoApprovingPort` is that nothing here approves on the product's behalf.
   *
   * `requestedBy` and `correlationId` on the request are **not** forwarded. Both are taken from the
   * ambient execution context by the handler, which is the seam Checkpoint 4 established: the
   * requester is the membership the request resolved, never a field a caller filled in.
   */
  public async request(request: ApprovalRequest): Promise<ApprovalStatus> {
    const search: SearchDefinitionsQuery = {
      queryName: 'workflow.search-definitions',
      subjectType: request.subjectType,
      status: 'active',
      page: 1,
      size: 1,
    };
    const definitions = await this.dispatcher.ask<PagedResult<WorkflowDefinitionView>>(search);

    if (!definitions.ok) throw failed('No workflow could be resolved', definitions.error);

    const [definition] = definitions.value.items;

    if (definition === undefined) {
      throw new Error(`No active workflow is configured for ${request.subjectType}.`);
    }

    const start: StartInstanceCommand = {
      commandName: 'workflow.start-instance',
      definitionId: definition.definitionId,
      subjectType: request.subjectType,
      subjectId: request.subjectId,
      context: request.context,
    };
    const started = await this.dispatcher.send<{ readonly instanceId: string }>(start);

    if (!started.ok) throw failed('The approval could not be started', started.error);

    return this.status(started.value.instanceId);
  }

  public async status(approvalId: string): Promise<ApprovalStatus> {
    const query: ReadApprovalStatusQuery = {
      queryName: 'workflow.read-approval-status',
      approvalId,
    };
    const found = await this.dispatcher.ask<ApprovalStatusView>(query);

    if (!found.ok) throw failed(`Unknown approval ${approvalId}`, found.error);
    return statusOf(found.value);
  }

  /**
   * Stops an approval nobody decided.
   *
   * The version comes from a read a moment earlier because `cancel-instance` is optimistic, and the
   * port's signature has nowhere to carry one. Two callers cancelling at once therefore meet
   * Workflow's own concurrency refusal rather than each other.
   */
  public async cancel(approvalId: string, reason: string): Promise<void> {
    const query: ReadInstanceQuery = {
      queryName: 'workflow.read-instance',
      instanceId: approvalId,
    };
    const instance = await this.dispatcher.ask<{ readonly instance: { readonly version: number } }>(
      query,
    );

    if (!instance.ok) throw failed(`Unknown approval ${approvalId}`, instance.error);

    const command: CancelInstanceCommand = {
      commandName: 'workflow.cancel-instance',
      instanceId: approvalId,
      reason,
      expectedVersion: instance.value.instance.version,
    };
    const cancelled = await this.dispatcher.send<unknown>(command);

    if (!cancelled.ok) throw failed('The approval could not be cancelled', cancelled.error);
  }
}
