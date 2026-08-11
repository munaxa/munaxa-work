import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * The domain events Payroll raises, and the reason none is exported from the module's contracts.
 *
 * Event delivery in this repository is **post-commit, in-process and at-most-once, with no outbox**:
 * the unit of work commits and *then* dispatches, and a process that dies between the two loses
 * whatever it was carrying. So **nothing downstream may depend on one**. If every event here were
 * dropped, every figure would still be right and every stale run would still be found — because
 * staleness is found by asking, not by being told (ADR-0064). The lost-event scenario in the
 * cross-module suite exists to prove exactly that.
 *
 * **Not one carries a monetary amount.** No gross, no net, no deduction, no currency figure. Events
 * fan out to handlers that were never checked against `payroll.read-result`, and they end up in
 * logs, traces and whatever a future subscriber persists. Identifiers, dates and counts — nothing
 * else.
 */

export const PayrollEvents = {
  calculated: 'payroll.run-calculated',
  stale: 'payroll.run-stale',
  approved: 'payroll.run-approved',
  finalized: 'payroll.run-finalized',
  reversed: 'payroll.run-reversed',
} as const;

export type PayrollEventName = (typeof PayrollEvents)[keyof typeof PayrollEvents];

export const payrollEvent = <TPayload extends object>(
  eventName: PayrollEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent({ eventName, eventVersion: 1, payload, occurredAt }, subject, origin);
