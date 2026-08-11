import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * The domain events Compensation raises, and the reason none of them is exported from the module's
 * contracts.
 *
 * Event delivery in this repository is **post-commit, in-process and at-most-once, with no
 * outbox**: the unit of work commits and *then* dispatches, and a process that dies between the two
 * loses whatever it was carrying. There is no published cross-module event contract and no
 * subscription contract, and inventing one for a consumer that does not exist yet is the work
 * Phase 16/17 exist to do properly.
 *
 * So these are **internal**, and nothing downstream depends on one for correctness. **Payroll
 * reconciles by asking**, through `compensation.changed-since`, and not by having been told. If
 * every event here were dropped, a payroll run would still find every change — which is the
 * ADR-0058 discipline applied before the consumer exists.
 *
 * They are worth raising anyway: they are where Communications (Phase 17) will subscribe when it
 * can address a recipient, and they carry the correlation identifier that makes one request
 * traceable across modules today.
 */

export const CompensationEvents = {
  assigned: 'compensation.assigned',
  changed: 'compensation.changed',
  approved: 'compensation.approved',
  adjusted: 'compensation.adjusted',
} as const;

export type CompensationEventName = (typeof CompensationEvents)[keyof typeof CompensationEvents];

/**
 * **No event carries a monetary amount.** Not a salary, not an allowance, not a difference.
 *
 * Events fan out to consumers this module does not know and end up in logs. A compensation event
 * carrying a salary would put somebody's pay into a log nobody scoped, and a salary is the one
 * disclosure that is both universally interesting and permanently damaging (§41). Identifiers,
 * dates and a change kind — nothing else.
 */
export const compensationEvent = <TPayload extends object>(
  eventName: CompensationEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent({ eventName, eventVersion: 1, payload, occurredAt }, subject, origin);
