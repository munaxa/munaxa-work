import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { authenticationFor } from './platform-authentication.js';
import {
  AUDIENCE,
  CURRENT_KID,
  FOREIGN_KID,
  ISSUER,
  MEMBER,
  PREVIOUS_KID,
  personBehind,
  platformUserFor,
  securityEnvironment,
  tokenFor,
} from './security.fixture.js';

/**
 * The relying-party adapter, against tokens a real issuer would mint and tokens an attacker would.
 *
 * Real RSA keys and real signatures throughout: nothing here asserts that a stub returned false.
 * The negative cases are the point — a verifier is only as good as what it refuses — and each one
 * differs from the accepted token in exactly one respect, so a failure names the check that broke.
 */

const adapter = () => {
  const port = authenticationFor(securityEnvironment());

  if (port === undefined) throw new Error('The fixture configured no issuer.');
  return port;
};

const bearer = (value: string) => ({ scheme: 'Bearer', value });

describe('the Platform authentication adapter', () => {
  it('authenticates a token the issuer signed with the key in force', async () => {
    const principal = await adapter().authenticate(bearer(tokenFor(MEMBER)));

    expect(principal?.platformUserId).toBe(platformUserFor(personBehind(MEMBER)));
    expect(principal?.issuer).toBe(ISSUER);
  });

  it('still authenticates a token signed with the previous key during a rotation overlap', async () => {
    const token = tokenFor(MEMBER, { kid: PREVIOUS_KID });

    expect((await adapter().authenticate(bearer(token)))?.platformUserId).toBe(
      platformUserFor(personBehind(MEMBER)),
    );
  });

  it('carries the issuer’s tenant claim as an assertion, never as a tenant', async () => {
    const token = tokenFor(MEMBER, { tenantId: '01930000-0000-7000-8000-0000000055ee' });
    const principal = await adapter().authenticate(bearer(token));

    expect(principal?.tenantAssertion).toBe('01930000-0000-7000-8000-0000000055ee');
  });

  it('authenticates nobody when no credential is presented', async () => {
    expect(await adapter().authenticate(undefined)).toBeUndefined();
  });

  it('refuses a scheme that is not Bearer', async () => {
    const token = tokenFor(MEMBER);

    expect(await adapter().authenticate({ scheme: 'Basic', value: token })).toBeUndefined();
  });

  it('refuses a malformed token', async () => {
    expect(await adapter().authenticate(bearer('not.a.token'))).toBeUndefined();
    expect(await adapter().authenticate(bearer(''))).toBeUndefined();
    expect(await adapter().authenticate(bearer('one-segment'))).toBeUndefined();
  });

  it('refuses a token signed by a key this deployment was never given', async () => {
    const token = tokenFor(MEMBER, { kid: FOREIGN_KID });

    expect(await adapter().authenticate(bearer(token))).toBeUndefined();
  });

  it('refuses a token whose signature has been altered', async () => {
    const [header, payload, signature] = tokenFor(MEMBER).split('.') as [string, string, string];
    const flipped = `${signature.slice(0, -2)}${signature.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(await adapter().authenticate(bearer(`${header}.${payload}.${flipped}`))).toBeUndefined();
  });

  it('refuses a token whose payload has been altered under a valid signature', async () => {
    const [header, , signature] = tokenFor(MEMBER).split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({
        sub: 'platform:somebody-else',
        iss: ISSUER,
        aud: [AUDIENCE],
        iat: Math.floor(Date.now() / 1_000),
        exp: Math.floor(Date.now() / 1_000) + 600,
        jti: 'forged',
        ver: 1,
      }),
    ).toString('base64url');

    expect(
      await adapter().authenticate(bearer(`${header}.${forged}.${signature}`)),
    ).toBeUndefined();
  });

  it('refuses a wrong issuer, even correctly signed', async () => {
    const token = tokenFor(MEMBER, { issuer: 'https://elsewhere.invalid' });

    expect(await adapter().authenticate(bearer(token))).toBeUndefined();
  });

  it('refuses a token minted for another product’s audience', async () => {
    const token = tokenFor(MEMBER, { audience: 'munaxa-somewhere-else' });

    expect(await adapter().authenticate(bearer(token))).toBeUndefined();
  });

  it('refuses an expired token', async () => {
    // Beyond the clock skew the configuration allows, so this is expiry and not drift.
    const token = tokenFor(MEMBER, { ttl: -120_000 });

    expect(await adapter().authenticate(bearer(token))).toBeUndefined();
  });

  it('refuses `alg: none`', async () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT', kid: CURRENT_KID }),
    ).toString('base64url');
    const [, payload] = tokenFor(MEMBER).split('.') as [string, string, string];

    expect(await adapter().authenticate(bearer(`${header}.${payload}.`))).toBeUndefined();
  });

  it('refuses an HMAC token that claims the verification key as its secret', async () => {
    // Algorithm confusion: the public key is public, so a verifier that trusted the header's `alg`
    // would accept a token anybody could mint. The signer's own algorithm is used instead.
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: CURRENT_KID }),
    ).toString('base64url');
    const [, payload] = tokenFor(MEMBER).split('.') as [string, string, string];
    const [key] = securityEnvironment().AUTH_PUBLIC_KEYS ?? [];
    const signature = createHmac('sha256', key?.publicKey ?? '')
      .update(`${header}.${payload}`)
      .digest('base64url');

    expect(
      await adapter().authenticate(bearer(`${header}.${payload}.${signature}`)),
    ).toBeUndefined();
  });

  it('refuses a token that identifies nobody', async () => {
    for (const subject of ['', '   ']) {
      expect(await adapter().authenticate(bearer(tokenFor(MEMBER, { subject })))).toBeUndefined();
    }
  });
});

describe('an unconfigured deployment', () => {
  it('builds no adapter, so the composition root keeps the one that authenticates nobody', () => {
    const { AUTH_ISSUER: _issuer, ...withoutIssuer } = securityEnvironment();

    expect(authenticationFor(withoutIssuer)).toBeUndefined();
  });
});
