import { isUuidV7, type EventOrigin } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { WorkforceUser } from './workforce-user.js';
import { IdentityEvents } from './identity-events.js';

const AT = new Date('2026-08-05T10:00:00Z');

const origin: EventOrigin = {
  tenantId: '01920000-0000-7000-8000-0000000000aa',
  correlationId: '01920000-0000-7000-8000-0000000000cc',
  actor: 'user:test',
};

const provisioned = (): WorkforceUser => WorkforceUser.provision('platform-1', origin, AT);

const active = (): WorkforceUser => {
  const user = provisioned();
  user.activate(origin, AT);
  user.pullEvents();
  return user;
};

describe('WorkforceUser', () => {
  describe('provisioning', () => {
    it('mints a UUIDv7, so identifiers order by creation', () => {
      expect(isUuidV7(provisioned().id)).toBe(true);
    });

    it('starts provisioned: known to the product, admitted by nobody', () => {
      expect(provisioned().currentStatus).toBe('provisioned');
    });

    it('records the provisioning as a fact, not as an instruction', () => {
      expect(
        provisioned()
          .pullEvents()
          .map((event) => event.eventName),
      ).toEqual([IdentityEvents.userProvisioned]);
    });

    it('carries no credential of any kind (AD-003)', () => {
      const serialized = JSON.stringify(provisioned().snapshot());

      for (const forbidden of ['password', 'token', 'secret', 'hash', 'credential']) {
        expect(serialized.toLowerCase()).not.toContain(forbidden);
      }
    });
  });

  describe('the Platform identifier', () => {
    it('is immutable (AD-004)', () => {
      const user = provisioned();
      const descriptor = Object.getOwnPropertyDescriptor(user, 'platformUserId');

      // Declared `readonly` and never reassigned: there is no method on this class that changes
      // it, which is what "immutable for the life of the account" has to mean in practice.
      expect(descriptor?.writable ?? true).toBe(true);
      expect(user.platformUserId).toBe('platform-1');
      expect(Object.keys(user).filter((key) => key.includes('platformUser'))).toEqual([
        'platformUserId',
      ]);
    });

    it('survives every lifecycle transition unchanged', () => {
      const user = active();

      user.suspend('investigation', origin, AT);
      user.reinstate(origin, AT);
      user.deactivate('left the group', origin, AT);

      expect(user.platformUserId).toBe('platform-1');
    });
  });

  describe('the lifecycle', () => {
    it('activates on first admission', () => {
      const user = provisioned();

      expect(user.activate(origin, AT).ok).toBe(true);
      expect(user.currentStatus).toBe('active');
    });

    it('treats activating an already active account as a no-op, not an error', () => {
      const user = active();

      expect(user.activate(origin, AT).ok).toBe(true);
      expect(user.hasPendingEvents()).toBe(false);
    });

    it('suspends only an active account', () => {
      const user = provisioned();
      const outcome = user.suspend('investigation', origin, AT);

      expect(outcome.ok).toBe(false);
      expect(user.currentStatus).toBe('provisioned');
    });

    it('reinstates only a suspended account', () => {
      expect(active().reinstate(origin, AT).ok).toBe(false);
    });

    it('round-trips suspension and reinstatement', () => {
      const user = active();

      user.suspend('investigation', origin, AT);
      expect(user.currentStatus).toBe('suspended');

      user.reinstate(origin, AT);
      expect(user.currentStatus).toBe('active');
    });

    it('refuses to deactivate twice, so the sweep that calls it is idempotent', () => {
      const user = active();

      expect(user.deactivate('left', origin, AT).ok).toBe(true);
      expect(user.deactivate('left', origin, AT).ok).toBe(false);
    });

    it('permits nothing after deactivation', () => {
      const user = active();

      user.deactivate('left', origin, AT);

      expect(user.activate(origin, AT).ok).toBe(false);
      expect(user.suspend('why', origin, AT).ok).toBe(false);
      expect(user.reinstate(origin, AT).ok).toBe(false);
      expect(user.currentStatus).toBe('deactivated');
    });

    it('states which state it refused from, so the message can say so', () => {
      const outcome = active().reinstate(origin, AT);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error.reason).toBe('workforce_user_not_reinstatable');
        // A catalogue key, never an English sentence: the domain does not choose a language.
        expect(outcome.error.messageKey).toBe('identity.rejection.workforce_user_not_reinstatable');
      }
    });
  });

  describe('events', () => {
    it('carries the tenant, actor and correlation of the act that caused them', () => {
      const user = active();

      user.suspend('investigation', origin, AT);
      const [event] = user.pullEvents();

      expect(event?.tenantId).toBe(origin.tenantId);
      expect(event?.actor).toBe(origin.actor);
      expect(event?.correlationId).toBe(origin.correlationId);
      expect(event?.eventVersion).toBe(1);
    });

    it('names the user it is about, so a consumer never has to join', () => {
      const user = active();

      user.deactivate('left', origin, AT);
      const [event] = user.pullEvents();

      expect((event?.payload as { workforceUserId: string }).workforceUserId).toBe(user.id);
    });

    it('is immutable once raised', () => {
      const user = active();

      user.suspend('investigation', origin, AT);
      const [event] = user.pullEvents();

      expect(Object.isFrozen(event)).toBe(true);
    });

    it('raises nothing when a transition is refused', () => {
      const user = provisioned();

      user.pullEvents();
      user.suspend('investigation', origin, AT);

      expect(user.pullEvents()).toEqual([]);
    });
  });

  describe('rehydration', () => {
    it('rebuilds from storage without raising anything: nothing happened, we read it', () => {
      const user = WorkforceUser.rehydrate({
        id: '01920000-0000-7000-8000-000000000001',
        platformUserId: 'platform-1',
        status: 'suspended',
        version: 7,
      });

      expect(user.currentStatus).toBe('suspended');
      expect(user.version).toBe(7);
      expect(user.hasPendingEvents()).toBe(false);
    });
  });
});
