import type {
  PlatformAuthenticationPort,
  PlatformPrincipal,
  PresentedCredentials,
} from '@work/kernel';

import { workGrantsFrom, type DroppedGrant } from './platform-grants.js';
import { SESSION_STATUS_UNCHECKED, type SessionStatus } from './session-revocation.js';
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
 * What this file *is* responsible for is the decisions the seam owns:
 *
 * - **Only a bearer credential is considered.** Anything else is not a token this can verify.
 * - **Failure is `undefined`, never an exception.** "Not authenticated" is an ordinary outcome
 *   of an ordinary request; the middleware then establishes no context and the guard answers
 *   401. A throw here would turn every unauthenticated request into a 500.
 * - **The token's organisation claim is a filter, never a selector.** See `principalFrom`.
 * - **The session must still be live.** A verified token is also checked against Identity's
 *   session state (`SessionStatus`, WK-02), so signing out, revoking a session, a password reset
 *   or a lockdown ends Work access within the configured window rather than at token expiry.
 * - **The grant claim is translated, never trusted verbatim.** See `platform-grants.ts`.
 * - **Nothing about the token reaches a log or an error.** A token in a log is a credential in
 *   a log, and it stays valid until it expires.
 */

/**
 * The claims this product reads, and the whole of what it reads.
 *
 * Narrower than Platform's `AccessTokenClaims`, which also carries `scope` and `roles`. A field
 * this interface does not declare is a field this repository cannot accidentally start trusting.
 *
 * `tid` is declared since ADR-0080, and what it may be used for is the contract. The grants in
 * `perms` were computed in the organisation `tid` names, so `tid` is what binds them: resolution
 * returns only memberships of the Work tenant bound to that organisation. It still never chooses a
 * tenant on its own — the tenant is Work's own, from a stored membership (ADR-0032) — so a `tid`
 * that is not bound to any Work tenant resolves nobody rather than somebody.
 *
 * `sid` is what revocation is decided against, and `exp` bounds how long any answer about it is
 * kept. `amr` and `mfa` are carried on the principal unchanged.
 *
 * `TokenService` satisfies this structurally, so the composition root hands one over directly —
 * no wrapper, no mapping layer, nothing to drift.
 */
export interface VerifiedAccessToken {
  /** Platform's stable subject. Immutable for the life of the account (AD-004). */
  readonly sub: string;
  readonly iss: string;
  /** Seconds since the epoch, as JWT states them. */
  readonly iat: number;
  /** Seconds since the epoch. Platform's verifier has already refused an expired token. */
  readonly exp?: unknown;
  /** The Platform organisation the token, and its grants, were issued for. */
  readonly tid?: unknown;
  /** The Platform session the token belongs to. */
  readonly sid?: unknown;
  readonly amr?: unknown;
  readonly mfa?: unknown;
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
 * **`tid` is carried as the organisation the grants belong to, never as a Work tenant.** Work's
 * tenant comes from `tenant_membership` rows this product wrote when a tenant admitted a person,
 * and from nowhere else (ADR-0032). What `tid` adds (ADR-0080) is a restriction: only the Work
 * tenant bound to that organisation is eligible, so a payroll administrator's grants in one
 * organisation cannot follow them into another Work tenant where they are an ordinary member
 * (WK-01). A token without `tid`, or without `sid`, `exp`, is not a principal at all.
 *
 * **`email` is left absent.** Platform's `UserPrincipal` publishes no email claim, and the
 * field is optional on `PlatformPrincipal` for exactly this reason. Reading some other claim
 * that looks like an address, or deriving one from `sub`, would put an unverified identifier
 * where invitation acceptance checks an authenticated one.
 */
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Every claim Identity always issues and Work relies on. Missing any one, it is no principal. */
const hasRequiredClaims = (
  claims: VerifiedAccessToken,
): claims is VerifiedAccessToken & {
  sub: string;
  iss: string;
  iat: number;
  exp: number;
  tid: string;
  sid: string;
} =>
  isNonEmptyString(claims.sub) &&
  isNonEmptyString(claims.iss) &&
  isFiniteNumber(claims.iat) &&
  isFiniteNumber(claims.exp) &&
  isNonEmptyString(claims.tid) &&
  isNonEmptyString(claims.sid);

/** `amr` and `mfa` as Identity issued them; a malformed one is left out rather than guessed. */
const assuranceOf = (
  claims: VerifiedAccessToken,
): Pick<PlatformPrincipal, 'authenticationMethods' | 'mfaSatisfied'> => ({
  ...(Array.isArray(claims.amr)
    ? {
        authenticationMethods: claims.amr.filter(
          (method): method is string => typeof method === 'string',
        ),
      }
    : {}),
  ...(typeof claims.mfa === 'boolean' ? { mfaSatisfied: claims.mfa } : {}),
});

const principalFrom = (
  claims: VerifiedAccessToken,
  onDropped?: (dropped: DroppedGrant) => void,
): PlatformPrincipal | undefined => {
  if (!hasRequiredClaims(claims)) return undefined;

  return {
    platformUserId: claims.sub,
    issuer: claims.iss,
    platformTenantId: claims.tid,
    sessionId: claims.sid,
    ...assuranceOf(claims),
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
  /**
   * `sessions` is the revocation check (WK-02). It is required in effect — the composition root
   * always supplies Identity's — and defaults to "unchecked" only so a unit test of the claim
   * mapping does not have to stand up an Identity.
   */
  public constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly onDropped?: (dropped: DroppedGrant) => void,
    private readonly sessions: SessionStatus = SESSION_STATUS_UNCHECKED,
  ) {}

  /**
   * Verify locally first, then ask whether the session still stands. The order matters: nothing
   * is sent to Identity for a token that is forged, expired, for another audience or missing a
   * claim, so the network is never a way to probe with arbitrary strings.
   */
  public async authenticate(
    credentials: PresentedCredentials | undefined,
  ): Promise<PlatformPrincipal | undefined> {
    const verified = this.verified(credentials);
    if (verified === undefined) return undefined;

    const { token, claims, principal } = verified;
    let active: boolean;
    try {
      active = await this.sessions.isActive(token, {
        sub: principal.platformUserId,
        tid: principal.platformTenantId ?? '',
        sid: principal.sessionId ?? '',
        exp: claims.exp as number,
      });
    } catch {
      // A revocation check that cannot answer refuses. Never "assume still signed in".
      return undefined;
    }
    return active ? principal : undefined;
  }

  private verified(credentials: PresentedCredentials | undefined):
    | {
        readonly token: string;
        readonly claims: VerifiedAccessToken;
        readonly principal: PlatformPrincipal;
      }
    | undefined {
    if (credentials === undefined) return undefined;
    if (credentials.scheme.toLowerCase() !== BEARER) return undefined;

    const token = credentials.value.trim();

    if (token === '') return undefined;

    try {
      const claims = this.verifier.verifyAccessToken(token);
      const principal = principalFrom(claims, this.onDropped);
      return principal === undefined ? undefined : { token, claims, principal };
    } catch {
      // Swallowed on purpose, and this is the one place it is right to. Platform's verifier
      // distinguishes an expired token from a forged one, and surfacing that distinction would
      // tell an attacker which of the two they hold. The error also quotes nothing, because
      // anything it quoted would be the credential.
      return undefined;
    }
  }
}
