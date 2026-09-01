import { AsymmetricSigner } from '@munaxa/crypto';
import { TokenService } from '@munaxa/auth';
import { platformAuthenticationFrom } from '@work/config';
import type { Environment, PlatformAuthenticationConfiguration } from '@work/config';
import { UnauthenticatedPort, type PlatformAuthenticationPort } from '@work/kernel';

import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from './platform-token-authentication.js';
import type { DroppedGrant } from './platform-grants.js';

/**
 * Which authentication port this deployment runs with, decided from its configuration alone.
 *
 * ```
 * no Platform authentication configuration   →  UnauthenticatedPort        →  401 to everything
 * a complete one                             →  PlatformTokenAuthenticationPort
 * a partial one                              →  startup already refused, in packages/config
 * ```
 *
 * The third row is why this function has only two branches: `loadEnvironment` will not return a
 * partly-configured environment, so there is no state here in which the deployment believes it
 * is verifying tokens and is not. That check lives with the configuration rather than here
 * because it is a statement about the environment, and because a rule enforced at the point of
 * use is a rule that a second point of use can forget.
 */
export type AccessTokenVerifierFactory = (
  configuration: PlatformAuthenticationConfiguration,
) => AccessTokenVerifier;

/**
 * Builds Platform's verifier from the configured issuer, audience, algorithm and keys.
 *
 * **This is the only expression in Munaxa Work that constructs `@munaxa/auth`'s `TokenService`,
 * and it is deliberately the only one.** Everything above it is written against
 * `AccessTokenVerifier`, which `TokenService` satisfies structurally, so the whole of Work's
 * dependency on Platform's token implementation is this function.
 *
 * Two properties are worth stating because they are the reason this is Platform's code and not
 * ours. The algorithm used to verify comes from the *signer*, never from the token header, so the
 * `alg: none` and algorithm-confusion families of attack fail here rather than being defended
 * against. And `AsymmetricSigner` is constructed with public keys only — Work holds no private
 * half of anything and could not mint a token it would accept, which is what makes ADR-0001's
 * "Platform owns authentication" a structural fact rather than an intention.
 *
 * The key ring is the whole configured set, keyed by `kid`, so a rotation is a deployment that
 * carries two public keys and no coordination window at all.
 */
export const platformAccessTokenVerifier: AccessTokenVerifierFactory = (configuration) =>
  new TokenService({
    signer: new AsymmetricSigner(
      configuration.algorithm,
      configuration.keys.map((key) => ({ kid: key.kid, publicKey: key.publicKey })),
    ),
    issuer: configuration.issuer,
    audience: configuration.audience,
    clockSkew: configuration.clockSkewMs,
  });

/**
 * Chooses the port. Deterministic, total, and dependent on nothing but the environment.
 *
 * `createVerifier` is a parameter so the selection can be proved without the Platform package
 * present — the branch that matters is *which port is chosen*, and a test that could not reach
 * the configured branch would leave the more important of the two unproved.
 *
 * `onDroppedGrant` is where a grant that conferred nothing is reported (ADR-0076). An operator who
 * granted `work:*` and saw no effect has one question, and it deserves an answer in the log rather
 * than an afternoon.
 */
export const authenticationPortFor = (
  environment: Environment,
  createVerifier: AccessTokenVerifierFactory = platformAccessTokenVerifier,
  onDroppedGrant?: (dropped: DroppedGrant) => void,
): PlatformAuthenticationPort => {
  const configuration = platformAuthenticationFrom(environment);

  return configuration === undefined
    ? new UnauthenticatedPort()
    : new PlatformTokenAuthenticationPort(createVerifier(configuration), onDroppedGrant);
};
