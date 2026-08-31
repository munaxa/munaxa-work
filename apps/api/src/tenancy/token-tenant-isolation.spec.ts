import type { Request, Response } from 'express';
import { currentContext, uuidV7 } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { describe, expect, it } from 'vitest';

import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from '../identity/platform-token-authentication.js';

import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

/**
 * The regression suite for the risk Phase 2 introduces, and the reason the adapter reads the
 * claims it does.
 *
 * `tenant.middleware.spec.ts` already proves that a *header* cannot select a tenant somebody is
 * not a member of. That suite authenticates through a double, so it cannot see the new hazard:
 * a genuine Platform access token carries `tid`, the tenant Platform minted it for. If that
 * claim ever reached tenant resolution, a caller would once again be choosing their own tenant
 * — the exact defect ADR-0032 removed, reintroduced through a different door and harder to see,
 * because this time the value arrives inside a cryptographically valid token.
 *
 * So these tests wire the **real** `PlatformTokenAuthenticationPort` to the **real**
 * `TenantMiddleware` and vary only what the token says. The property under test is that the
 * token's tenant claim changes nothing, and that membership decides everything.
 */

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const PLATFORM_USER = 'platform-user-9';

const membershipOf = (tenantId: string): ResolvedMembership => ({
  tenantId,
  membershipId: uuidV7(),
  workforceUserId: uuidV7(),
  platformUserId: PLATFORM_USER,
  status: 'active',
});

const directoryWith = (...memberships: ResolvedMembership[]): TenantMembershipDirectory => ({
  activeMembershipsOf: () => Promise.resolve(memberships),
});

/**
 * A verifier that accepts the token and reports the claims it was built with, including a
 * tenant claim. It stands for a Platform token that is entirely genuine — the point being that
 * a genuine token still may not choose the tenant.
 */
const vouchingFor = (claims: Record<string, unknown>): AccessTokenVerifier => ({
  verifyAccessToken: () =>
    ({
      sub: PLATFORM_USER,
      iss: 'https://identity.example.com',
      iat: 1_780_000_000,
      ...claims,
    }) as unknown as VerifiedAccessToken,
});

const middlewareFor = (
  claims: Record<string, unknown>,
  directory: TenantMembershipDirectory,
): TenantMiddleware =>
  new TenantMiddleware(new PlatformTokenAuthenticationPort(vouchingFor(claims)), directory);

const requestWith = (headers: Record<string, string>): Request =>
  ({ headers, correlationId: uuidV7() }) as unknown as Request;

const response = {} as Response;

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

const AUTHORIZED = { authorization: 'Bearer a-genuine-platform-token' };

describe('the tenant claim inside a verified Platform token', () => {
  it('does not select the tenant — the stored membership does', async () => {
    // The token was minted for tenant A. The only membership is in tenant B. Membership wins,
    // because membership is the only thing that ever decided.
    const middleware = middlewareFor({ tid: TENANT_A }, directoryWith(membershipOf(TENANT_B)));

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBe(TENANT_B);
  });

  it('grants nothing when the person is a member of no tenant at all', async () => {
    const middleware = middlewareFor({ tid: TENANT_A }, directoryWith());

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });

  it('cannot break a tie the membership directory left ambiguous', async () => {
    // Two memberships and no header is refused rather than guessed. A token claim resolving it
    // would be the caller choosing, which is what may never happen.
    const middleware = middlewareFor(
      { tid: TENANT_A },
      directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
    );

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });

  it('changes nothing when it names a tenant the person is a member of', async () => {
    // The claim agreeing with the membership must be a coincidence, not a cause: the same
    // membership alone already resolves to the same tenant.
    const withClaim = middlewareFor({ tid: TENANT_A }, directoryWith(membershipOf(TENANT_A)));
    const withoutClaim = middlewareFor({}, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(withClaim, AUTHORIZED)).toBe(TENANT_A);
    expect(await tenantEstablishedBy(withoutClaim, AUTHORIZED)).toBe(TENANT_A);
  });
});

describe('the tenant header, against a genuinely authenticated caller', () => {
  it('cannot grant a membership the person does not hold', async () => {
    const middleware = middlewareFor({ tid: TENANT_A }, directoryWith(membershipOf(TENANT_B)));

    expect(
      await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
    ).toBeUndefined();
  });

  it('is refused even when the token was minted for the very tenant it names', async () => {
    // Token and header agree, and both are wrong: the person is a member of neither. Two
    // claims saying the same thing is still nobody vouching for it.
    const middleware = middlewareFor({ tid: TENANT_A }, directoryWith());

    expect(
      await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
    ).toBeUndefined();
  });

  it('narrows a genuine set of memberships, which is all it has ever been allowed to do', async () => {
    const middleware = middlewareFor(
      { tid: TENANT_A },
      directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
    );

    expect(
      await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_B }),
    ).toBe(TENANT_B);
  });
});

describe('a request the Platform verifier refuses', () => {
  const refusing = (): TenantMiddleware =>
    new TenantMiddleware(
      new PlatformTokenAuthenticationPort({
        verifyAccessToken: () => {
          throw new Error('invalid signature');
        },
      }),
      directoryWith(membershipOf(TENANT_A)),
    );

  it('establishes no tenant, even for somebody who genuinely holds a membership', async () => {
    expect(await tenantEstablishedBy(refusing(), AUTHORIZED)).toBeUndefined();
  });

  it('establishes no tenant however the header is set', async () => {
    expect(
      await tenantEstablishedBy(refusing(), { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
    ).toBeUndefined();
  });

  it('establishes no tenant when no credential was presented at all', async () => {
    const middleware = middlewareFor({ tid: TENANT_A }, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(middleware, {})).toBeUndefined();
  });
});
