import { uuidV7 } from '../identity/uuid-v7.js';

/**
 * A fact that has already happened.
 *
 * Events are immutable and versioned, and they are published only after the transaction that
 * produced them commits. Publishing before commit means a consumer can react to something that
 * then rolls back — a notification for a leave request that was never approved, a payroll
 * instruction for a run that failed.
 *
 * The envelope is the same for every event in the system, because the consumers that never see
 * the payload — audit, tracing, the integration hub — depend on the envelope alone.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Identity of this occurrence. Consumers deduplicate on it. */
  readonly eventId: string;
  readonly eventName: string;
  /** Schema version of the payload. Events outlive the code that wrote them. */
  readonly eventVersion: number;
  readonly tenantId: string;
  readonly occurredAt: Date;
  /** The business operation this belongs to, propagated from the request. */
  readonly correlationId: string;
  /** The event or command that caused this one, for reconstructing a chain. */
  readonly causationId?: string;
  /** Who or what performed the action. A user, a job, an integration. */
  readonly actor: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

export interface EventOrigin {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly actor: string;
  readonly causationId?: string;
}

export interface EventSubject {
  readonly aggregateType: string;
  readonly aggregateId: string;
}

/**
 * Builds an event envelope. `occurredAt` is supplied rather than read from the clock so that
 * every event raised by one transaction shares an instant, and so tests are deterministic.
 */
export const createDomainEvent = <TPayload>(
  definition: {
    readonly eventName: string;
    readonly eventVersion: number;
    readonly payload: TPayload;
    readonly occurredAt: Date;
  },
  subject: EventSubject,
  origin: EventOrigin,
): DomainEvent<TPayload> =>
  Object.freeze({
    eventId: uuidV7(definition.occurredAt.getTime()),
    eventName: definition.eventName,
    eventVersion: definition.eventVersion,
    tenantId: origin.tenantId,
    occurredAt: definition.occurredAt,
    correlationId: origin.correlationId,
    ...(origin.causationId === undefined ? {} : { causationId: origin.causationId }),
    actor: origin.actor,
    aggregateType: subject.aggregateType,
    aggregateId: subject.aggregateId,
    payload: definition.payload,
  });
