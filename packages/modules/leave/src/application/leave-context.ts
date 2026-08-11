import {
  currentContext,
  currentTenantId,
  err,
  isSystemContext,
  rejected,
  type EventOrigin,
  type HandlerFailure,
  type Result,
} from '@work/kernel';

import type { LeaveRejection } from '../domain/leave-rejection.js';

/**
 * The small translations every handler in this module needs: the ambient execution context into an
 * event origin, and a domain rejection into a pipeline failure.
 *
 * They live here rather than in each handler because both are the kind of thing written correctly
 * nineteen times and wrongly once — and the wrong one is an event with no correlation identifier,
 * or a business refusal returned as a server error.
 */

/** The tenant, actor and correlation every event carries, taken from the running request. */
export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    // The pipeline already refuses an untenanted business operation; this is the second line, so
    // a handler invoked outside the pipeline cannot raise an untenanted event either.
    throw new Error('A Leave event was raised outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: context.actor,
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting, for the columns that record a human decision.
 *
 * Taken from the authenticated context and **never from a command**. This is the load-bearing one
 * in this module: `leave_request_decision.decided_by` is what says a named human approved somebody
 * else's paid absence, and a caller who could supply it could approve their own leave under
 * somebody else's name. The database refuses `decided_by = requested_by`; this is what makes the
 * left-hand side of that comparison trustworthy.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 *
 * The catalogue key travels with it rather than a sentence, so the message an Arabic-speaking
 * employee reads is chosen at the edge from their language instead of being fixed here in English.
 */
export const refusedBy = <TValue>(rejection: LeaveRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found, for a caller who has no business learning otherwise.
 *
 * Used for a record in another tenant as well as one that does not exist. "Forbidden" on a leave
 * request identifier confirms that somebody in this system asked for leave, which is itself a
 * disclosure — and on a sick-leave request it is close to a health disclosure (§30).
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
