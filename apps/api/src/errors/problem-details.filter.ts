import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ConcurrencyException } from '@work/kernel';
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
    // **A lost optimistic-concurrency race is expected, not internal.** It travels as an exception
    // rather than as a `Result` because a repository cannot know whether its caller wanted to
    // retry, but by the time it reaches the edge the answer is plain: somebody else wrote first,
    // and the client should read again and resend. Answering 500 would tell them to report a bug.
    //
    // Mapped here rather than in each module's `unwrapOrThrow` because this is the one place that
    // turns an escaped exception into a response; a copy per module is a copy that goes missing.
    const isStale = exception instanceof ConcurrencyException;
    const status = isHttp
      ? exception.getStatus()
      : isStale
        ? HttpStatus.CONFLICT
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Only a deliberate HttpException carries a message safe to return. Anything else is
    // unexpected, and its detail stays in the log. A stale write is the exception: the client is
    // told the row moved on, and nothing about the row is disclosed in saying so.
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: titleFor(status),
      status,
      detail: isHttp
        ? detailFrom(exception)
        : isStale
          ? 'The record changed since it was read. Read it again and resend.'
          : UNEXPECTED_DETAIL,
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
