import { unwrap, type EventOrigin } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { Invitation } from './invitation.js';

const AT = new Date('2026-08-05T10:00:00Z');
const IN_A_WEEK = new Date('2026-08-12T10:00:00Z');
const AFTER_EXPIRY = new Date('2026-08-13T10:00:00Z');
const TENANT = '01920000-0000-7000-8000-0000000000aa';
const ACCEPTOR = '01920000-0000-7000-8000-000000000011';

const origin: EventOrigin = {
  tenantId: TENANT,
  correlationId: '01920000-0000-7000-8000-0000000000cc',
  actor: 'user:test',
};

const issue = (email = 'sara@example.com'): Invitation => {
  const invitation = unwrap(
    Invitation.issue(
      { tenantId: TENANT, email, portals: ['employee'], expiresAt: IN_A_WEEK },
      origin,
      AT,
    ),
  );
  invitation.pullEvents();
  return invitation;
};

describe('Invitation', () => {
  describe('what an invitation is not', () => {
    it('carries no credential — there is no token field to intercept (AD-009)', () => {
      const serialized = JSON.stringify(issue().snapshot()).toLowerCase();

      for (const forbidden of ['token', 'password', 'secret', 'hash', 'code']) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  describe('issuing', () => {
    it('refuses an expiry that is not in the future', () => {
      const outcome = Invitation.issue(
        { tenantId: TENANT, email: 'sara@example.com', portals: [], expiresAt: AT },
        origin,
        AT,
      );

      expect(outcome.ok).toBe(false);
    });

    it('deduplicates the portals it was given', () => {
      const invitation = unwrap(
        Invitation.issue(
          {
            tenantId: TENANT,
            email: 'sara@example.com',
            portals: ['employee', 'employee', 'manager'],
            expiresAt: IN_A_WEEK,
          },
          origin,
          AT,
        ),
      );

      expect(invitation.portals).toEqual(['employee', 'manager']);
    });

    it('keeps the address as typed rather than normalizing it', () => {
      expect(issue('  Sara.Haddad@Example.com  ').email).toBe('Sara.Haddad@Example.com');
    });
  });

  describe('acceptance', () => {
    it('accepts when the authenticated address matches the one invited', () => {
      const invitation = issue();

      const outcome = invitation.acceptBy(
        { workforceUserId: ACCEPTOR, email: 'sara@example.com' },
        origin,
        AT,
      );

      expect(outcome.ok).toBe(true);
      expect(invitation.currentStatus).toBe('accepted');
      expect(invitation.snapshot().acceptedByWorkforceUserId).toBe(ACCEPTOR);
    });

    it('matches the address case-insensitively and ignoring surrounding space', () => {
      const invitation = issue('Sara.Haddad@Example.com');

      expect(
        invitation.acceptBy(
          { workforceUserId: ACCEPTOR, email: '  sara.haddad@example.com ' },
          origin,
          AT,
        ).ok,
      ).toBe(true);
    });

    it('refuses a colleague who followed a shared link', () => {
      const invitation = issue('sara@example.com');

      const outcome = invitation.acceptBy(
        { workforceUserId: ACCEPTOR, email: 'omar@example.com' },
        origin,
        AT,
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('invitation_addressed_to_someone_else');
      expect(invitation.currentStatus).toBe('pending');
    });

    it('refuses after the invitation has lapsed', () => {
      const invitation = issue();

      const outcome = invitation.acceptBy(
        { workforceUserId: ACCEPTOR, email: 'sara@example.com' },
        origin,
        AFTER_EXPIRY,
      );

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('invitation_expired');
    });

    it('refuses a second acceptance', () => {
      const invitation = issue();
      const acceptor = { workforceUserId: ACCEPTOR, email: 'sara@example.com' };

      invitation.acceptBy(acceptor, origin, AT);

      expect(invitation.acceptBy(acceptor, origin, AT).ok).toBe(false);
    });

    it('refuses after withdrawal', () => {
      const invitation = issue();

      invitation.revoke('hired somebody else', origin, AT);

      expect(
        invitation.acceptBy({ workforceUserId: ACCEPTOR, email: 'sara@example.com' }, origin, AT)
          .ok,
      ).toBe(false);
    });
  });

  describe('withdrawal and lapsing', () => {
    it('withdraws a pending invitation', () => {
      const invitation = issue();

      expect(invitation.revoke('hired somebody else', origin, AT).ok).toBe(true);
      expect(invitation.currentStatus).toBe('revoked');
    });

    it('refuses to withdraw one that has been accepted', () => {
      const invitation = issue();

      invitation.acceptBy({ workforceUserId: ACCEPTOR, email: 'sara@example.com' }, origin, AT);

      expect(invitation.revoke('too late', origin, AT).ok).toBe(false);
    });

    it('records expiry rather than leaving it to be inferred at read time', () => {
      const invitation = issue();

      expect(invitation.expire(origin, AFTER_EXPIRY).ok).toBe(true);
      expect(invitation.currentStatus).toBe('expired');
    });

    it('refuses to expire one whose period has not elapsed', () => {
      expect(issue().expire(origin, AT).ok).toBe(false);
    });

    it('refuses a second expiry, so the sweep that calls it is idempotent', () => {
      const invitation = issue();

      invitation.expire(origin, AFTER_EXPIRY);

      expect(invitation.expire(origin, AFTER_EXPIRY).ok).toBe(false);
      expect(
        invitation.pullEvents().filter((event) => event.eventName.endsWith('expired')),
      ).toHaveLength(1);
    });
  });
});
