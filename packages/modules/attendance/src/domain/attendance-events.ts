import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * The domain events Attendance raises, and the reason none of them is exported from the module's
 * contracts.
 *
 * Event delivery in this repository is **post-commit, in-process and at-most-once, with no
 * outbox**: the unit of work commits and *then* dispatches, and a process that dies between the two
 * loses whatever it was carrying. There is no published cross-module event contract and no
 * subscription contract, and inventing one for a single consumer is the work Phase 16/17 exist to
 * do properly — the same reasoning that had Phase 7 refuse to publish Recruitment's hire event.
 *
 * So these are **internal**. Nothing downstream depends on one for correctness:
 *
 * - Recalculation is found by asking, not by being told — `inputs_changed_at` is written in the
 *   same transaction as the input change, and a reconciliation query names what is stale (ADR-0053).
 * - Payroll reads a frozen snapshot rather than subscribing to anything (ADR-0054).
 *
 * They are worth raising anyway: they are where Communications (Phase 17) will subscribe when it can
 * address a recipient, and they carry the correlation identifier that makes one request traceable
 * across modules today.
 */

export const AttendanceEvents = {
  eventRecorded: 'attendance.event.recorded',
  dayCalculated: 'attendance.day.calculated',
  dayApproved: 'attendance.day.approved',
  exceptionRaised: 'attendance.exception.raised',
  correctionRequested: 'attendance.correction.requested',
  correctionApplied: 'attendance.correction.applied',
  schedulePublished: 'attendance.schedule.published',
  periodFrozen: 'attendance.period.frozen',
} as const;

export type AttendanceEventName = (typeof AttendanceEvents)[keyof typeof AttendanceEvents];

/**
 * No event carries a coordinate, a note, a justification or anything that identifies a human being
 * beyond the employment identifier.
 *
 * Events fan out to consumers this module does not know and end up in logs. An attendance event
 * that carried a punch location would put an employee's whereabouts into a log nobody scoped, and
 * one that carried a justification would put their explanation of a missed shift there.
 */
export const attendanceEvent = <TPayload extends object>(
  eventName: AttendanceEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent({ eventName, eventVersion: 1, payload, occurredAt }, subject, origin);
