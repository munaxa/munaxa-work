import type { PlatformPrincipal } from '@work/kernel';

import type { ResolvedMembership } from '../contracts/membership-directory.js';

/**
 * What the request pipeline has established about the caller by the time a controller runs.
 *
 * Both fields are set by the API's identity middleware and by nothing else. A controller reads
 * them; it never derives them, and there is no path by which a request body or a header can
 * write to them. That is the whole shape of the fix to the tenant-header debt: the caller's
 * claims go in one direction, and these two facts come from the other.
 */
export interface IdentityRequestContext {
  /** Who Platform vouched for. Absent means unauthenticated, and the guard has refused already. */
  principal?: PlatformPrincipal;
  /** Which tenant they are acting in, resolved from a stored membership — never from a header. */
  membership?: ResolvedMembership;
}

/** The Express request, once the middleware has run. Declared rather than globally augmented:
 *  the augmentation would claim every request in the process carries these, which is only true
 *  downstream of the middleware. */
export type AuthenticatedRequest = IdentityRequestContext & { readonly originalUrl: string };
