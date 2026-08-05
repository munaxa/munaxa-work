import type { Request, Response } from 'express';
import { currentContext, uuidV7, type PlatformAuthenticationPort } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { describe, expect, it } from 'vitest';

import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

/**
 * The regression suite for the largest open risk Phase 1.1 recorded: the API believed an
 * `x-tenant-id` header, so any caller could act as any tenant.
 *
 * The property under test is not "the middleware reads a header correctly". It is that **a
 * caller cannot select a tenant they are not a member of**, and that removing the membership
 * lookup — going back to trusting the header — makes these tests fail rather than pass more
 * easily. Each one below says which line of defence it is exercising.
 */

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const PLATFORM_USER = 'platform-user-1';

const membershipOf = (tenantId: string): ResolvedMembership => ({
  tenantId,
  membershipId: uuidV7(),
  workforceUserId: uuidV7(),
  platformUserId: PLATFORM_USER,
  status: 'active',
});

/** Stands in for Platform. It authenticates whoever it was constructed with, and nobody else. */
const authenticating = (platformUserId?: string): PlatformAuthenticationPort => ({
  authenticate: (credentials) =>
    Promise.resolve(
      platformUserId === undefined || credentials === undefined
        ? undefined
        : {
            platformUserId,
            issuer: 'platform-test',
            email: 'sara@example.com',
            authenticatedAt: new Date('2026-08-05T00:00:00Z'),
          },
    ),
});

const directoryWith = (...memberships: ResolvedMembership[]): TenantMembershipDirectory => ({
  activeMembershipsOf: () => Promise.resolve(memberships),
});

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers, correlationId: uuidV7() }) as unknown as Request;

const response = {} as Response;

/** Runs the middleware and reports the tenant that ended up in context, if any. */
const tenantEstablishedBy = async (
  middleware: TenantMiddleware,
  headers: Record<string, string>,
): Promise<string | undefined> => {
  let observed: string | undefined;

  await middleware.use(requestWith(headers), response, () => {
    const context = currentContext();
    observed = context !== undefined && !('system' in context) ? context.tenantId : undefined;
  });
  return observed;
};

const AUTHORIZED = { authorization: 'Bearer a-platform-token' };

describe('TenantMiddleware', () => {
  describe('a forged tenant header', () => {
    it('cannot select a tenant the authenticated person is not a member of', async () => {
      // Sara is an active member of tenant A only. She asks for tenant B.
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membershipOf(TENANT_A)),
      );

      const established = await tenantEstablishedBy(middleware, {
        ...AUTHORIZED,
        [TENANT_HEADER]: TENANT_B,
      });

      // Not tenant B, and not a silent fallback to tenant A either: the request runs with no
      // tenant at all, and every tenant-scoped operation downstream then refuses.
      //
      // This is the assertion that fails if the membership lookup is removed. Trust the header
      // again and `established` becomes TENANT_B.
      expect(established).toBeUndefined();
    });

    it('cannot select any tenant at all when the caller is not authenticated', async () => {
      // The pre-Phase-2 behaviour in full: a header, no credentials, and previously a context.
      const middleware = new TenantMiddleware(
        authenticating(undefined),
        directoryWith(membershipOf(TENANT_A)),
      );

      expect(await tenantEstablishedBy(middleware, { [TENANT_HEADER]: TENANT_A })).toBeUndefined();
    });

    it('cannot invent a membership for a person who has none', async () => {
      const middleware = new TenantMiddleware(authenticating(PLATFORM_USER), directoryWith());

      expect(
        await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
      ).toBeUndefined();
    });
  });

  describe('an authenticated member', () => {
    it('acts in their tenant when they belong to exactly one', async () => {
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membershipOf(TENANT_A)),
      );

      expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBe(TENANT_A);
    });

    it('may name which of their tenants they mean', async () => {
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
      );

      expect(
        await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_B }),
      ).toBe(TENANT_B);
    });

    it('is refused rather than guessed for when they belong to several and name none', async () => {
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
      );

      // Picking the first would work most of the time and put a consultant's work in the wrong
      // customer's tenant the one time it mattered.
      expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
    });
  });

  describe('the audit actor', () => {
    it('is the workforce user, not the placeholder Phase 1.1 recorded', async () => {
      const membership = membershipOf(TENANT_A);
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membership),
      );
      let actor: string | undefined;

      await middleware.use(requestWith(AUTHORIZED), response, () => {
        const context = currentContext();
        actor = context !== undefined && !('system' in context) ? context.actor : undefined;
      });

      expect(actor).toBe(`user:${membership.workforceUserId}`);
      expect(actor).not.toBe('user:anonymous');
    });
  });

  describe('what the middleware puts on the request', () => {
    it('exposes the principal and the resolved membership, and nothing the caller sent', async () => {
      const membership = membershipOf(TENANT_A);
      const middleware = new TenantMiddleware(
        authenticating(PLATFORM_USER),
        directoryWith(membership),
      );
      const request = requestWith({ ...AUTHORIZED, [TENANT_HEADER]: TENANT_A });

      await middleware.use(request, response, () => undefined);

      const enriched = request as unknown as {
        principal?: { platformUserId: string };
        membership?: ResolvedMembership;
      };

      expect(enriched.principal?.platformUserId).toBe(PLATFORM_USER);
      // The membership came from the directory, so its identifiers are ones the caller never saw
      // and could not have supplied.
      expect(enriched.membership?.membershipId).toBe(membership.membershipId);
    });
  });
});
