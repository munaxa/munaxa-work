import { success, type Query, type QueryHandler } from '@work/kernel';

import { approvalStateOf } from '../domain/decision.js';
import type {
  ApprovalStatusView,
  PendingApprovalView,
  WorkflowDecisionView,
  WorkflowHistoryView,
} from '../contracts/execution-views.js';
import { currentMembership, notFound } from './workflow-context.js';
import { emptyPage, pageOf } from './workflow-paging.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import { asDecisionView, asHistoryView, asPendingView } from './workflow-views.js';
import type { Page } from './workflow-ports.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * The caller's own queue, what they decided, and the timeline of one approval.
 *
 * **This is the first `read-own` in this repository that is routed and enforced.** Career, Learning,
 * Performance, Leave, Payroll, Attendance, Compensation and Documents each declare one and route it
 * nowhere: a career plan or a payslip is about an *employment*, and no principal in this repository
 * resolves to one (ADR-0032). An approval is addressed to a **membership** — the person a tenant
 * admitted, in that tenant — and a membership is exactly what the request resolved before any
 * handler ran. So "the approvals waiting for me" is answerable here without accepting one identifier
 * from the caller.
 *
 * **There is no parameter for whose queue to read, and its absence is the control.** Not a filter
 * that defaults to the caller — no field at all. A `?membershipId=` would be an IDOR wearing a
 * permission's name, and this module's queue is a list of what named directors are being asked to
 * decide this week.
 *
 * **A caller with no membership gets an empty page, not everybody's.** A reconciliation command, a
 * migration and a test fixture all run in contexts that name no membership. "We do not know which
 * member you are" has exactly one safe answer, and it is nothing.
 *
 * There is no `read-team` here and no manager query. Resolving "my team" needs the caller's
 * *employment*, and a caller-supplied manager identifier is a filter and never a credential (D-14).
 */

export interface PendingApprovals extends Query {
  readonly queryName: 'workflow.pending-approvals';
  readonly page?: number;
  readonly size?: number;
}

export const pendingApprovalsHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<PendingApprovals, Page<PendingApprovalView>> => ({
  queryName: 'workflow.pending-approvals',
  permission: WorkflowPermissions.approvalReadOwn,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const caller = currentMembership();

      if (caller === undefined) return success(emptyPage<PendingApprovalView>());

      const found = await dependencies.stores.steps.awaitingFor(transaction, caller, pageOf(query));
      // One reading instant for the whole page, so two rows read in the same request are compared
      // against the same moment rather than against whenever each of them happened to be mapped.
      const asAt = dependencies.clock.now();
      const rows: PendingApprovalView[] = [];

      for (const step of found.items) {
        const instance = await dependencies.stores.instances.byId(transaction, step.instanceId);

        if (instance === undefined) continue;

        const definition = await dependencies.stores.definitions.byId(
          transaction,
          instance.definitionId,
        );

        rows.push(asPendingView(step, instance, definition?.code ?? '', asAt));
      }
      // The total is the store's count over the same predicate, not this page's length: a queue
      // that reported `items.length` would tell somebody with three hundred approvals they have
      // fifty.
      return success({ items: rows, total: found.total });
    }),
});

export interface DecidedApprovals extends Query {
  readonly queryName: 'workflow.decided-approvals';
  readonly page?: number;
  readonly size?: number;
}

/**
 * What this caller decided — the other half of a queue, on the same identity rule.
 *
 * A **delegated** decision appears here for the delegate, because they are the one who decided it.
 * It does not appear for the delegator, whose authority was used but who did not act. That is the
 * same distinction the two columns keep, read back out.
 */
export const decidedApprovalsHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<DecidedApprovals, Page<WorkflowDecisionView>> => ({
  queryName: 'workflow.decided-approvals',
  permission: WorkflowPermissions.approvalReadOwn,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const caller = currentMembership();

      if (caller === undefined) return success(emptyPage<WorkflowDecisionView>());

      const found = await dependencies.stores.decisions.decidedBy(
        transaction,
        caller,
        pageOf(query),
      );

      return success({ items: found.items.map(asDecisionView), total: found.total });
    }),
});

export interface ReadHistory extends Query {
  readonly queryName: 'workflow.read-history';
  readonly instanceId: string;
  readonly page?: number;
  readonly size?: number;
}

/**
 * One approval's timeline, oldest first.
 *
 * Paged because it grows with the length of the process and the number of times it was reassigned,
 * and a timeline is exactly the read somebody would otherwise ask for unbounded.
 */
export const readHistoryHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<ReadHistory, Page<WorkflowHistoryView>> => ({
  queryName: 'workflow.read-history',
  permission: WorkflowPermissions.instanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const instance = await dependencies.stores.instances.byId(transaction, query.instanceId);

      if (instance === undefined) return notFound('workflow-instance');

      const found = await dependencies.stores.history.forInstance(
        transaction,
        query.instanceId,
        pageOf(query),
      );

      return success({ items: found.items.map(asHistoryView), total: found.total });
    }),
});

export interface ReadApprovalStatus extends Query {
  readonly queryName: 'workflow.read-approval-status';
  readonly approvalId: string;
}

/**
 * An approval in `ApprovalPort`'s own vocabulary — the read the seam will make.
 *
 * Published in the port's shape so that when Checkpoint 7 wires an adopting module, what changes is
 * where a decision comes from and not what it looks like. Five modules already publish a chain "in
 * `ApprovalPort`'s shape" from their own tables for the same reason.
 *
 * **Nothing here is wired to Recruitment.** This is a query anybody holding `instance.read` may make
 * about an approval identifier they already hold; the adapter that turns it into a port call, and
 * the module that consumes it, are Checkpoint 7's.
 *
 * `expired` is one of the port's five states and this can never return it: nothing in Phase 16A
 * expires anything, because SLA is 16B and `JobPort` has no adapter.
 */
export const readApprovalStatusHandler = (
  dependencies: WorkflowDependencies,
): QueryHandler<ReadApprovalStatus, ApprovalStatusView> => ({
  queryName: 'workflow.read-approval-status',
  permission: WorkflowPermissions.instanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const instance = await dependencies.stores.instances.byId(transaction, query.approvalId);

      if (instance === undefined) return notFound('workflow-instance');

      const steps = await dependencies.stores.steps.forInstance(transaction, query.approvalId);
      const decisions = await dependencies.stores.decisions.forInstance(
        transaction,
        query.approvalId,
      );
      const decisionOf = new Map(decisions.map((decision) => [decision.stepId, decision]));

      return success({
        approvalId: instance.instanceId,
        state: approvalStateOf(instance.status),
        // The chain as the requester sees it: who, in order, with their answer. The approver named
        // is the membership the step was assigned to — a delegate's identity belongs to the
        // decision record, not to a chain the requesting module renders.
        steps: [...steps]
          .sort((left, right) => left.ordinal - right.ordinal)
          .map((step) => {
            const made = decisionOf.get(step.stepId);

            return {
              approver: step.approverMembershipId,
              ...(made === undefined
                ? {}
                : { decision: made.decision, decidedOn: made.decidedAt.toISOString() }),
            };
          }),
        ...(instance.completedAt === undefined
          ? {}
          : { completedOn: instance.completedAt.toISOString() }),
      });
    }),
});
