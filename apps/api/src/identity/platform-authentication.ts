import { TokenService } from '@munaxa/auth';
import { AsymmetricSigner } from '@munaxa/crypto';
import type { Environment } from '@work/config';
import type {
  PlatformAuthenticationPort,
  PlatformPrincipal,
  PresentedCredentials,
} from '@work/kernel';

/**
 * The relying-party adapter: what Platform's implementation of `AUTHENTICATION_PORT` actually is
 * in a deployment that has one.
 *
 * Munaxa Work is a verifier and nothing else. It holds no signing key, mints no token, stores no
 * credential and runs no login screen — it is handed a token somebody else issued and answers one
 * question about it. That is the whole of ADR-0001 expressed as code, and it is why this file
 * contains no branch on an environment name and no path that produces a principal without a
 * signature behind it.
 *
 * **Verification is Platform's, not this file's.** `TokenService.verifyAccessToken` checks the
 * signature, the algorithm, the expiry, the issued-at, the issuer and the audience, and it checks
 * the algorithm against the *signer's* rather than against the token header's claim about itself —
 * which is what closes the `alg: none` and algorithm-confusion families. Re-implementing any of
 * that here would be Munaxa Work owning authentication after all.
 *
 * **What this adapter adds is the two things Platform cannot know.** That only a `Bearer`
 * credential is accepted, and that a subject has to be a usable identifier: a token whose `sub` is
 * empty or absent verifies perfectly and identifies nobody, and `platformUserId` is the key every
 * other row in this product hangs off (AD-004).
 *
 * **It fails closed, and it fails quietly.** Every rejection returns `undefined` — the ordinary
 * outcome the port is shaped for — and nothing about the presented credential is logged or
 * returned. A verifier that explained *why* a token was refused would be an oracle for anybody
 * probing it, and a verifier that logged the token would put a live credential in a log file.
 */
export class PlatformTokenAuthentication implements PlatformAuthenticationPort {
  public constructor(private readonly tokens: TokenService) {}

  public authenticate(
    credentials: PresentedCredentials | undefined,
  ): Promise<PlatformPrincipal | undefined> {
    return Promise.resolve(this.principalFrom(credentials));
  }

  private principalFrom(
    credentials: PresentedCredentials | undefined,
  ): PlatformPrincipal | undefined {
    // Only the Authorization header, and only `Bearer`. A token in a query string ends up in
    // access logs, `Referer` headers and browser history; the middleware never offers one here,
    // and a scheme this adapter does not know is refused rather than guessed at.
    if (credentials === undefined || credentials.scheme.toLowerCase() !== 'bearer') {
      return undefined;
    }

    try {
      const claims = this.tokens.verifyAccessToken(credentials.value);
      const subject = typeof claims.sub === 'string' ? claims.sub.trim() : '';

      if (subject === '') return undefined;

      return {
        platformUserId: subject,
        issuer: claims.iss,
        // `tid` travels as an assertion to be checked against the membership this request
        // resolves, never as the tenant itself. See `PlatformPrincipal.tenantAssertion`.
        ...(typeof claims.tid === 'string' && claims.tid !== ''
          ? { tenantAssertion: claims.tid }
          : {}),
        authenticatedAt: new Date(),
      };
    } catch {
      // Malformed, unsigned, expired, wrong issuer, wrong audience, unknown key: all of them are
      // "not authenticated", and telling them apart is the caller's problem, not ours.
      return undefined;
    }
  }
}

/**
 * Builds the adapter from validated configuration, or returns nothing.
 *
 * Returning `undefined` rather than throwing is what makes an unconfigured deployment safe
 * instead of broken: the composition root keeps `UnauthenticatedPort`, every business request
 * answers 401, and the mistake is visible on the first request. Configuration itself refuses a
 * half-configured relying party and refuses an unconfigured production deployment, so the only
 * way to reach this returning `undefined` is a development checkout that has not been given an
 * issuer — which is exactly the checkout that should authenticate nobody.
 *
 * The signer is constructed from public keys only. `AsymmetricSigner` can sign when a private key
 * is present; none is, so this process is structurally incapable of minting a token it would then
 * accept. More than one key is the rotation mechanism rather than an edge case — during an
 * overlap the issuer signs with the new `kid` while tokens carrying the old one are still valid,
 * and `verify` selects by the `kid` in the token header.
 */
export const authenticationFor = (
  environment: Environment,
): PlatformAuthenticationPort | undefined => {
  const { AUTH_ISSUER: issuer, AUTH_AUDIENCE: audience, AUTH_PUBLIC_KEYS: keys } = environment;

  if (issuer === undefined || audience === undefined || keys === undefined) return undefined;

  const signer = new AsymmetricSigner(
    environment.AUTH_SIGNING_ALGORITHM,
    keys.map((key) => ({ kid: key.kid, publicKey: key.publicKey })),
  );

  return new PlatformTokenAuthentication(
    new TokenService({
      signer,
      issuer,
      audience: [audience],
      clockSkew: environment.AUTH_CLOCK_SKEW_MS,
    }),
  );
};
