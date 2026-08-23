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

import type { RelationsRejection } from '../domain/relations-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into who is acting,
 * and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly nineteen times and
 * wrongly once — and the wrong one is a disciplinary record with no author, or a business refusal
 * returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Relations operation ran outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: actorSubjectOf(context),
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting — for `relation_violation.reported_by` and `relation_violation_access_event.actor`.
 *
 * Taken from the authenticated context and **never from a command**. This is the whole of what makes
 * those two columns mean anything: a caller who could supply either could file a disciplinary
 * allegation under a colleague's name, or record somebody else as having read the file they just
 * opened.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

export const currentCorrelationId = (): string => originOfCurrentRequest().correlationId;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: RelationsRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found — for a record in another tenant as much as for one that never existed.
 *
 * **`not_found` rather than `forbidden`, deliberately.** "Forbidden" on a violation identifier would
 * confirm that a disciplinary record exists for whoever it belongs to, which in this domain is
 * itself the disclosure. An identifier must not be usable as a probe: a caller who guesses one
 * learns exactly what a caller who invents one learns.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
