import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * The domain events Leave raises, and the reason none of them is exported from the module's
 * contracts.
 *
 * Event delivery in this repository is **post-commit, in-process and at-most-once, with no
 * outbox**: the unit of work commits and *then* dispatches, and a process that dies between the two
 * loses whatever it was carrying. There is no published cross-module event contract and no
 * subscription contract, and inventing one for a single consumer is the work Phase 16/17 exist to
 * do properly.
 *
 * So these are **internal**, and nothing downstream depends on one for correctness:
 *
 * - The balance projection is reconciled, not notified — `inputs_changed_at` is written in the same
 *   transaction as the ledger entry that moved it, and a reconciliation query names what is stale
 *   (ADR-0053).
 * - Attendance discovers leave changes by **asking Leave**, through
 *   `leave.approved-leave-affecting`, on its own reconciliation run. It does not subscribe to
 *   `leave.request.approved`, and if every event here were dropped the attendance record would
 *   still converge.
 *
 * They are worth raising anyway: they are where Communications (Phase 17) will subscribe when it
 * can address a recipient, and they carry the correlation identifier that makes one request
 * traceable across modules today.
 */

export const LeaveEvents = {
  requestSubmitted: 'leave.request.submitted',
  requestApproved: 'leave.request.approved',
  requestRejected: 'leave.request.rejected',
  requestCancelled: 'leave.request.cancelled',
  requestAmended: 'leave.request.amended',
  balanceRecalculated: 'leave.balance.recalculated',
  entitlementGranted: 'leave.entitlement.granted',
  leaveYearClosed: 'leave.year.closed',
} as const;

export type LeaveEventName = (typeof LeaveEvents)[keyof typeof LeaveEvents];

/**
 * No event carries a justification, a reason text, an attachment reference or anything about *why*
 * somebody is away.
 *
 * Events fan out to consumers this module does not know and end up in logs. A leave event carrying
 * a sick-leave justification would put something close to health data into a log nobody scoped
 * (§30). Identifiers, dates, minutes and a state — nothing else.
 */
export const leaveEvent = <TPayload extends object>(
  eventName: LeaveEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent({ eventName, eventVersion: 1, payload, occurredAt }, subject, origin);
