import {
  success,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type Result,
  type Transaction,
} from '@work/kernel';

import { LeaveRequest } from '../domain/leave-request.js';
import { isApproved } from '../domain/leave-vocabulary.js';
import { definedOnly } from '../domain/leave-aggregate.js';
import { accept, type LeaveResult } from '../domain/leave-rejection.js';
import { reverseConsumptionFor } from './consumption.js';
import { releaseDays } from './cancellation.use-case.js';
import { currentActor, notFound, originOfCurrentRequest, refusedBy } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import { createLeaveRequest } from './request-writer.js';
import { recordRequestEvent } from './request-history.js';
import type { PortionRequest } from '../domain/duration.js';
import type { LeaveRequestState } from '../domain/leave-request-state.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Amending an approved request.
 *
 * **An approved request is never edited.** Shortening it, lengthening it, moving it and changing
 * its type are all the same operation: a *new* request that supersedes the original, decided by a
 * named human, replacing the original's consumption with its own in the transaction that approves
 * it. The original keeps its rows and its ledger entries, and the chain is readable in both
 * directions.
 *
 * The alternative — editing the original in place — would silently rewrite what somebody approved.
 * Two months later nobody could say whether the four days on the record were the four days that
 * were granted.
 *
 * **The original's days are released as soon as the amendment is raised.** They have to be: the
 * exclusion constraint would otherwise refuse the amendment for overlapping the very request it
 * replaces. The original stays `approved` — and therefore keeps holding its balance — until the
 * amendment is decided, so nothing is given back on the strength of a request that might be
 * refused.
 *
 * Changing the *reason text* on an undecided request is an ordinary update; changing it on an
 * approved one is not permitted, because the reason is part of what was decided.
 */

export interface AmendLeaveRequestCommand extends Command {
  readonly commandName: 'leave.amend-request';
  readonly leaveRequestId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly leaveTypeId?: string;
  readonly portions?: readonly PortionRequest[];
  readonly reasonCode?: string;
  readonly expectedVersion: number;
}

export interface LeaveRequestAmended {
  readonly amendmentRequestId: string;
  readonly supersedesRequestId: string;
  readonly state: string;
}

export const amendLeaveRequestHandler = (
  dependencies: LeaveDependencies,
): CommandHandler<AmendLeaveRequestCommand, LeaveRequestAmended> => ({
  commandName: 'leave.amend-request',
  permission: LeavePermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const original = await dependencies.stores.requests.byId(transaction, command.leaveRequestId);

      if (original === undefined) return notFound<LeaveRequestAmended>('leave request');
      if (!isApproved(original.state)) {
        return refusedBy<LeaveRequestAmended>({
          reason: 'only_an_approved_request_is_amended',
          messageKey: 'leave.rejection.only_an_approved_request_is_amended',
        });
      }

      // Released first, or the amendment collides with the request it replaces on the exclusion
      // constraint. The original keeps its state and its consumption until the amendment is decided.
      await releaseDays(transaction, dependencies, original.id);

      return raiseAmendment(transaction, dependencies, original, command);
    }),
});

/**
 * The amendment itself: a new request that supersedes the original, submitted at once.
 *
 * Submitted rather than left as a draft, because an amendment nobody submitted would have released
 * the original's dates and replaced them with nothing — an approved absence that no longer covers
 * any date.
 */
const raiseAmendment = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  original: LeaveRequestState,
  command: AmendLeaveRequestCommand,
): Promise<Result<LeaveRequestAmended, HandlerFailure>> => {
  const created = await createLeaveRequest(transaction, dependencies, {
    employmentId: original.employmentId,
    leaveTypeId: command.leaveTypeId ?? original.leaveTypeId,
    fromDate: command.fromDate,
    toDate: command.toDate,
    supersedesRequestId: original.id,
    ...definedOnly({
      portions: command.portions,
      reasonCode: command.reasonCode,
      justification: original.justification,
      attachmentReference: original.attachmentReference,
    }),
  });

  if (!created.ok) return refusedBy<LeaveRequestAmended>(created.error);

  const submitted = LeaveRequest.rehydrate(created.value.state).submit(
    originOfCurrentRequest(),
    dependencies.clock.now(),
  );

  if (!submitted.ok) return refusedBy<LeaveRequestAmended>(submitted.error);

  await dependencies.stores.requests.update(
    transaction,
    submitted.value,
    created.value.state.version,
  );
  await recordRequestEvent(transaction, dependencies, {
    requestId: original.id,
    kind: 'amended',
    fromState: original.state,
    detail: created.value.state.id,
  });

  // An amendment under a policy requiring no approval is approved by `submit` itself, so the
  // supersession has to happen here too rather than only in the decision path.
  if (submitted.value.state === 'approved') {
    const superseded = await supersedeOriginal(transaction, dependencies, submitted.value);

    if (!superseded.ok) return refusedBy<LeaveRequestAmended>(superseded.error);
  }

  return success({
    amendmentRequestId: created.value.state.id,
    supersedesRequestId: original.id,
    state: submitted.value.state,
  });
};

/**
 * What happens to the original when an amendment is approved.
 *
 * Its consumption is **reversed** and it is cancelled with the reason `amended`. There is no
 * `superseded` state: the database's state set does not have one, and adding one would mean two
 * words for the same thing — a request that no longer grants leave. What distinguishes an amended
 * original from an ordinary cancellation is the amendment's `supersedesRequestId` pointing at it,
 * which is a fact rather than a synonym.
 *
 * Called from the decision path as well as from the amendment command, because an amendment under a
 * policy requiring no approval never passes through a decision.
 */
export const supersedeOriginal = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  amendment: LeaveRequestState,
): Promise<LeaveResult<true>> => {
  if (amendment.supersedesRequestId === undefined) return accept(true);

  const original = await dependencies.stores.requests.byId(
    transaction,
    amendment.supersedesRequestId,
  );

  if (original === undefined || !isApproved(original.state)) return accept(true);

  const reversed = await reverseConsumptionFor(transaction, dependencies, original, 'amended');

  if (!reversed.ok) return reversed;

  const cancelled = LeaveRequest.rehydrate(original).cancel(
    { actor: currentActor(), reasonCode: 'amended' },
    originOfCurrentRequest(),
    dependencies.clock.now(),
  );

  if (!cancelled.ok) return cancelled;

  await dependencies.stores.requests.update(transaction, cancelled.value, original.version);
  await recordRequestEvent(transaction, dependencies, {
    requestId: original.id,
    kind: 'superseded',
    fromState: original.state,
    toState: cancelled.value.state,
    detail: amendment.id,
  });

  return accept(true);
};
