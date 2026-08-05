import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * A request that has passed through this middleware. Declared explicitly rather than by global
 * augmentation: the augmentation would claim every Express request in the process carries these
 * fields, which is only true downstream of here.
 */
export interface CorrelatedRequest extends Request {
  requestId: string;
  correlationId: string;
}

const headerValue = (request: Request, header: string): string | undefined => {
  const value = request.headers[header];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Assigns a request identifier and propagates a correlation identifier.
 *
 * The request identifier is ours and is always new. The correlation identifier is the caller's
 * if it sent one, so a single business operation stays traceable across services, jobs and
 * integrations. Both are echoed back so a client can quote them in a support request.
 */
@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  public use(request: Request, response: Response, next: NextFunction): void {
    const requestId = headerValue(request, REQUEST_ID_HEADER) ?? randomUUID();
    const correlationId = headerValue(request, CORRELATION_ID_HEADER) ?? requestId;

    const correlated = request as CorrelatedRequest;
    correlated.requestId = requestId;
    correlated.correlationId = correlationId;

    response.setHeader(REQUEST_ID_HEADER, requestId);
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}
