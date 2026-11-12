import type { Request, Response } from 'express';
import { currentContext, uuidV7 } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { describe, expect, it } from 'vitest';

import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from '../identity/platform-token-authentication.js';

import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

/**
 * The regression suite for the two ways a genuine token could reach the wrong tenant.
 *
 * `tenant.middleware.spec.ts` already proves that a *header* cannot select a tenant somebody is
 * not a member of. These tests wire the **real** `PlatformTokenAuthenticationPort` to the **real**
 * `TenantMiddleware` and vary what the token says, against a directory that holds to the same rule
 * `app_bound_memberships_of` does in the database: only memberships of the Work tenant bound to the
 * token's organisation are returned (ADR-0080).
 *
 * The two properties:
 *
 * - **The token's `tid` never selects a Work tenant.** It names a Platform organisation, which is a
 *   different identifier space; the tenant still comes from a stored membership (ADR-0032).
 * - **The token's grants never leave the organisation they were issued for** (WK-01). A person who
 *   is a member of two Work tenants can act, with a given token, only in the one bound to that
 *   token's organisation — whatever the header says.
 */

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ISSUER = 'https://identity.example.com';
const PLATFORM_USER = 'platform-user-9';

/** Which organisation each Work tenant is bound to, as `tenant_platform_binding` records it. */
const BINDINGS = new Map<string, string>([
  [TENANT_A, ORG_A],
  [TENANT_B, ORG_B],
]);

const membershipOf = (tenantId: string): ResolvedMembership => ({
  tenantId,
  membershipId: uuidV7(),
  workforceUserId: uuidV7(),
  platformUserId: PLATFORM_USER,
  status: 'active',
});

const directoryWith = (...memberships: ResolvedMembership[]): TenantMembershipDirectory => ({
  activeMembershipsOf: (_user, organisation) =>
    Promise.resolve(
      memberships.filter(
        (membership) =>
          organisation.issuer === ISSUER &&
          BINDINGS.get(membership.tenantId) === organisation.tenantId,
      ),
    ),
});

/** A verifier that accepts the token and reports the claims it was built with. */
const vouchingFor = (claims: Record<string, unknown>): AccessTokenVerifier => ({
  verifyAccessToken: () => ({
    sub: PLATFORM_USER,
    iss: ISSUER,
    iat: 1_780_000_000,
    exp: 1_780_000_900,
    sid: 'sess-1',
    tid: ORG_A,
    ...claims,
  }),
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

describe('the organisation claim inside a verified Platform token', () => {
  it('is never a Work tenant: a tid equal to a Work tenant id resolves nothing', async () => {
    // A caller who learned a Work tenant id and got a token whose tid happens to equal it gains
    // nothing: no Work tenant is bound to an organisation with that id.
    const middleware = middlewareFor({ tid: TENANT_B }, directoryWith(membershipOf(TENANT_B)));

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });

  it('resolves the member’s tenant when it is the one bound to the token’s organisation', async () => {
    const middleware = middlewareFor({ tid: ORG_A }, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBe(TENANT_A);
  });

  it('WK-01: a member of two tenants acts with an organisation-A token in tenant A only', async () => {
    const both = directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B));
    const orgAToken = middlewareFor({ tid: ORG_A }, both);

    // No header: no longer ambiguous, because only one tenant is eligible for this token.
    expect(await tenantEstablishedBy(orgAToken, AUTHORIZED)).toBe(TENANT_A);
    // Naming tenant B is refused, not honoured: the grants were computed in organisation A.
    expect(
      await tenantEstablishedBy(orgAToken, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_B }),
    ).toBeUndefined();
    expect(await tenantEstablishedBy(orgAToken, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A })).toBe(
      TENANT_A,
    );
  });

  it('grants nothing when the token’s organisation is bound to no tenant the person belongs to', async () => {
    const middleware = middlewareFor({ tid: ORG_B }, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });

  it('grants nothing for an organisation no Work tenant is bound to', async () => {
    const middleware = middlewareFor({ tid: 'org-unbound' }, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });

  it('a token without an organisation, a session or an expiry is not a principal at all', async () => {
    for (const missing of [
      { tid: undefined },
      { tid: '' },
      { sid: undefined },
      { exp: undefined },
    ]) {
      const middleware = middlewareFor(missing, directoryWith(membershipOf(TENANT_A)));
      expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
    }
  });

  it('grants nothing when the person is a member of no tenant at all', async () => {
    const middleware = middlewareFor({ tid: ORG_A }, directoryWith());

    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBeUndefined();
  });
});

describe('the tenant header, against a genuinely authenticated caller', () => {
  it('cannot grant a membership the person does not hold', async () => {
    const middleware = middlewareFor({ tid: ORG_A }, directoryWith());

    expect(
      await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
    ).toBeUndefined();
  });

  it('cannot move an organisation-B token into tenant A, where the person is also a member', async () => {
    const middleware = middlewareFor(
      { tid: ORG_B },
      directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
    );

    expect(
      await tenantEstablishedBy(middleware, { ...AUTHORIZED, [TENANT_HEADER]: TENANT_A }),
    ).toBeUndefined();
    expect(await tenantEstablishedBy(middleware, AUTHORIZED)).toBe(TENANT_B);
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
    const middleware = middlewareFor({ tid: ORG_A }, directoryWith(membershipOf(TENANT_A)));

    expect(await tenantEstablishedBy(middleware, {})).toBeUndefined();
  });
});
