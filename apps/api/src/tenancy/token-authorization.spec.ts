import type { Request, Response } from 'express';
import { currentContext, uuidV7 } from '@work/kernel';
import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import { describe, expect, it } from 'vitest';

import { PlatformPermissionChecker } from '../identity/permission-checker.js';
import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from '../identity/platform-token-authentication.js';

import { TENANT_HEADER, TenantMiddleware } from './tenant.middleware.js';

/**
 * Authorization end to end, through the real adapter, the real middleware and the real checker.
 *
 * `platform-grants.spec.ts` proves the translation and `permission-checker.spec.ts` proves the
 * match. What only this suite can prove is the property the whole contract rests on: **a permission
 * never implies a membership** (ADR-0076, ADR-0032). The two are resolved from different facts — one
 * from a signed claim, one from a row this product wrote — and a caller needs both. A token granting
 * every permission in Work still does nothing for somebody no tenant has admitted.
 */

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const PLATFORM_USER = 'platform-user-11';

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

const vouchingFor = (claims: Record<string, unknown>): AccessTokenVerifier => ({
  verifyAccessToken: () => ({
    sub: PLATFORM_USER,
    iss: 'https://identity.example.com',
    iat: 1_780_000_000,
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

interface Outcome {
  readonly tenantId: string | undefined;
  readonly allowed: boolean;
}

/** Runs a request and reports the tenant it acted in and whether the permission was held. */
const request = async (
  middleware: TenantMiddleware,
  permission: string,
  headers: Record<string, string>,
): Promise<Outcome> => {
  let outcome: Outcome = { tenantId: undefined, allowed: false };

  await middleware.use(requestWith(headers), response, () => {
    const context = currentContext();
    const tenantId = context !== undefined && !('system' in context) ? context.tenantId : undefined;

    void new PlatformPermissionChecker().holds(permission).then((allowed) => {
      outcome = { tenantId, allowed };
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  return outcome;
};

const AUTHORIZED = { authorization: 'Bearer a-genuine-platform-token' };
const GRANTED = { perms: ['work:payroll:read', 'work:leave:read'] };

describe('a granted permission, in a tenant the caller belongs to', () => {
  it('is held', async () => {
    const middleware = middlewareFor(GRANTED, directoryWith(membershipOf(TENANT_A)));

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: TENANT_A,
      allowed: true,
    });
  });

  it('does not extend to a permission the token did not grant', async () => {
    const middleware = middlewareFor(GRANTED, directoryWith(membershipOf(TENANT_A)));

    expect((await request(middleware, 'payroll.finalize', AUTHORIZED)).allowed).toBe(false);
  });
});

describe('a permission never implies a membership', () => {
  it('grants nothing to somebody no tenant has admitted', async () => {
    // Every Work permission in the token, and not one tenant. The request resolves no context, so
    // there is nothing to be authorized *in*.
    const everything = {
      perms: ['work:payroll:read', 'work:leave:read', 'work:assets:asset:read'],
    };
    const middleware = middlewareFor(everything, directoryWith());

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: undefined,
      allowed: false,
    });
  });

  it('grants nothing when the caller names a tenant they are not a member of', async () => {
    const middleware = middlewareFor(GRANTED, directoryWith(membershipOf(TENANT_A)));

    expect(
      await request(middleware, 'payroll.read', { ...AUTHORIZED, [TENANT_HEADER]: TENANT_B }),
    ).toEqual({ tenantId: undefined, allowed: false });
  });

  it('grants nothing when the membership set is ambiguous and unnarrowed', async () => {
    const middleware = middlewareFor(
      GRANTED,
      directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
    );

    expect((await request(middleware, 'payroll.read', AUTHORIZED)).allowed).toBe(false);
  });

  it('holds the permission in whichever of their tenants the caller legitimately named', async () => {
    const middleware = middlewareFor(
      GRANTED,
      directoryWith(membershipOf(TENANT_A), membershipOf(TENANT_B)),
    );

    expect(
      await request(middleware, 'payroll.read', { ...AUTHORIZED, [TENANT_HEADER]: TENANT_B }),
    ).toEqual({ tenantId: TENANT_B, allowed: true });
  });
});

describe('the token tenant claim, alongside grants', () => {
  it('still does not select the tenant', async () => {
    const middleware = middlewareFor(
      { ...GRANTED, tid: TENANT_B },
      directoryWith(membershipOf(TENANT_A)),
    );

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: TENANT_A,
      allowed: true,
    });
  });

  it('cannot pair with a grant to reach a tenant the caller is not a member of', async () => {
    const middleware = middlewareFor({ ...GRANTED, tid: TENANT_B }, directoryWith());

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: undefined,
      allowed: false,
    });
  });
});

describe('what a token cannot confer', () => {
  it.each([
    ['a wildcard over everything', ['*']],
    ['a wildcard over Work', ['work:*']],
    ['a wildcard over the module', ['work:payroll:*']],
    ["another product's grant", ['docs:payroll:read']],
    ['a Platform administrator role', ['users:*', 'roles:*', 'tenant:*']],
    ['an undeclared permission', ['work:payroll:delete']],
    ['no grants at all', []],
    ['a malformed claim', 'work:payroll:read'],
  ])('%s', async (_description, perms) => {
    const middleware = middlewareFor({ perms }, directoryWith(membershipOf(TENANT_A)));
    const outcome = await request(middleware, 'payroll.read', AUTHORIZED);

    // The caller is a properly resolved member of tenant A throughout — the tenant is established
    // and the authorization is refused, which is the pair of answers that proves the two are
    // decided separately.
    expect(outcome).toEqual({ tenantId: TENANT_A, allowed: false });
  });

  it('grants nothing when the claim is absent entirely', async () => {
    const middleware = middlewareFor({}, directoryWith(membershipOf(TENANT_A)));

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: TENANT_A,
      allowed: false,
    });
  });
});

describe('a request the verifier refuses', () => {
  it('holds nothing, however generous the grants would have been', async () => {
    const middleware = new TenantMiddleware(
      new PlatformTokenAuthenticationPort({
        verifyAccessToken: () => {
          throw new Error('invalid signature');
        },
      }),
      directoryWith(membershipOf(TENANT_A)),
    );

    expect(await request(middleware, 'payroll.read', AUTHORIZED)).toEqual({
      tenantId: undefined,
      allowed: false,
    });
  });
});
