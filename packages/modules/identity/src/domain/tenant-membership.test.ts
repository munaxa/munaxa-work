import type { EventOrigin } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { TenantMembership } from './tenant-membership.js';
import { IdentityEvents } from './identity-events.js';

const AT = new Date('2026-08-05T10:00:00Z');
const LATER = new Date('2026-09-01T10:00:00Z');
const TENANT = '01920000-0000-7000-8000-0000000000aa';
const OTHER_TENANT = '01920000-0000-7000-8000-0000000000bb';
const USER = '01920000-0000-7000-8000-000000000011';

const origin: EventOrigin = {
  tenantId: TENANT,
  correlationId: '01920000-0000-7000-8000-0000000000cc',
  actor: 'user:test',
};

const admitted = (): TenantMembership => {
  const membership = TenantMembership.admit(TENANT, USER, origin, AT);
  membership.pullEvents();
  return membership;
};

describe('TenantMembership', () => {
  describe('admission', () => {
    it('begins active: a membership exists once somebody actually is a member', () => {
      expect(admitted().currentStatus).toBe('active');
    });

    it('records when they joined', () => {
      expect(admitted().snapshot().joinedAt).toEqual(AT);
    });

    it('belongs to exactly one tenant, carried on the aggregate rather than looked up', () => {
      expect(admitted().tenantId).toBe(TENANT);
      expect(admitted().tenantId).not.toBe(OTHER_TENANT);
    });
  });

  describe('may this membership select a request’s tenant', () => {
    it('yes, when active', () => {
      expect(admitted().maySelectTenant).toBe(true);
    });

    it('no, when suspended — a suspended administrator must stop working', () => {
      const membership = admitted();

      membership.suspend('investigation', origin, AT);

      expect(membership.maySelectTenant).toBe(false);
    });

    it('no, when ended', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);

      expect(membership.maySelectTenant).toBe(false);
    });
  });

  describe('the lifecycle', () => {
    it('suspends and reinstates', () => {
      const membership = admitted();

      expect(membership.suspend('investigation', origin, AT).ok).toBe(true);
      expect(membership.currentStatus).toBe('suspended');
      expect(membership.reinstate(origin, LATER).ok).toBe(true);
      expect(membership.currentStatus).toBe('active');
    });

    it('refuses to suspend somebody who is not active', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);

      expect(membership.suspend('investigation', origin, LATER).ok).toBe(false);
    });

    it('ends, recording when', () => {
      const membership = admitted();

      expect(membership.end('resigned', origin, LATER).ok).toBe(true);
      expect(membership.snapshot().endedAt).toEqual(LATER);
    });

    it('refuses to end twice', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);

      expect(membership.end('resigned again', origin, LATER).ok).toBe(false);
    });

    it('readmits somebody who left: a rehire is the same person, not a new one', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);
      expect(membership.rejoin(origin, LATER).ok).toBe(true);

      expect(membership.currentStatus).toBe('active');
      expect(membership.snapshot().joinedAt).toEqual(LATER);
      // The departure is no longer in force, and the identity is the same row.
      expect(membership.snapshot().endedAt).toBeUndefined();
      expect(membership.workforceUserId).toBe(USER);
    });

    it('refuses to rejoin somebody who never left', () => {
      expect(admitted().rejoin(origin, LATER).ok).toBe(false);
    });
  });

  describe('events', () => {
    it('names the membership and the person for every change', () => {
      const membership = admitted();

      membership.suspend('investigation', origin, AT);
      const [event] = membership.pullEvents();
      const payload = event?.payload as { membershipId: string; workforceUserId: string };

      expect(payload.membershipId).toBe(membership.id);
      expect(payload.workforceUserId).toBe(USER);
    });

    it('distinguishes a rejoin from a first admission in the payload, not by flattening it', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);
      membership.pullEvents();
      membership.rejoin(origin, LATER);
      const [event] = membership.pullEvents();

      expect(event?.eventName).toBe(IdentityEvents.membershipActivated);
      expect((event?.payload as { rejoined?: boolean }).rejoined).toBe(true);
    });

    it('raises the departure event that portals and delegations react to', () => {
      const membership = admitted();

      membership.end('resigned', origin, AT);

      expect(membership.pullEvents().map((event) => event.eventName)).toEqual([
        IdentityEvents.membershipEnded,
      ]);
    });
  });
});
