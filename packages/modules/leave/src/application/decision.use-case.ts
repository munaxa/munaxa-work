import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { LeaveRequest } from '../domain/leave-request.js';
import { isoOf } from '../domain/leave-year.js';
import { accept, refuse, type LeaveResult } from '../domain/leave-rejection.js';
import { supersedeOriginal } from './amendment.use-case.js';
import { consumeFor } from './consumption.js';
import {
  currentActor,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import { planRequest } from './request-planning.js';
import { recordRequestEvent } from './request-history.js';
import type { Decision } from '../domain/leave-vocabulary.js';
import type { LeaveRequestState } from '../domain/leave-request-state.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Deciding a leave request: the act this whole module's separation of duties exists to protect.
 *
 * **`decidedBy` comes from the authenticated context and never from the command.** A caller who
 * could name their own approver could approve their own paid absence under somebody else's name,
 * and an approval somebody can forge is not evidence of anything.
 *
 * **Self-approval is refused three times over**, and the redundancy is the point: by the domain
 * (`self_approval_not_permitted`), by the permission separation (`leave.approve` is not
 * `leave.request`), and by a check constraint in the database — which is enforceable only because
 * the decision row carries a copy of `requestedBy` (§12.2). A control that lives in one layer is a
 * control that any future path around that layer silently removes.
 *
 * **The policy checks are re-run at the decision.** The world moved between submission and now: the
 * balance may have gone elsewhere, an assignment may have ended, a blackout may have been declared.
 * A request approved into a deficit the policy prohibits is the failure this re-run prevents (§9).
 *
 * **Multi-level approval is a sequence, not a routing engine.** The request stays
 * `pending_approval` until the policy's count of *distinct* approvers has decided. There is no
 * escalation, no timeout, no delegation resolution and no conditional path — those are Workflow's
 * (Phase 16), and building them here would be the second workflow engine the instruction forbids.
 */

export interface DecideLeaveRequestCommand extends Command {
  readonly commandName: 'leave.decide-request';
  readonly leaveRequestId: string;
  readonly decision: Decision;
  readonly comment?: string;
  readonly expectedVersion: number;
}

export interface LeaveRequestDecided {
  readonly leaveRequestId: string;
  readonly state: string;
  readonly decisionsRecorded: number;
}

export const decideLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<DecideLeaveRequestCommand, LeaveRequestDecided> => ({
  commandName: 'leave.decide-request',
  permission: LeavePermissions.approve,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, command.leaveRequestId);

      if (found === undefined) return notFound<LeaveRequestDecided>('leave request');

      const decider = currentActor();
      const existing = await dependencies.stores.decisions.forRequest(transaction, found.id);
      const allowed = await permitted(transaction, dependencies, {
        request: found,
        decider,
        existing: existing.map((one) => one.decidedBy),
        decision: command.decision,
      });

      if (!allowed.ok) return refusedBy<LeaveRequestDecided>(allowed.error);

      return applyDecision(transaction, dependencies, {
        request: found,
        decider,
        sequence: existing.length + 1,
        command,
      });
    }),
});

interface PermissionCheck {
  readonly request: LeaveRequestState;
  readonly decider: string;
  readonly existing: readonly string[];
  readonly decision: Decision;
}

/**
 * Who may decide this, and whether the policy still permits the leave.
 *
 * The self-approval check reads the policy's `selfApprovalPermitted`, which defaults to false. Even
 * where a tenant has enabled it, the database's check constraint still refuses a decision row whose
 * `decided_by` equals its `requested_by` — so enabling it does not silently create a path to
 * approving one's own leave. That is a deliberate tension: the flag exists because the
 * specification names it, and the constraint exists because the control matters more.
 */
const permitted = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  check: PermissionCheck,
): Promise<LeaveResult<true>> => {
  if (check.decider === check.request.requestedBy) return refuse('self_approval_not_permitted');
  if (check.existing.includes(check.decider)) return refuse('already_decided_by_this_approver');
  if (check.decision === 'rejected') return accept(true);

  // Re-run the whole policy check. A rejection needs no eligibility — refusing leave somebody is
  // not eligible for is still a refusal — but an approval must satisfy the rules as they stand now.
  const plan = await planRequest(transaction, dependencies, {
    employmentId: check.request.employmentId,
    leaveTypeId: check.request.leaveTypeId,
    fromDate: check.request.fromDate,
    toDate: check.request.toDate,
    portions: [],
    hasAttachment: check.request.attachmentReference !== undefined,
    today: isoOf(dependencies.clock.now()),
  });

  return plan.ok ? accept(true) : plan;
};

interface DecisionContext {
  readonly request: LeaveRequestState;
  readonly decider: string;
  readonly sequence: number;
  readonly command: DecideLeaveRequestCommand;
}

const applyDecision = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: DecisionContext,
): ReturnType<CommandHandler<DecideLeaveRequestCommand, LeaveRequestDecided>['handle']> => {
  const now = dependencies.clock.now();

  await dependencies.stores.decisions.insert(transaction, {
    id: uuidV7(now.getTime()),
    tenantId: currentTenant(),
    leaveRequestId: context.request.id,
    sequence: context.sequence,
    decision: context.command.decision,
    decidedBy: context.decider,
    decidedAt: now,
    // Copied from the request at insert, never supplied — this is what makes the database's
    // self-approval constraint enforceable at all.
    requestedBy: context.request.requestedBy,
    ...(context.command.comment === undefined ? {} : { comment: context.command.comment }),
    version: 0,
  });

  const request = LeaveRequest.rehydrate(context.request);
  const decided = request.decide(
    { decision: context.command.decision, decisionsSoFar: context.sequence },
    originOfCurrentRequest(),
    now,
  );

  if (!decided.ok) return refusedBy<LeaveRequestDecided>(decided.error);

  await dependencies.stores.requests.update(
    transaction,
    decided.value,
    context.command.expectedVersion,
  );
  transaction.collect(request.pullEvents());
  await recordRequestEvent(transaction, dependencies, {
    requestId: context.request.id,
    kind: 'decided',
    fromState: context.request.state,
    toState: decided.value.state,
    detail: context.command.decision,
  });

  if (decided.value.state === 'approved') {
    const consumed = await consumeFor(transaction, dependencies, decided.value);

    if (!consumed.ok) return refusedBy<LeaveRequestDecided>(consumed.error);

    // An approved amendment replaces its original in the same transaction: the original's
    // consumption is reversed and it is cancelled. Both movements commit together or neither does,
    // so there is no instant at which the same leave is consumed twice or not at all.
    const superseded = await supersedeOriginal(transaction, dependencies, decided.value);

    if (!superseded.ok) return refusedBy<LeaveRequestDecided>(superseded.error);
  }

  return success({
    leaveRequestId: context.request.id,
    state: decided.value.state,
    decisionsRecorded: context.sequence,
  });
};
