import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { currentContext, isSystemContext } from '@work/kernel';
import type { Request } from 'express';

import type { IdentityRequestContext } from '@work/identity';

import { PUBLIC_ROUTE } from './public-route.decorator.js';

/**
 * Refuses any business request that reached this far without an authenticated principal and a
 * resolved tenant.
 *
 * It exists for two reasons, and the second is the one that is easy to miss.
 *
 * **It fails cleanly.** Without it, a request with no tenant context reaches a handler, the
 * kernel's `currentTenantId()` throws a `TenantIsolationException` from somewhere deep, and the
 * caller gets a 500 for what is really a 401. An internal error is the wrong answer to "you are
 * not signed in", and it is the wrong answer to look at in a log at three in the morning.
 *
 * **It runs before validation.** Nest runs guards before pipes, and the global `ValidationPipe`
 * is a pipe — so without a guard here, an unauthenticated caller sending a malformed body would
 * be told their body was malformed. The kernel's pipeline orders authorization before validation
 * for exactly this reason; the guard is what extends that ordering out to the transport, where
 * the framework would otherwise have made its own choice.
 *
 * It distinguishes 401 from 403 honestly. No principal is 401 — sign in. A principal with no
 * usable membership is also 401 rather than 403: telling somebody "you are not a member of that
 * tenant" confirms the tenant exists, and a person who is a member of nothing has nothing to be
 * forbidden from.
 */
@Injectable()
export class AuthenticatedTenantGuard implements CanActivate {
  // Injected by token rather than by parameter type: the test runner transpiles this file
  // without decorator metadata, and a guard that only works in the compiled build is a guard
  // whose behaviour is untested.
  public constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & IdentityRequestContext>();
    const established = currentContext();

    if (established === undefined || isSystemContext(established)) {
      throw new UnauthorizedException(
        request.principal === undefined
          ? 'Not authenticated.'
          : 'No tenant resolved for this principal.',
      );
    }
    return true;
  }
}
