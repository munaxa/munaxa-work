import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import type { CorrelatedRequest } from '../observability/correlation.middleware.js';

/**
 * RFC 9457 Problem Details. Every error leaves the API in this shape, and nothing internal
 * leaves with it: no stack trace, no SQL, no environment detail, no secret.
 *
 * The correlation and request identifiers are included deliberately — they are what turns a
 * support conversation into a log query.
 */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly errors?: Readonly<Record<string, readonly string[]>>;
}

const PROBLEM_CONTENT_TYPE = 'application/problem+json';
/** Below this, the client caused it and may see why. At or above it, we did, and may not. */
const SERVER_ERROR_STATUS = 500;
const UNEXPECTED_DETAIL = 'An unexpected error occurred.';

const titleFor = (status: number): string =>
  HttpStatus[status] === undefined
    ? 'Error'
    : String(HttpStatus[status])
        .toLowerCase()
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

const detailFrom = (exception: HttpException): string | undefined => {
  const response = exception.getResponse();

  if (typeof response === 'string') return response;
  if (typeof response === 'object' && response !== null && 'message' in response) {
    const { message } = response;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.join('; ');
  }
  return undefined;
};

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<CorrelatedRequest>();
    const response = context.getResponse<Response>();

    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only a deliberate HttpException carries a message safe to return. Anything else is
    // unexpected, and its detail stays in the log.
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: titleFor(status),
      status,
      detail: isHttp ? detailFrom(exception) : UNEXPECTED_DETAIL,
      instance: request.originalUrl,
      requestId: request.requestId,
      correlationId: request.correlationId,
    };

    if (status >= SERVER_ERROR_STATUS) {
      this.logger.error(
        { err: exception, requestId: problem.requestId, correlationId: problem.correlationId },
        'Unhandled exception',
      );
    }

    response.status(status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }
}
