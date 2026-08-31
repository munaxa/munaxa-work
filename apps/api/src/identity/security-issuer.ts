import { generateKeyPairSync, type KeyPairSyncResult } from 'node:crypto';

import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';
import { unsafeId, type TenantId } from '@munaxa/types';
import { loadEnvironment, type Environment } from '@work/config';

import { personBehind, platformUserFor } from './security-world.js';

/**
 * The issuer's side of the boundary, which exists only in tests.
 *
 * Munaxa Work holds no signing key by design, so a suite that wants a valid token has to mint one.
 * The keys are generated in memory here and Work is configured with the **public** half — exactly
 * the relationship it has with the real issuer, which is what makes the verification path under
 * test the deployed one rather than a test-only branch.
 */

export const ISSUER = 'https://issuer.test.munaxa.invalid';
export const AUDIENCE = 'munaxa-work-test';
/** The signing key in force, and the one still being verified through a rotation overlap. */
export const CURRENT_KID = 'current';
export const PREVIOUS_KID = 'previous';
/** A key the deployment was never given. Its `kid` is the one an unknown-key token carries. */
export const FOREIGN_KID = 'foreign';

const rsa = (): KeyPairSyncResult<string, string> =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

const CURRENT = rsa();
const PREVIOUS = rsa();
const FOREIGN = rsa();

/**
 * The issuer's side. It exists only here, and it holds the private keys Work never sees.
 *
 * Three signers rather than one, because rotation and forgery are different questions: the first
 * two are keys this deployment was told about and the third is not, so a token from `foreign`
 * fails at the signature rather than at any check Work wrote itself.
 */
const signerFor = (kid: string, keys: KeyPairSyncResult<string, string>): TokenService =>
  new TokenService({
    signer: new AsymmetricSigner('RS256', [
      { kid, privateKey: keys.privateKey, publicKey: keys.publicKey },
    ]),
    issuer: ISSUER,
    audience: [AUDIENCE],
  });

const issuers: Readonly<Record<string, TokenService>> = {
  [CURRENT_KID]: signerFor(CURRENT_KID, CURRENT),
  [PREVIOUS_KID]: signerFor(PREVIOUS_KID, PREVIOUS),
  [FOREIGN_KID]: signerFor(FOREIGN_KID, FOREIGN),
};

export interface TokenOptions {
  readonly subject?: string;
  readonly tenantId?: string;
  readonly kid?: string;
  readonly issuer?: string;
  readonly audience?: string;
  readonly ttl?: number;
}

/**
 * Mints a token the way the issuer would.
 *
 * `issuer` and `audience` are overridable so a suite can produce a token that is *correctly
 * signed by a key Work trusts* and still wrong — which is the only interesting version of those
 * two tests. A token that fails the signature would fail them for the wrong reason.
 */
export const tokenFor = (membershipId: string, options: TokenOptions = {}): string => {
  const kid = options.kid ?? CURRENT_KID;
  const service =
    options.issuer === undefined && options.audience === undefined
      ? (issuers[kid] as TokenService)
      : new TokenService({
          signer: new AsymmetricSigner('RS256', [
            {
              kid,
              privateKey: keysFor(kid).privateKey,
              publicKey: keysFor(kid).publicKey,
            },
          ]),
          issuer: options.issuer ?? ISSUER,
          audience: [options.audience ?? AUDIENCE],
        });

  return service.issueAccessToken({
    subject: options.subject ?? platformUserFor(personBehind(membershipId)),
    tenantId: unsafeId<TenantId>(options.tenantId ?? ''),
    tokenVersion: 1,
    ...(options.ttl === undefined ? {} : { ttl: options.ttl }),
  }).token;
};

const keysFor = (kid: string): KeyPairSyncResult<string, string> => {
  if (kid === PREVIOUS_KID) return PREVIOUS;
  if (kid === FOREIGN_KID) return FOREIGN;
  return CURRENT;
};

/**
 * The environment a configured deployment has, holding **public** keys only.
 *
 * Both the current and the previous `kid` are present, which is what a rotation overlap looks
 * like from the verifier's side: the issuer has moved on, and tokens signed before it moved are
 * still in flight and still valid.
 */
export const securityEnvironment = (): Environment =>
  loadEnvironment({
    APP_NAME: 'munaxa-work-test',
    APP_VERSION: '0.0.0-test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
    AUTH_ISSUER: ISSUER,
    AUTH_AUDIENCE: AUDIENCE,
    AUTH_PUBLIC_KEYS: JSON.stringify([
      { kid: CURRENT_KID, publicKey: CURRENT.publicKey },
      { kid: PREVIOUS_KID, publicKey: PREVIOUS.publicKey },
    ]),
  });
