import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runInContext, type ExecutionContext, type PlatformAuthenticationPort } from '@work/kernel';
import type { IdentityRequestContext, TenantMembershipDirectory } from '@work/identity';

import type { CorrelatedRequest } from '../observability/correlation.middleware.js';
import { AUTHENTICATION_PORT, MEMBERSHIP_DIRECTORY } from '../identity/identity.tokens.js';

import { actorFor, resolveForPrincipal } from './tenant-resolution.js';

/**
 * The header a caller uses to say *which* of their tenants they mean. It selects; it never
 * grants. See `tenant-resolution.ts`.
 */
export const TENANT_HEADER = 'x-munaxa-tenant';
const AUTHORIZATION_HEADER = 'authorization';

/**
 * Establishes who the caller is and which tenant they are acting in, for the rest of the
 * request.
 *
 * Two steps, in this order, and neither is optional:
 *
 *   1. **Platform authenticates.** Munaxa Work verifies nothing itself; it hands the presented
 *      credentials to Platform's adapter and receives a principal or nothing (ADR-0001).
 *   2. **A stored membership chooses the tenant.** Not a header. The header may narrow the set
 *      of tenants this person is already an active member of, and can do nothing else.
 *
 * When either step yields nothing, **no context is established at all**. That is deliberate and
 * it is the safe direction: the kernel's `currentTenantId()` throws outside a tenant context and
 * row-level security returns no rows when `app.tenant_id` is unset, so a request that gets this
 * far unresolved fails closed on both layers rather than running as somebody.
 *
 * It remains middleware rather than a guard because the context is async-local and has to wrap
 * everything downstream, which only `next()` inside `runInContext` achieves.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);

  public constructor(
    @Inject(AUTHENTICATION_PORT) private readonly authentication: PlatformAuthenticationPort,
    @Inject(MEMBERSHIP_DIRECTORY) private readonly directory: TenantMembershipDirectory,
  ) {}

  public async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const correlated = request as CorrelatedRequest;
    // Typed alias rather than a cast at each assignment, matching the correlation middleware.
    // Nothing else in the process writes these two fields.
    const identified = request as Request & IdentityRequestContext;
    const principal = await this.authentication.authenticate(credentialsFrom(request));

    if (principal === undefined) {
      next();
      return;
    }
    identified.principal = principal;

    const resolution = await resolveForPrincipal(
      this.directory,
      principal,
      headerValue(request, TENANT_HEADER),
    );

    if (resolution.kind !== 'resolved') {
      // Logged at debug because these are ordinary outcomes — a new starter with no membership,
      // a client that forgot to name a tenant — not incidents. A refused tenant *claim* is
      // different, and says so.
      this.logger.debug(
        `Tenant unresolved (${resolution.kind}) for principal ${principal.platformUserId}.`,
      );
      next();
      return;
    }

    identified.membership = resolution.membership;

    // `membershipId` alongside `userId`, from the membership this request already resolved rather
    // than from a second lookup. The two are different facts: the workforce user is the person, and
    // the membership is that person *in this tenant* — which is the identifier Identity's delegation
    // register is keyed on, and therefore the only one that can answer "which approvals are waiting
    // for me". It was previously resolved here and discarded one line later.
    const context: ExecutionContext = {
      tenantId: resolution.membership.tenantId,
      correlationId: correlated.correlationId,
      actor: actorFor(resolution.membership),
      userId: resolution.membership.workforceUserId,
      membershipId: resolution.membership.membershipId,
    };

    runInContext(context, () => {
      next();
    });
  }
}

const headerValue = (request: Request, header: string): string | undefined => {
  const value = request.headers[header];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Splits the Authorization header into a scheme and a value, and does nothing else with it.
 *
 * Deliberately not parsed further: a token this repository can decode is a token this repository
 * would eventually be tempted to trust, and verifying it is Platform's job (AD-001).
 */
const credentialsFrom = (
  request: Request,
): { readonly scheme: string; readonly value: string } | undefined => {
  const header = headerValue(request, AUTHORIZATION_HEADER);

  if (header === undefined) return undefined;

  const separator = header.indexOf(' ');

  return separator === -1
    ? { scheme: 'Bearer', value: header }
    : { scheme: header.slice(0, separator), value: header.slice(separator + 1) };
};
