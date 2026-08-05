import { createDomainEvent, uuidV7, type DomainEvent } from '@work/kernel';

/**
 * Object mothers. A test that spends ten lines constructing a valid aggregate tests the
 * construction as much as the behaviour, and stops being read.
 */

export const aTenantId = (): string => uuidV7();

export const anEvent = (
  eventName: string,
  payload: Readonly<Record<string, unknown>> = {},
  overrides: {
    readonly tenantId?: string;
    readonly occurredAt?: Date;
    readonly aggregateId?: string;
  } = {},
): DomainEvent =>
  createDomainEvent(
    {
      eventName,
      eventVersion: 1,
      payload,
      occurredAt: overrides.occurredAt ?? new Date('2026-01-01T00:00:00Z'),
    },
    { aggregateType: 'Test', aggregateId: overrides.aggregateId ?? uuidV7() },
    {
      tenantId: overrides.tenantId ?? aTenantId(),
      correlationId: uuidV7(),
      actor: 'user:test',
    },
  );
