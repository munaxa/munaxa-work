import { ConfigurationError, platformAuthenticationFrom } from '@work/config';
import type { Environment, PlatformAuthenticationConfiguration } from '@work/config';
import { UnauthenticatedPort, type PlatformAuthenticationPort } from '@work/kernel';

import {
  PlatformTokenAuthenticationPort,
  type AccessTokenVerifier,
} from './platform-token-authentication.js';

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
 * **This is the only expression in Munaxa Work that would construct `@munaxa/auth`'s
 * `TokenService`, and it is deliberately the only one.** Everything above it is written against
 * `AccessTokenVerifier`, which `TokenService` satisfies structurally, so wiring the real
 * implementation is a change to this function and to nothing else.
 *
 * It refuses today because `@munaxa/auth` is published to GitHub Packages and cannot be
 * installed by this repository yet (Phase 1, section C). The refusal is the correct behaviour
 * rather than a placeholder for one: a deployment that supplied Platform's issuer and keys has
 * asked for verified authentication, and the two alternatives to stopping are both worse.
 * Falling back to `UnauthenticatedPort` would answer 401 to everybody while the operator
 * believed authentication was live. Verifying with a JWT library chosen here would put token
 * verification — and therefore authentication — inside this product, which ADR-0001 forbids and
 * which no amount of care would make correct.
 */
export const platformAccessTokenVerifier: AccessTokenVerifierFactory = () => {
  throw new ConfigurationError([
    'Platform authentication is configured, but no verifier is wired. Munaxa Work verifies tokens with Platform\'s own implementation and must not implement its own (ADR-0001): add "@munaxa/auth" to apps/api and construct its TokenService in platformAccessTokenVerifier. Until then, leave PLATFORM_AUTH_* unset to run with UnauthenticatedPort.',
  ]);
};

/**
 * Chooses the port. Deterministic, total, and dependent on nothing but the environment.
 *
 * `createVerifier` is a parameter so the selection can be proved without the Platform package
 * present — the branch that matters is *which port is chosen*, and a test that could not reach
 * the configured branch would leave the more important of the two unproved.
 */
export const authenticationPortFor = (
  environment: Environment,
  createVerifier: AccessTokenVerifierFactory = platformAccessTokenVerifier,
): PlatformAuthenticationPort => {
  const configuration = platformAuthenticationFrom(environment);

  return configuration === undefined
    ? new UnauthenticatedPort()
    : new PlatformTokenAuthenticationPort(createVerifier(configuration));
};
