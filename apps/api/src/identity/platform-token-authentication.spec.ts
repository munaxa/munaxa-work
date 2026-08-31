import { describe, expect, it } from 'vitest';

import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
  type VerifiedAccessToken,
} from './platform-token-authentication.js';

/**
 * The adapter's own half of the seam.
 *
 * The verifier is a double throughout, and deliberately so: signature, expiry, issuer, audience,
 * algorithm and `kid` selection are Platform's `TokenService` to enforce and Platform's suite to
 * prove, and re-testing them here would only prove that a second implementation agrees with
 * itself. What is Work's — and what these tests are for — is everything around the call: which
 * credentials are even offered to the verifier, what a rejection turns into, and which claims
 * are allowed to reach the principal.
 *
 * Each negative case below is expressed as the verifier throwing, because that is exactly what
 * `TokenService.verifyAccessToken` does for every one of them: a `PlatformError` with no
 * distinction the caller is meant to act on.
 */

const CLAIMS: VerifiedAccessToken = {
  sub: 'platform-user-7',
  iss: 'https://identity.example.com',
  iat: 1_780_000_000,
};

const verifying = (claims: VerifiedAccessToken): AccessTokenVerifier => ({
  verifyAccessToken: () => claims,
});

const refusing = (reason: string): AccessTokenVerifier => ({
  verifyAccessToken: () => {
    throw new Error(reason);
  },
});

/** What the tenant middleware hands the port, for the header it was given. */
const bearer = (value: string): { scheme: string; value: string } => ({ scheme: 'Bearer', value });

describe('a token Platform vouched for', () => {
  it('becomes a principal carrying the subject, the issuer and the moment of authentication', async () => {
    const port = new PlatformTokenAuthenticationPort(verifying(CLAIMS));

    expect(await port.authenticate(bearer('a-token'))).toEqual({
      platformUserId: 'platform-user-7',
      issuer: 'https://identity.example.com',
      authenticatedAt: new Date(1_780_000_000_000),
    });
  });

  it('reads `iat` as seconds, as JWT states it, not as milliseconds', async () => {
    const port = new PlatformTokenAuthenticationPort(verifying({ ...CLAIMS, iat: 1_780_000_001 }));
    const principal = await port.authenticate(bearer('a-token'));

    expect(principal?.authenticatedAt.toISOString()).toBe(
      new Date(1_780_000_001_000).toISOString(),
    );
  });

  it('accepts the scheme in whatever case the caller wrote it', async () => {
    const port = new PlatformTokenAuthenticationPort(verifying(CLAIMS));

    expect(await port.authenticate({ scheme: 'bearer', value: 'a-token' })).toBeDefined();
  });

  it('invents no email, because Platform publishes no email claim to take one from', async () => {
    const port = new PlatformTokenAuthenticationPort(verifying(CLAIMS));
    const principal = await port.authenticate(bearer('a-token'));

    expect(principal?.email).toBeUndefined();
  });
});

describe('the tenant claim', () => {
  it('is not carried onto the principal, so nothing downstream can read a tenant from a token', async () => {
    // A genuine Platform access token carries `tid`. Work's tenant comes from a stored
    // membership (ADR-0032), so the principal must offer no tenant at all — not an ignored one.
    const port = new PlatformTokenAuthenticationPort(
      verifying({ ...CLAIMS, tid: 'tenant-a' } as VerifiedAccessToken),
    );
    const principal = await port.authenticate(bearer('a-token'));

    expect(principal).toEqual({
      platformUserId: 'platform-user-7',
      issuer: 'https://identity.example.com',
      authenticatedAt: new Date(1_780_000_000_000),
    });
    expect(Object.keys(principal ?? {})).not.toContain('tid');
    expect(Object.keys(principal ?? {})).not.toContain('tenantId');
  });
});

describe('a credential this port cannot verify', () => {
  const port = new PlatformTokenAuthenticationPort(verifying(CLAIMS));

  it('authenticates nobody when no Authorization header was sent', async () => {
    expect(await port.authenticate(undefined)).toBeUndefined();
  });

  it.each(['Basic', 'Digest', 'Negotiate', 'ApiKey'])('refuses the %s scheme', async (scheme) => {
    expect(await port.authenticate({ scheme, value: 'a-value' })).toBeUndefined();
  });

  it('refuses an empty bearer value rather than offering it to the verifier', async () => {
    expect(await port.authenticate(bearer('   '))).toBeUndefined();
  });
});

describe('a token the verifier rejects', () => {
  it.each([
    'malformed token',
    'token expired',
    'Token issuer mismatch',
    'Token audience mismatch',
    'invalid signature',
    'Unknown key id k9',
    'tampered payload',
    'alg none is not accepted',
    'symmetric algorithm refused',
  ])('is nobody: %s', async (reason) => {
    const port = new PlatformTokenAuthenticationPort(refusing(reason));

    expect(await port.authenticate(bearer('a-token'))).toBeUndefined();
  });

  it('resolves rather than rejecting, so an unauthenticated request is a 401 and not a 500', async () => {
    const port = new PlatformTokenAuthenticationPort(refusing('malformed token'));

    await expect(port.authenticate(bearer('a-token'))).resolves.toBeUndefined();
  });

  it('lets nothing about the token escape, because a quoted credential is a leaked one', async () => {
    const token = 'header.payload.signature';
    const port = new PlatformTokenAuthenticationPort(refusing(`rejected ${token}`));

    // The rejection is swallowed whole. Nothing is thrown, so nothing carrying the token can
    // reach a log, an error response or a stack trace.
    await expect(port.authenticate(bearer(token))).resolves.toBeUndefined();
  });
});

describe('claims that verified but say nothing usable', () => {
  it.each([
    ['no subject', { ...CLAIMS, sub: '' }],
    ['a blank subject', { ...CLAIMS, sub: '   ' }],
    ['no issuer', { ...CLAIMS, iss: '' }],
  ])('is nobody: %s', async (_description, claims) => {
    const port = new PlatformTokenAuthenticationPort(verifying(claims));

    expect(await port.authenticate(bearer('a-token'))).toBeUndefined();
  });

  it.each([
    ['a missing subject', { iss: CLAIMS.iss, iat: CLAIMS.iat }],
    ['a subject that is not a string', { ...CLAIMS, sub: 7 }],
    ['an issued-at that is not a number', { ...CLAIMS, iat: 'yesterday' }],
    ['an issued-at that is not finite', { ...CLAIMS, iat: Number.NaN }],
  ])('is nobody: %s', async (_description, claims) => {
    // Cast at the boundary on purpose: these are the shapes a verifier could hand over if
    // Platform's claim contract ever changed, and the adapter must refuse rather than build a
    // principal whose identifier is a number.
    const port = new PlatformTokenAuthenticationPort(
      verifying(claims as unknown as VerifiedAccessToken),
    );

    expect(await port.authenticate(bearer('a-token'))).toBeUndefined();
  });
});
