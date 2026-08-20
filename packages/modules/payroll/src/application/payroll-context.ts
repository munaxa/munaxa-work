import {
  actorSubjectOf,
  currentContext,
  currentTenantId,
  err,
  isSystemContext,
  rejected,
  type EventOrigin,
  type HandlerFailure,
  type Result,
} from '@work/kernel';

import type { PayrollRejection } from '../domain/payroll-rejection.js';

/**
 * The small translations every handler in this module needs: the ambient execution context into an
 * event origin, and a domain rejection into a pipeline failure.
 *
 * They live here rather than in each handler because both are the kind of thing written correctly
 * nineteen times and wrongly once — and the wrong one is an event with no correlation identifier,
 * or a business refusal returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Payroll event was raised outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: actorSubjectOf(context),
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting, for the columns that record a human decision.
 *
 * Taken from the authenticated context and **never from a command**. This is the load-bearing one:
 * `payroll_approval_decision.decided_by` is what says a named human authorized what a workforce is
 * about to be paid, and a caller who could supply it could approve their own run under somebody
 * else's name. The database refuses `decided_by = requested_by`; this is what makes the left-hand
 * side of that comparison trustworthy.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 *
 * The catalogue key travels with it rather than a sentence, so the message an Arabic-speaking
 * administrator reads is chosen at the edge from their language instead of being fixed here.
 */
export const refusedBy = <TValue>(rejection: PayrollRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found, for a caller who has no business learning otherwise.
 *
 * Used for a record in another tenant as well as one that does not exist. "Forbidden" on a payroll
 * result identifier would confirm that somebody in this system was paid something, which is itself
 * a disclosure.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
