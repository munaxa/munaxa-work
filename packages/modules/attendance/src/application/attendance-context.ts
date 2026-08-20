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

import type { AttendanceRejection } from '../domain/attendance-rejection.js';

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
    throw new Error('An Attendance event was raised outside a tenant context.');
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
 * Taken from the authenticated context and never from a command. A caller who could name their own
 * actor could record an attendance correction as though a manager had approved it — and an approval
 * somebody can forge is not evidence of anything.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 *
 * The catalogue key travels with it rather than a sentence, so the message an Arabic-speaking shift
 * supervisor reads is chosen at the edge from their language instead of being fixed here in English.
 */
export const refusedBy = <TValue>(rejection: AttendanceRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found, for a caller who has no business learning otherwise.
 *
 * Used for a record in another tenant as well as one that does not exist. "Forbidden" on an
 * attendance identifier confirms that a person worked a shift in this system, which is itself a
 * disclosure — one tenant learning another was operating on a public holiday.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
