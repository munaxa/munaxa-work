import type { MembershipStatus } from '../domain/identity-vocabulary.js';

/**
 * The answer to the one question every request must ask before it does anything else:
 *
 *   *This authenticated Platform user — which tenants may they act in, and as whom?*
 *
 * It is the contract that replaces the trusted `x-tenant-id` header. The distinction matters
 * and it is not subtle: a header is a claim the caller makes about themselves, and a claim a
 * caller makes about themselves is worth nothing. A membership is a fact this product stored
 * when a tenant admitted that person. Deriving the tenant from the second rather than the first
 * is the whole of the fix.
 *
 * A caller may still *name* which of their tenants they want to act in — people do belong to
 * several (AD-005) and something has to choose. But naming a tenant they are not a member of
 * resolves to nothing, and nothing means the request runs with no tenant context and every
 * tenant-scoped operation refuses.
 */

export interface ResolvedMembership {
  readonly tenantId: string;
  readonly membershipId: string;
  readonly workforceUserId: string;
  readonly platformUserId: string;
  readonly status: MembershipStatus;
}

/**
 * The Platform organisation a token was issued for, as the token states it.
 *
 * A Work tenant is bound to exactly one of these (`tenant_platform_binding`, ADR-0080), and the
 * token's grants were computed in it. That is why it is part of the question below.
 */
export interface PlatformOrganisation {
  readonly issuer: string;
  readonly tenantId: string;
}

export interface TenantMembershipDirectory {
  /**
   * The memberships this Platform user holds that permit acting now **with a token issued for
   * `organisation`**: only memberships of the Work tenant bound to that organisation are
   * returned. Suspended, invited and ended memberships are not returned either: a suspended
   * member is a member, but not one who may open a request.
   *
   * Without the organisation, the grants of one organisation would be exercised in every Work
   * tenant the person belongs to (WK-01). An unbound tenant resolves nobody.
   */
  activeMembershipsOf(
    platformUserId: string,
    organisation: PlatformOrganisation,
  ): Promise<readonly ResolvedMembership[]>;
}

/**
 * The default directory, and the one a deployment gets until Workforce Identity is wired in:
 * nobody is a member of anything.
 *
 * It exists so the API's failure mode is refusal rather than trust. A directory that could not
 * be resolved must not fall back to believing the request.
 */
export class DenyAllMembershipDirectory implements TenantMembershipDirectory {
  public activeMembershipsOf(): Promise<readonly ResolvedMembership[]> {
    return Promise.resolve([]);
  }
}
