import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isUuidV7, runInContext, type ExecutionContext } from '@work/kernel';

import type { CorrelatedRequest } from '../observability/correlation.middleware.js';

export const TENANT_HEADER = 'x-tenant-id';

/**
 * Establishes the tenant context for the request, so everything downstream — handlers,
 * repositories, the Unit of Work, row-level security — is scoped without being told.
 *
 * Until Phase 2 wires Platform authentication, the tenant arrives as a header. That is
 * deliberately temporary and deliberately narrow: an absent or unparseable tenant produces no
 * context at all rather than a default, and every tenant-scoped operation then refuses. The
 * request fails; it never quietly runs unscoped.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  public use(request: Request, _response: Response, next: NextFunction): void {
    const header = request.headers[TENANT_HEADER];
    const tenantId = Array.isArray(header) ? header[0] : header;
    const correlated = request as CorrelatedRequest;

    if (tenantId === undefined || !isUuidV7(tenantId)) {
      next();
      return;
    }

    const context: ExecutionContext = {
      tenantId,
      correlationId: correlated.correlationId,
      actor: 'user:anonymous',
    };

    runInContext(context, () => {
      next();
    });
  }
}
