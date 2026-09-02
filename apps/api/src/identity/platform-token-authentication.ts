import type {
  PlatformAuthenticationPort,
  PlatformPrincipal,
  PresentedCredentials,
} from '@work/kernel';

import { workGrantsFrom, type DroppedGrant } from './platform-grants.js';
import { WORK_PERMISSION_CATALOGUE } from './work-permission-catalogue.js';

/**
 * Verifying a token Platform issued, and turning it into the principal Work already understands.
 *
 * This is the adapter the `AUTHENTICATION_PORT` seam was drawn for (ADR-0001). It performs no
 * cryptography of its own: `AccessTokenVerifier` below is Platform's `TokenService`, and every
 * check that matters — signature, expiry, issuer, audience, algorithm and key selection by
 * `kid` — happens inside it, against the configuration this deployment supplied. Reimplementing
 * any of that here would be Munaxa Work owning authentication, which is the one thing it may
 * never do.
 *
 * What this file *is* responsible for is the four decisions the seam owns:
 *
 * - **Only a bearer credential is considered.** Anything else is not a token this can verify.
 * - **Failure is `undefined`, never an exception.** "Not authenticated" is an ordinary outcome
 *   of an ordinary request; the middleware then establishes no context and the guard answers
 *   401. A throw here would turn every unauthenticated request into a 500.
 * - **The token's tenant claim is discarded.** See `principalFrom`.
 * - **The grant claim is translated, never trusted verbatim.** See `platform-grants.ts`.
 * - **Nothing about the token reaches a log or an error.** A token in a log is a credential in
 *   a log, and it stays valid until it expires.
 */

/**
 * The claims this product reads, and the whole of what it reads.
 *
 * Deliberately narrower than Platform's `AccessTokenClaims`, which also carries `tid`, `sid`,
 * `scope` and `roles`. A field this interface does not declare is a field this repository cannot
 * accidentally start trusting, and `tid` is the one that matters: declaring it would put a tenant
 * chosen by the token within reach of tenant resolution.
 *
 * `perms` is declared, and `tid` still is not, and the asymmetry is the contract. Authorization is
 * Platform's to state and Work's to enforce, so the grant claim is read (ADR-0076); the tenant is
 * Work's own, resolved from a stored membership, so the tenant claim is not (ADR-0032).
 *
 * `TokenService` satisfies this structurally, so the composition root can hand one over
 * directly once `@munaxa/auth` is installable — no wrapper, no mapping layer, nothing to drift.
 */
export interface VerifiedAccessToken {
  /** Platform's stable subject. Immutable for the life of the account (AD-004). */
  readonly sub: string;
  readonly iss: string;
  /** Seconds since the epoch, as JWT states them. */
  readonly iat: number;
  /**
   * What Platform granted, in Platform's grammar — `work:assets:asset:read` (ADR-0076).
   *
   * `unknown` rather than `readonly string[]`, because this is a claim rather than a value this
   * product produced. It is covered by the signature, so it is not forged; it is still a shape
   * Work must check rather than assume, and `workGrantsFrom` answers the empty set for every
   * shape that is not a list of grants.
   */
  readonly perms?: unknown;
}

/**
 * Platform's verifier, as this repository depends on it.
 *
 * One method, and it throws on every rejection — which is Platform's contract, not a choice
 * made here. The narrowness is the point: it is the entire surface `@munaxa/auth` is consumed
 * through, so the dependency is one line in the composition root rather than a library reaching
 * into the request path.
 */
export interface AccessTokenVerifier {
  verifyAccessToken(token: string): VerifiedAccessToken;
}

const BEARER = 'bearer';

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/**
 * Maps verified claims onto Work's principal.
 *
 * **`tid` is not read, and that is the security property this function exists to hold.** A
 * Platform access token carries the tenant it was minted for, and mapping it here would make
 * the tenant a thing the caller presents — which is precisely what ADR-0032 removed when it
 * stopped believing `x-tenant-id`. Work's tenant comes from `tenant_membership` rows this
 * product wrote when a tenant admitted a person, and from nowhere else. A token that says
 * `tid: tenant-A` gets a principal with no tenant on it at all.
 *
 * **`email` is left absent.** Platform's `UserPrincipal` publishes no email claim, and the
 * field is optional on `PlatformPrincipal` for exactly this reason. Reading some other claim
 * that looks like an address, or deriving one from `sub`, would put an unverified identifier
 * where invitation acceptance checks an authenticated one.
 */
const principalFrom = (
  claims: VerifiedAccessToken,
  onDropped?: (dropped: DroppedGrant) => void,
): PlatformPrincipal | undefined => {
  if (!isNonEmptyString(claims.sub) || !isNonEmptyString(claims.iss)) return undefined;
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)) return undefined;

  return {
    platformUserId: claims.sub,
    issuer: claims.iss,
    authenticatedAt: new Date(claims.iat * 1_000),
    // Translated here rather than downstream, so that a wildcard or another product's namespace is
    // refused at the one point that still holds the raw grant — and so nothing past this line has
    // ever seen a permission name Work does not declare (ADR-0076).
    permissions: [...workGrantsFrom(claims.perms, WORK_PERMISSION_CATALOGUE, onDropped)],
  };
};

export class PlatformTokenAuthenticationPort implements PlatformAuthenticationPort {
  /**
   * `onDropped` reports a grant that conferred nothing — a wildcard, another product's namespace,
   * a permission Work does not declare. It takes the grant name and never the token: the name is
   * what an administrator typed into a role, and it is the only thing that makes the diagnostic
   * worth having.
   */
  public constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly onDropped?: (dropped: DroppedGrant) => void,
  ) {}

  public authenticate(
    credentials: PresentedCredentials | undefined,
  ): Promise<PlatformPrincipal | undefined> {
    return Promise.resolve(this.principalOf(credentials));
  }

  /**
   * Synchronous because verification is: an asymmetric signature check against a configured key
   * needs no network and no database. The port stays a promise because Platform's contract is
   * one, and because an implementation that fetched a key ring would need it.
   */
  private principalOf(
    credentials: PresentedCredentials | undefined,
  ): PlatformPrincipal | undefined {
    if (credentials === undefined) return undefined;
    if (credentials.scheme.toLowerCase() !== BEARER) return undefined;

    const token = credentials.value.trim();

    if (token === '') return undefined;

    try {
      return principalFrom(this.verifier.verifyAccessToken(token), this.onDropped);
    } catch {
      // Swallowed on purpose, and this is the one place it is right to. Platform's verifier
      // distinguishes an expired token from a forged one, and surfacing that distinction would
      // tell an attacker which of the two they hold. The error also quotes nothing, because
      // anything it quoted would be the credential.
      return undefined;
    }
  }
}
