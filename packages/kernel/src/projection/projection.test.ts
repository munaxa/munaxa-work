import { describe, expect, it } from 'vitest';

import { createDomainEvent, type DomainEvent } from '../domain/domain-event.js';
import { uuidV7 } from '../identity/uuid-v7.js';

import { project, verifyRebuild, type Projection } from './projection.js';

const origin = { tenantId: uuidV7(), correlationId: uuidV7(), actor: 'user:tester' };
const employmentId = uuidV7();

const event = (eventName: string, payload: Record<string, unknown>, at: string): DomainEvent =>
  createDomainEvent(
    { eventName, eventVersion: 1, payload, occurredAt: new Date(at) },
    { aggregateType: 'Leave', aggregateId: employmentId },
    origin,
  );

interface Balance {
  readonly accrued: number;
  readonly consumed: number;
}

const leaveBalance: Projection<Balance> = {
  name: 'leave.balance',
  consumes: ['leave.accrued', 'leave.consumed'],
  initial: { accrued: 0, consumed: 0 },
  apply: (state, domainEvent) => {
    const { days } = domainEvent.payload as { days: number };
    return domainEvent.eventName === 'leave.accrued'
      ? { ...state, accrued: state.accrued + days }
      : { ...state, consumed: state.consumed + days };
  },
};

describe('project', () => {
  const events = [
    event('leave.accrued', { days: 2.5 }, '2026-01-31T00:00:00Z'),
    event('leave.accrued', { days: 2.5 }, '2026-02-28T00:00:00Z'),
    event('leave.consumed', { days: 1 }, '2026-03-05T00:00:00Z'),
    event('payroll.finalized', { days: 999 }, '2026-03-31T00:00:00Z'),
  ];

  it('folds the events it consumes', () => {
    expect(project(leaveBalance, events)).toEqual({ accrued: 5, consumed: 1 });
  });

  it('ignores events it does not consume rather than failing on them', () => {
    expect(project(leaveBalance, events).consumed).toBe(1);
  });

  it('is deterministic — the same events always give the same state', () => {
    expect(project(leaveBalance, events)).toEqual(project(leaveBalance, events));
  });

  it('can continue from an existing state, which is what an incremental update does', () => {
    const first = project(leaveBalance, events.slice(0, 2));
    const continued = project(leaveBalance, events.slice(2), first);

    expect(continued).toEqual(project(leaveBalance, events));
  });

  it('detects drift between a stored projection and a rebuild', () => {
    const drifted = verifyRebuild(leaveBalance, events, { accrued: 5, consumed: 0 });
    const sound = verifyRebuild(leaveBalance, events, { accrued: 5, consumed: 1 });

    expect(drifted.matches).toBe(false);
    expect(drifted.rebuilt).toEqual({ accrued: 5, consumed: 1 });
    expect(sound.matches).toBe(true);
  });
});
