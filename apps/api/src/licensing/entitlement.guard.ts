import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OperationKind, checkOperation } from '@munaxa/licensing';
import { currentContext, isSystemContext } from '@work/kernel';
import type { Request } from 'express';

import { PUBLIC_ROUTE } from '../tenancy/public-route.decorator.js';
import { LicenceSource, WORK_PRODUCT_KEY } from './licence.source.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A read, a write — or a module export (`GET …/export`), the one route kind a cancelled
 * organisation still reaches (ADR-0079). Letting it through here grants nothing by itself: the
 * operation gate then requires that what the route dispatches is a `<module>.export` query, so a
 * route merely named `export` that reads anything else is still refused as a read.
 */
export const requestKindOf = (method: string, path: string): OperationKind => {
  if (!READ_METHODS.has(method.toUpperCase())) return OperationKind.WRITE;
  return /\/export\/?$/.test(path) ? OperationKind.EXPORT : OperationKind.READ;
};

/**
 * Does this tenant's licence permit this request at all?
 *
 * After `AuthenticatedTenantGuard`, so the tenant it asks about is the one resolved from the
 * verified token and the caller's membership — never one the client named. A ceiling, never a
 * grant: every request it passes still faces the permission check and tenant isolation.
 *
 * Reads need `READ` and everything else `WRITE`, so an expired licence is read-only on the day it
 * expires on every route, including the ones written after this guard. A module export needs only
 * `EXPORT`, so a cancelled organisation can still take its records with it. Public routes — health and
 * sign-in — never reach a licensing decision. Under `LICENSING_MODE=NONE` it permits everything,
 * which is the deployment as it was before licensing existed.
 *
 * Which *modules* a plan includes is the operation gate's question (`LicensingGate`), asked inside
 * the dispatcher where the operation's module is known; this guard answers only whether the term
 * allows a read or a write at all, before the request reaches any controller.
 *
 * `402`, not `403`: the question is what the organisation bought, not what this person may do.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  public constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(LicenceSource) private readonly licence: LicenceSource,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    if (!this.licence.configured) return true;

    const established = currentContext();
    // `AuthenticatedTenantGuard` has already refused these; nothing to ask about.
    if (established === undefined || isSystemContext(established)) return true;

    const state = await this.licence.current(established.tenantId);
    if (!state.configured) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const kind = requestKindOf(request.method, request.path);
    const decision = checkOperation(state.snapshot, kind, {
      now: state.evaluatedAt,
      tenantId: established.tenantId,
      product: WORK_PRODUCT_KEY,
      cap: state.cap,
    });
    if (decision.allowed) return true;

    throw new HttpException(
      {
        message:
          decision.reason === 'NO_SUBSCRIPTION'
            ? 'Your organisation has no valid Munaxa Work subscription.'
            : "Your organisation's licence does not allow this right now.",
        reason: decision.reason,
        status: decision.status,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
