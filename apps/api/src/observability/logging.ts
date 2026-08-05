import type { Params } from 'nestjs-pino';
import type { Environment } from '@work/config';
import type { Response } from 'express';

import type { CorrelatedRequest } from './correlation.middleware.js';

/**
 * Structured JSON logging. Every line carries the timestamp, level, request identifier,
 * correlation identifier and — once Phase 1 supplies tenant context — the tenant and user.
 *
 * Redaction is deny-by-default for the headers and fields that carry credentials or personal
 * data. A logger that leaks an Authorization header is a security defect, not a formatting one.
 */
export const loggingOptions = (environment: Environment): Params => ({
  pinoHttp: {
    level: environment.LOG_LEVEL,
    transport: environment.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
    autoLogging: { ignore: (request) => (request.url ?? '').startsWith('/health') },
    customProps: (request) => ({
      requestId: (request as CorrelatedRequest).requestId,
      correlationId: (request as CorrelatedRequest).correlationId,
      service: environment.APP_NAME,
      version: environment.APP_VERSION,
    }),
    customSuccessMessage: (request, response) =>
      `${request.method ?? 'UNKNOWN'} ${request.url ?? ''} ${String((response as Response).statusCode)}`,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        'req.body.password',
        'req.body.token',
        'req.body.secret',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (request: CorrelatedRequest) => ({
        id: request.requestId,
        method: request.method,
        url: request.url,
      }),
    },
  },
});
