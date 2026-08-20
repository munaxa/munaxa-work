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

import type { CareerRejection } from '../domain/career-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into an event
 * origin, and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly twenty times and
 * wrongly once — and in this module the wrong one is a successor confirmed under somebody else's
 * name, or a business refusal returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Career operation ran outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: actorSubjectOf(context),
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting, for every column that records a decision.
 *
 * Taken from the authenticated context and **never from a command**. This is what makes
 * `career_successor.confirmed_by`, `career_readiness_assessment.assessed_by` and
 * `career_mobility_recommendation.recommended_by` mean anything: a caller who could supply any of
 * them could nominate themselves for a director's post under their manager's name, or file a
 * readiness assessment about a colleague as somebody else.
 *
 * The domain refuses `system:auto-approval` on every one of those acts, and a check constraint
 * refuses it again at the table. Neither can be reached from a command field.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: CareerRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/** A refusal raised by the application rather than by an aggregate. Same catalogue namespace. */
export const refuseWith = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  rejected(`career.rejection.${reason}`);

/**
 * Nothing found — for a record in another tenant as well as one that does not exist, and for one
 * the caller may not see.
 *
 * "Forbidden" on a succession plan identifier would confirm that a bench exists for that position,
 * and in this module that is itself information: knowing an organization is quietly planning a
 * replacement for a named director is material somebody can act on. A caller who may not see it is
 * told there is nothing there.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });

/**
 * Refused because of who is asking rather than what they asked for.
 *
 * Used only where the *subject* is already known to the caller. Where knowing the subject exists
 * would itself be a disclosure, `notFound` is the correct answer and this is not.
 */
export const forbidden = <TValue>(permission: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'forbidden', permission });

/**
 * A civil date from an instant, in UTC.
 *
 * Every date this module compares — a target date, a membership period, a validity — is a civil
 * date, and "today" has to be derived the same way everywhere or the comparisons disagree by a day
 * depending on where the container ran.
 */
export const civilDateOf = (moment: Date): string => moment.toISOString().slice(0, 10);
