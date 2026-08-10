import { success, type Command, type CommandHandler } from '@work/kernel';

import { LeaveRequest } from '../domain/leave-request.js';
import { consumeFor } from './consumption.js';
import { notFound, originOfCurrentRequest, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import { createLeaveRequest, type CreateRequest } from './request-writer.js';
import { recordRequestEvent } from './request-history.js';
import type { PortionRequest } from '../domain/duration.js';
import type { Metadata } from '../domain/leave-aggregate.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Raising a leave request, and submitting it.
 *
 * Two commands, because a draft and an assertion are different things. A draft consumes no balance
 * and is invisible to conflict detection — somebody working out how to fit a holiday around a
 * project should not be blocking their own dates while they think about it.
 *
 * **Consumption is written at approval, not at submission and not at `taken`.** An approved future
 * absence is already committed: the balance an employee sees must not include leave they have been
 * granted, or they will plan against it twice.
 */

export interface RaiseLeaveRequestCommand extends Command, CreateRequest {
  readonly commandName: 'leave.raise-request';
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly portions?: readonly PortionRequest[];
  readonly metadata?: Metadata;
}

export interface LeaveRequestRaised {
  readonly leaveRequestId: string;
  readonly totalMinutes: number;
  readonly days: number;
  /** Dates in the range that produced no row, and why. What the screen shows beside the total. */
  readonly excluded: readonly { readonly onDate: string; readonly reason: string }[];
}

export const raiseLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<RaiseLeaveRequestCommand, LeaveRequestRaised> => ({
  commandName: 'leave.raise-request',
  permission: LeavePermissions.request,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const created = await createLeaveRequest(transaction, dependencies, command);

      if (!created.ok) return refusedBy<LeaveRequestRaised>(created.error);

      return success({
        leaveRequestId: created.value.state.id,
        totalMinutes: created.value.state.totalMinutes,
        days: created.value.breakdown.days.length,
        excluded: created.value.breakdown.excluded,
      });
    }),
});

export interface SubmitLeaveRequestCommand extends Command {
  readonly commandName: 'leave.submit-request';
  readonly leaveRequestId: string;
  readonly expectedVersion: number;
}

export interface LeaveRequestSubmitted {
  readonly leaveRequestId: string;
  readonly state: string;
}

/**
 * Submission, and the auto-approval path.
 *
 * A policy requiring **no** approval sends the request straight to `approved` and writes the
 * consumption here — with no decision row. The absence of the row is the record: this product does
 * not write `system:auto-approval` into a decision table and call it a human approval (ADR-0045).
 * The published approval chain says "no approval was required" rather than naming a system
 * approver.
 */
export const submitLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<SubmitLeaveRequestCommand, LeaveRequestSubmitted> => ({
  commandName: 'leave.submit-request',
  permission: LeavePermissions.request,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, command.leaveRequestId);

      if (found === undefined) return notFound<LeaveRequestSubmitted>('leave request');

      const request = LeaveRequest.rehydrate(found);
      const submitted = request.submit(originOfCurrentRequest(), dependencies.clock.now());

      if (!submitted.ok) return refusedBy<LeaveRequestSubmitted>(submitted.error);

      await dependencies.stores.requests.update(
        transaction,
        submitted.value,
        command.expectedVersion,
      );
      transaction.collect(request.pullEvents());
      await recordRequestEvent(transaction, dependencies, {
        requestId: found.id,
        kind: 'submitted',
        fromState: found.state,
        toState: submitted.value.state,
      });

      if (submitted.value.state === 'approved') {
        const consumed = await consumeFor(transaction, dependencies, submitted.value);

        if (!consumed.ok) return refusedBy<LeaveRequestSubmitted>(consumed.error);
      }

      return success({ leaveRequestId: found.id, state: submitted.value.state });
    }),
});
