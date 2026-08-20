import {
  actorSubjectOf,
  currentContext,
  err,
  isSystemContext,
  rejected,
  type EventOrigin,
  type HandlerFailure,
  type Result,
} from '@work/kernel';

import type { LettersRejection } from '../domain/letters-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into an origin,
 * and a domain rejection into a pipeline failure.
 *
 * One place, because both are the kind of thing written correctly nineteen times and wrongly once —
 * and the wrong one here is an approval recorded against nobody, or a refused business rule
 * returned to a bank's HR contact as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Letters operation ran outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: actorSubjectOf(context),
  };
};

/**
 * Who is acting, for `requested_by`, `decided_by` and `issued_by`.
 *
 * Taken from the authenticated context and **never from a command**. This is what makes the
 * self-approval rule mean anything: a caller who could supply `decidedBy` could approve their own
 * salary certificate by naming somebody else.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/** A refused business rule becomes a 422: the request was understood and refused, not malformed. */
export const refusedBy = <TValue>(rejection: LettersRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
