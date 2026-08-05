import { unwrap, type EventOrigin } from '@work/kernel';
import { describe, expect, it } from 'vitest';

import { Delegation } from './delegation.js';

const NOW = new Date('2026-08-05T10:00:00Z');
const FROM = new Date('2026-08-10T00:00:00Z');
const TO = new Date('2026-08-20T00:00:00Z');
const DURING = new Date('2026-08-15T00:00:00Z');
const AFTER = new Date('2026-08-21T00:00:00Z');

const TENANT = '01920000-0000-7000-8000-0000000000aa';
const DELEGATOR = '01920000-0000-7000-8000-000000000011';
const DELEGATE = '01920000-0000-7000-8000-000000000022';

const origin: EventOrigin = {
  tenantId: TENANT,
  correlationId: '01920000-0000-7000-8000-0000000000cc',
  actor: 'user:test',
};

const request = {
  tenantId: TENANT,
  delegatorMembershipId: DELEGATOR,
  delegateMembershipId: DELEGATE,
  scope: 'leave.approve',
  effectiveFrom: FROM,
  effectiveTo: TO,
  reason: 'annual leave',
};

const create = (overrides: Partial<typeof request> = {}, now = NOW) =>
  Delegation.create({ ...request, ...overrides }, origin, now);

describe('Delegation', () => {
  describe('what it refuses to create', () => {
    it('delegation to oneself, which reads in the register as arranged cover', () => {
      const outcome = create({ delegateMembershipId: DELEGATOR });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('delegation_to_self');
    });

    it('an inverted period, which is a typo', () => {
      const outcome = create({ effectiveFrom: TO, effectiveTo: FROM });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('delegation_period_inverted');
    });

    it('a zero-length period', () => {
      expect(create({ effectiveFrom: FROM, effectiveTo: FROM }).ok).toBe(false);
    });

    it('a period that has already passed, which nobody would notice was useless', () => {
      const outcome = create({}, AFTER);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('delegation_period_already_elapsed');
    });
  });

  describe('when it comes into force', () => {
    it('is scheduled when it starts in the future', () => {
      expect(unwrap(create()).currentStatus).toBe('scheduled');
    });

    it('is active when it starts now or has already started', () => {
      expect(unwrap(create({}, DURING)).currentStatus).toBe('active');
    });

    it('starts a scheduled delegation once its start has arrived', () => {
      const delegation = unwrap(create());

      expect(delegation.activate(origin, DURING).ok).toBe(true);
      expect(delegation.currentStatus).toBe('active');
    });

    it('refuses to start one before its start', () => {
      expect(unwrap(create()).activate(origin, NOW).ok).toBe(false);
    });
  });

  describe('is it in force at an instant', () => {
    const delegation = () => unwrap(create());

    it('no, before it starts', () => {
      expect(delegation().isInForceAt(NOW)).toBe(false);
    });

    it('yes, during', () => {
      expect(delegation().isInForceAt(DURING)).toBe(true);
    });

    it('yes, exactly at the start — the period is inclusive there', () => {
      expect(delegation().isInForceAt(FROM)).toBe(true);
    });

    it('no, exactly at the end — the period is exclusive there, so periods never overlap', () => {
      expect(delegation().isInForceAt(TO)).toBe(false);
    });

    it('no, once withdrawn, even mid-period', () => {
      const withdrawn = delegation();

      withdrawn.revoke('returned early', origin, DURING);

      // Computed from the period *and* the revocation, so a stale `active` status left by a
      // sweep that has not run cannot route an approval to somebody whose cover ended.
      expect(withdrawn.isInForceAt(DURING)).toBe(false);
    });
  });

  describe('withdrawal and expiry', () => {
    it('withdraws before the period ends', () => {
      const delegation = unwrap(create());

      expect(delegation.revoke('returned early', origin, DURING).ok).toBe(true);
      expect(delegation.currentStatus).toBe('revoked');
    });

    it('refuses a second withdrawal', () => {
      const delegation = unwrap(create());

      delegation.revoke('returned early', origin, DURING);

      expect(delegation.revoke('again', origin, DURING).ok).toBe(false);
    });

    it('expires once the period has elapsed', () => {
      const delegation = unwrap(create());

      expect(delegation.expire(origin, AFTER).ok).toBe(true);
      expect(delegation.currentStatus).toBe('expired');
    });

    it('refuses to expire one still in force', () => {
      const outcome = unwrap(create()).expire(origin, DURING);

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error.reason).toBe('delegation_still_in_force');
    });

    it('refuses to expire one already withdrawn, so the sweep is idempotent', () => {
      const delegation = unwrap(create());

      delegation.revoke('returned early', origin, DURING);

      expect(delegation.expire(origin, AFTER).ok).toBe(false);
    });
  });

  describe('the scope', () => {
    it('is carried verbatim and never interpreted', () => {
      const delegation = unwrap(create({ scope: 'anything.at.all' }));

      expect(delegation.scope).toBe('anything.at.all');
    });
  });
});
