import { Controller, Get, Inject, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { IdentityRequestContext, TenantMembershipDirectory } from '@work/identity';

import { MEMBERSHIP_DIRECTORY } from '../identity/identity.tokens.js';

import { PrincipalRoute } from './principal-route.decorator.js';
import { membershipsForPrincipal } from './tenant-resolution.js';

/** One tenant the caller may select. Identifiers only, as the directory returns them. */
export interface SessionTenant {
  readonly tenantId: string;
}

export interface SessionTenants {
  readonly tenants: readonly SessionTenant[];
}

/**
 * Which tenants the signed-in caller may act in — what the Admin tenant picker lists (MW-007).
 *
 * The answer is the membership directory's, for the authenticated principal and the organisation
 * their token was issued for (ADR-0080): the same set the tenant middleware chooses from, so a
 * tenant listed here is one a selection header can actually resolve to, and one missing from it is
 * one the header would be refused for. It is keyed only by the verified principal; nothing the
 * caller sends, the selection header included, changes it.
 *
 * Identifiers only. The directory deliberately returns no tenant data, and there is no tenant
 * context here in which any could be read.
 */
@Controller({ path: 'session', version: '1' })
export class SessionTenantsController {
  public constructor(
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: TenantMembershipDirectory,
  ) {}

  @Get('tenants')
  @PrincipalRoute()
  public async tenants(@Req() request: Request & IdentityRequestContext): Promise<SessionTenants> {
    const principal = request.principal;
    // The guard refuses this first; repeated so the handler cannot be reached without one.
    if (principal === undefined) throw new UnauthorizedException('Not authenticated.');

    const memberships = await membershipsForPrincipal(this.directory, principal);
    const unique = [...new Set(memberships.map((membership) => membership.tenantId))];

    return { tenants: unique.map((tenantId) => ({ tenantId })) };
  }
}
