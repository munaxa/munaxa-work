import type { ResolvedMembership, TenantMembershipDirectory } from '@work/identity';
import type { PlatformPrincipal } from '@work/kernel';

/**
 * Choosing which tenant an authenticated request acts in.
 *
 * This is the whole of the fix to the tenant-header debt, and it is worth being precise about
 * what changed, because the header did not disappear.
 *
 * **Before.** The request said `x-tenant-id: <anything>` and the application believed it. Any
 * caller could act as any tenant. There was no authenticated principal at all, and `actor` was
 * the literal string `user:anonymous`.
 *
 * **Now.** The tenant comes from `activeMemberships` — rows this product wrote when a tenant
 * admitted a person. The header survives only as a *selector among those rows*, because a person
 * genuinely may belong to several tenants (AD-005) and something has to choose. Naming a tenant
 * you are not an active member of resolves to nothing, and nothing means the request runs with
 * no tenant context, and every tenant-scoped operation then refuses.
 *
 * The distinction to hold onto: the header can no longer *grant* anything. At most it narrows a
 * set that was computed from stored facts about an authenticated person. Deleting the membership
 * lookup and trusting the header again is exactly what `tenant-resolution.spec.ts` fails on.
 */

export type TenantResolution =
  | { readonly kind: 'resolved'; readonly membership: ResolvedMembership }
  /** Authenticated, but a member of nothing. Not an error — a person between engagements. */
  | { readonly kind: 'no-membership' }
  /** They asked for a tenant they are not an active member of. Refused, never substituted. */
  | { readonly kind: 'not-a-member'; readonly requested: string }
  /** Several tenants and no choice made. Refused rather than guessed. */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly string[] };

export const resolveTenant = (
  memberships: readonly ResolvedMembership[],
  requestedTenantId: string | undefined,
): TenantResolution => {
  if (memberships.length === 0) return { kind: 'no-membership' };

  if (requestedTenantId !== undefined) {
    const chosen = memberships.find((membership) => membership.tenantId === requestedTenantId);

    return chosen === undefined
      ? { kind: 'not-a-member', requested: requestedTenantId }
      : { kind: 'resolved', membership: chosen };
  }

  const [only] = memberships;

  if (memberships.length === 1 && only !== undefined) {
    return { kind: 'resolved', membership: only };
  }

  // Picking the first would work for most people most of the time, and would put a consultant's
  // work into the wrong customer's tenant the one time it mattered. There is no safe default
  // here, so there is no default.
  return { kind: 'ambiguous', candidates: memberships.map((membership) => membership.tenantId) };
};

/**
 * Resolves in one step: authenticate, then look up, then choose.
 *
 * Kept as a function rather than folded into the middleware so the decision is testable without
 * an HTTP server, and so the middleware reads as plumbing rather than as policy.
 */
export const resolveForPrincipal = async (
  directory: TenantMembershipDirectory,
  principal: PlatformPrincipal,
  requestedTenantId: string | undefined,
): Promise<TenantResolution> =>
  resolveTenant(await directory.activeMembershipsOf(principal.platformUserId), requestedTenantId);

/**
 * The audit actor.
 *
 * The workforce user rather than the Platform account, because every other row in the product
 * references the workforce user, and an audit column that pointed at an identifier nothing else
 * uses would need a join to be readable. It is no longer `user:anonymous`.
 */
export const actorFor = (membership: ResolvedMembership): string =>
  `user:${membership.workforceUserId}`;
