/**
 * Authentication is Platform's, and this is the seam (ADR-0001).
 *
 * Munaxa Work never verifies a credential. It receives whatever the caller presented, hands it
 * to Platform's implementation of this port, and gets back either a principal or nothing. No
 * password, no token format, no signature, no key material appears anywhere in this repository,
 * which is what makes "authentication belongs to Platform" a structural fact rather than a
 * statement of intent.
 *
 * The port lives in the kernel for the same reason `EmailPort` does: it is infrastructure the
 * product depends on and does not own. It carries no business concept — a principal is "someone
 * Platform vouched for", which is true before any workforce user exists.
 */

/**
 * An authenticated Platform user.
 *
 * `platformUserId` is immutable for the life of the account (AD-004). Everything Munaxa Work
 * knows about a person hangs off it, so a Platform that reissued it would silently detach a
 * workforce identity from its employments, its delegations and its audit history.
 */
export interface PlatformPrincipal {
  readonly platformUserId: string;
  /** Which Platform deployment vouched for this principal. Recorded, never trusted blindly. */
  readonly issuer: string;
  /**
   * The address on the Platform account, when Platform supplies one.
   *
   * Present because an invitation is addressed to a person, and acceptance has to check that
   * the account which turned up is the one that was invited. It is Platform's value, not a
   * claim from the request, and it is optional because not every identity provider asserts one.
   */
  readonly email?: string;
  /**
   * The tenant the issuer asserted, when it asserts one.
   *
   * It is a **constraint, never an authority**. Munaxa Work chooses the tenant from a stored
   * membership and from nothing else (ADR-0032); this value is compared against that choice and
   * a disagreement refuses the request. Nothing reads it to *select* a tenant, because a token
   * claim that could select one would be a tenant identifier supplied by the caller wearing a
   * signature.
   */
  readonly tenantAssertion?: string;
  readonly authenticatedAt: Date;
}

/** Whatever the caller presented, verbatim. Work does not parse it; Platform does. */
export interface PresentedCredentials {
  readonly scheme: string;
  readonly value: string;
}

/**
 * Resolves presented credentials to a principal, or to nothing.
 *
 * Returning `undefined` rather than throwing is deliberate: "not authenticated" is an ordinary
 * outcome of an ordinary request, and an implementation that threw would make the caller's
 * error path the common path.
 */
export interface PlatformAuthenticationPort {
  authenticate(
    credentials: PresentedCredentials | undefined,
  ): Promise<PlatformPrincipal | undefined>;
}

/**
 * The default: it authenticates nobody.
 *
 * A product that must not implement authentication has exactly one safe default, and it is this
 * one. The application's relying-party adapter takes its place wherever an issuer is configured;
 * a deployment that configures none serves 401 to every request, which is noticed immediately.
 * The alternative default — accepting a header and believing it — is the failure this port exists
 * to make impossible.
 *
 * It remains the only implementation *in the kernel*, and that is deliberate. Verifying a
 * credential needs the platform's key handling and token contract, which are the application's
 * dependencies rather than the kernel's; a kernel that could verify a token would be a kernel with
 * an opinion about how people prove who they are.
 */
export class UnauthenticatedPort implements PlatformAuthenticationPort {
  /** The parameter is named and ignored, so the signature reads as the contract it implements. */
  public authenticate(_credentials?: PresentedCredentials): Promise<PlatformPrincipal | undefined> {
    return Promise.resolve(undefined);
  }
}
