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
 * Does this tenant's licence permit this request at all?
 *
 * After `AuthenticatedTenantGuard`, so the tenant it asks about is the one resolved from the
 * verified token and the caller's membership — never one the client named. A ceiling, never a
 * grant: every request it passes still faces the permission check and tenant isolation.
 *
 * Reads need `READ` and everything else `WRITE`, so an expired licence is read-only on the day it
 * expires on every route, including the ones written after this guard. Public routes — health and
 * sign-in — never reach a licensing decision. Under `LICENSING_MODE=NONE` it permits everything,
 * which is the deployment as it was before licensing existed.
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

    const state = await this.licence.current();
    if (!state.configured) return true;

    const established = currentContext();
    // `AuthenticatedTenantGuard` has already refused these; nothing to ask about.
    if (established === undefined || isSystemContext(established)) return true;

    const method = context.switchToHttp().getRequest<Request>().method.toUpperCase();
    const decision = checkOperation(
      state.snapshot,
      READ_METHODS.has(method) ? OperationKind.READ : OperationKind.WRITE,
      { now: state.evaluatedAt, tenantId: established.tenantId, product: WORK_PRODUCT_KEY },
    );
    if (decision.allowed) return true;

    throw new HttpException(
      {
        message:
          decision.reason === 'NO_SUBSCRIPTION'
            ? 'This installation has no valid Munaxa Work licence.'
            : "Your organisation's licence does not allow this right now.",
        reason: decision.reason,
        status: decision.status,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
