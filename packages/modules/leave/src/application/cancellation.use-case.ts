import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { LeaveRequest } from '../domain/leave-request.js';
import { reverseConsumptionFor } from './consumption.js';
import { currentActor, notFound, originOfCurrentRequest, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import { recordRequestEvent } from './request-history.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Unmaking a request: withdrawal before a decision, cancellation after one.
 *
 * Two commands rather than one because they are different events with different consequences, and
 * a single "cancel" that behaved differently depending on state would hide the difference from
 * whoever reads the audit trail.
 *
 * - **Withdrawal** is the requester taking back their own undecided request. No ledger effect,
 *   because nothing was consumed. Refused once any decision exists.
 * - **Cancellation** unmakes an *approved* request. It writes a **reversal** against the original
 *   consumption — never a deletion — and records who cancelled it and why.
 *
 * Neither touches an attendance record. **Leave never writes Attendance**: Attendance discovers a
 * leave change on its own reconciliation run by asking `leave.approved-leave-affecting`, which is
 * the approved direction (decision D-2 as decided — Attendance pulls, Leave does not push). A
 * Leave-to-Attendance write would be a circular module dependency, since Attendance already depends
 * on Leave.
 */

export interface WithdrawLeaveRequestCommand extends Command {
  readonly commandName: 'leave.withdraw-request';
  readonly leaveRequestId: string;
  readonly expectedVersion: number;
}

export interface LeaveRequestWithdrawn {
  readonly leaveRequestId: string;
  readonly state: string;
}

/**
 * Withdrawal: the requester taking back their own undecided request.
 *
 * No ledger effect, because nothing was consumed. The day rows are removed so the dates stop
 * blocking anybody — including the requester, who may want to ask for them differently.
 */
export const withdrawLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<WithdrawLeaveRequestCommand, LeaveRequestWithdrawn> => ({
  commandName: 'leave.withdraw-request',
  permission: LeavePermissions.request,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, command.leaveRequestId);

      if (found === undefined) return notFound<LeaveRequestWithdrawn>('leave request');

      const decisions = await dependencies.stores.decisions.forRequest(transaction, found.id);

      if (decisions.length > 0) {
        return refusedBy<LeaveRequestWithdrawn>({
          reason: 'already_decided',
          messageKey: 'leave.rejection.already_decided',
        });
      }

      const request = LeaveRequest.rehydrate(found);
      const withdrawn = request.withdraw(dependencies.clock.now());

      if (!withdrawn.ok) return refusedBy<LeaveRequestWithdrawn>(withdrawn.error);

      await dependencies.stores.requests.update(
        transaction,
        withdrawn.value,
        command.expectedVersion,
      );
      await releaseDays(transaction, dependencies, found.id);
      await recordRequestEvent(transaction, dependencies, {
        requestId: found.id,
        kind: 'withdrawn',
        fromState: found.state,
        toState: withdrawn.value.state,
      });

      return success({ leaveRequestId: found.id, state: withdrawn.value.state });
    }),
});

/**
 * The day rows step out of the way.
 *
 * Soft-deleted, never hard-deleted: the overlap constraint's predicate is `deleted_at is null`, so
 * removing the mark is what releases the date — and the rows stay readable, so "what did this
 * request originally cover" survives the withdrawal.
 */
export const releaseDays = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  requestId: string,
): Promise<void> => {
  const days = await dependencies.stores.requestDays.forRequest(transaction, requestId);
  const now = dependencies.clock.now();

  for (const day of days) {
    await dependencies.stores.requestDays.remove(transaction, day.id, now);
  }
};

export interface CancelLeaveRequestCommand extends Command {
  readonly commandName: 'leave.cancel-request';
  readonly leaveRequestId: string;
  readonly reasonCode?: string;
  readonly expectedVersion: number;
}

export interface LeaveRequestCancelled {
  readonly leaveRequestId: string;
  readonly state: string;
}

/**
 * Cancellation: unmaking an approved request.
 *
 * Writes a reversal against the original consumption, releases the dates, and records who and why.
 * It does **not** touch an attendance record: Leave never writes Attendance, and Attendance
 * discovers the change on its own reconciliation run by asking
 * `leave.approved-leave-affecting` (decision D-2 as approved — the direction is Attendance-pull,
 * not Leave-push).
 */
export const cancelLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<CancelLeaveRequestCommand, LeaveRequestCancelled> => ({
  commandName: 'leave.cancel-request',
  permission: LeavePermissions.cancel,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, command.leaveRequestId);

      if (found === undefined) return notFound<LeaveRequestCancelled>('leave request');

      const request = LeaveRequest.rehydrate(found);
      const cancelled = request.cancel(
        {
          actor: currentActor(),
          ...(command.reasonCode === undefined ? {} : { reasonCode: command.reasonCode }),
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!cancelled.ok) return refusedBy<LeaveRequestCancelled>(cancelled.error);

      const reversed = await reverseConsumptionFor(
        transaction,
        dependencies,
        found,
        command.reasonCode,
      );

      if (!reversed.ok) return refusedBy<LeaveRequestCancelled>(reversed.error);

      await dependencies.stores.requests.update(
        transaction,
        cancelled.value,
        command.expectedVersion,
      );
      transaction.collect(request.pullEvents());
      await releaseDays(transaction, dependencies, found.id);
      await recordRequestEvent(transaction, dependencies, {
        requestId: found.id,
        kind: 'cancelled',
        fromState: found.state,
        toState: cancelled.value.state,
      });

      return success({ leaveRequestId: found.id, state: cancelled.value.state });
    }),
});
