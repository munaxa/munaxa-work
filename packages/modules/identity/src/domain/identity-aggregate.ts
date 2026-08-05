import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { identityEvent, type IdentityEventName } from './identity-events.js';

/**
 * What every aggregate in this module shares: it knows its own type name and it raises events
 * that carry its identity.
 *
 * Repeating that in eight classes would mean eight chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than
 * a missing event — a consumer acts on it.
 */
export abstract class IdentityAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: IdentityEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      identityEvent(
        eventName,
        { aggregateType: this.aggregateType, aggregateId: this.id },
        payload,
        origin,
        occurredAt,
      ),
    );
  }
}

/**
 * An aggregate that belongs to exactly one tenant — which is all of them here except
 * `WorkforceUser`, whose tenant-lessness is the documented exception (ADR-0033).
 *
 * The tenant is carried on the aggregate rather than looked up, so a rule that needs it cannot
 * accidentally read the *ambient* tenant of whatever request happens to be running.
 */
export abstract class TenantScopedAggregate extends IdentityAggregate {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    aggregateType: string,
  ) {
    super(id, version, aggregateType);
  }
}
