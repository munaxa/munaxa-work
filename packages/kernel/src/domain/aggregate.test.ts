import { describe, expect, it, vi, type Mock } from 'vitest';

import { ConcurrencyException } from '../errors/domain-exception.js';
import { uuidV7 } from '../identity/uuid-v7.js';
import type { EventHandler } from '../persistence/unit-of-work.js';

import { createDomainEvent, type DomainEvent } from './domain-event.js';
import { AggregateRoot, Entity, ValueObject } from './entity.js';
import { InProcessEventDispatcher } from './in-process-dispatcher.js';

const ORIGIN = { tenantId: uuidV7(), correlationId: uuidV7(), actor: 'user:tester' };
const AT = new Date('2026-08-05T10:00:00Z');

class LeaveRequest extends AggregateRoot {
  public constructor(id: string, version = 0) {
    super(id, version);
  }

  public approve(): void {
    this.recordEvent(
      createDomainEvent(
        {
          eventName: 'leave.request.approved',
          eventVersion: 1,
          payload: { days: 1 },
          occurredAt: AT,
        },
        { aggregateType: 'LeaveRequest', aggregateId: this.id },
        ORIGIN,
      ),
    );
  }
}

class EmployeeNumber extends ValueObject {
  public constructor(public readonly value: string) {
    super();
  }
}

class Person extends Entity {
  public constructor(id: string) {
    super(id);
  }
}

describe('Entity', () => {
  it('is equal by identity, not by contents', () => {
    const id = uuidV7();

    expect(new Person(id).equals(new Person(id))).toBe(true);
    expect(new Person(id).equals(new Person(uuidV7()))).toBe(false);
  });
});

describe('ValueObject', () => {
  it('is equal by contents, not by identity', () => {
    expect(
      new EmployeeNumber('EMP-2026-000001').equals(new EmployeeNumber('EMP-2026-000001')),
    ).toBe(true);
    expect(
      new EmployeeNumber('EMP-2026-000001').equals(new EmployeeNumber('EMP-2026-000002')),
    ).toBe(false);
  });
});

describe('AggregateRoot', () => {
  it('collects events rather than publishing them', () => {
    const request = new LeaveRequest(uuidV7());
    request.approve();

    expect(request.hasPendingEvents()).toBe(true);
  });

  it('hands events over exactly once', () => {
    const request = new LeaveRequest(uuidV7());
    request.approve();

    expect(request.pullEvents()).toHaveLength(1);
    expect(request.pullEvents()).toHaveLength(0);
  });

  it('accepts a write from the version that was read', () => {
    const request = new LeaveRequest(uuidV7(), 3);

    expect(() => {
      request.assertVersion(3);
    }).not.toThrow();
  });

  it('refuses a write from a stale read rather than overwriting it', () => {
    const request = new LeaveRequest(uuidV7(), 4);

    expect(() => {
      request.assertVersion(3);
    }).toThrow(ConcurrencyException);
  });

  it('advances the version after a write', () => {
    const request = new LeaveRequest(uuidV7(), 1);
    request.nextVersion();

    expect(request.version).toBe(2);
    expect(() => {
      request.assertVersion(1);
    }).toThrow(ConcurrencyException);
  });
});

describe('domain events', () => {
  it('carries the envelope every consumer depends on', () => {
    const request = new LeaveRequest(uuidV7());
    request.approve();
    const [event] = request.pullEvents();

    expect(event).toMatchObject({
      eventName: 'leave.request.approved',
      eventVersion: 1,
      tenantId: ORIGIN.tenantId,
      correlationId: ORIGIN.correlationId,
      actor: 'user:tester',
      aggregateType: 'LeaveRequest',
      occurredAt: AT,
    });
    expect(event?.eventId).toBeDefined();
  });

  it('is immutable once raised', () => {
    const request = new LeaveRequest(uuidV7());
    request.approve();
    const [event] = request.pullEvents();

    expect(Object.isFrozen(event)).toBe(true);
  });

  it('omits causation when there is none, rather than carrying an empty value', () => {
    const request = new LeaveRequest(uuidV7());
    request.approve();
    const [event] = request.pullEvents();

    expect(event === undefined ? true : 'causationId' in event).toBe(false);
  });
});

describe('InProcessEventDispatcher', () => {
  const event = (name: string): DomainEvent =>
    createDomainEvent(
      { eventName: name, eventVersion: 1, payload: {}, occurredAt: AT },
      { aggregateType: 'LeaveRequest', aggregateId: uuidV7() },
      ORIGIN,
    );

  /** Returns the handler and its spy separately: a method read off the object is unbound. */
  const spyHandler = (
    eventName: string,
    behaviour: () => Promise<void>,
  ): { handler: EventHandler; handle: Mock } => {
    const handle = vi.fn(behaviour);
    return { handler: { eventName, handle }, handle };
  };

  it('delivers each event to every handler registered for it', async () => {
    const dispatcher = new InProcessEventDispatcher();
    const first = spyHandler('leave.request.approved', () => Promise.resolve());
    const second = spyHandler('leave.request.approved', () => Promise.resolve());
    dispatcher.register(first.handler);
    dispatcher.register(second.handler);

    await dispatcher.dispatch([event('leave.request.approved')]);

    expect(first.handle).toHaveBeenCalledOnce();
    expect(second.handle).toHaveBeenCalledOnce();
  });

  it('ignores events nobody subscribed to', async () => {
    const dispatcher = new InProcessEventDispatcher();

    await expect(dispatcher.dispatch([event('nobody.listens')])).resolves.toBeUndefined();
  });

  it('runs every handler even when one fails, then reports the failures', async () => {
    const dispatcher = new InProcessEventDispatcher();
    const failing = spyHandler('leave.request.approved', () => Promise.reject(new Error('notify')));
    const succeeding = spyHandler('leave.request.approved', () => Promise.resolve());
    dispatcher.register(failing.handler);
    dispatcher.register(succeeding.handler);

    await expect(dispatcher.dispatch([event('leave.request.approved')])).rejects.toThrow(
      AggregateError,
    );
    // The audit handler must still have run: the event already happened.
    expect(succeeding.handle).toHaveBeenCalledOnce();
  });
});
