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

import type { DocumentsRejection } from '../domain/documents-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into an event
 * origin, and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly nineteen times and
 * wrongly once — and the wrong one is an access record with no actor, or a business refusal
 * returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Documents event was raised outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: actorSubjectOf(context),
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting, for the columns that record a decision and an access.
 *
 * Taken from the authenticated context and **never from a command**. This is what makes
 * `document_verification.decided_by` and `document_access_event.actor` mean anything: a caller who
 * could supply either could sign off their own upload, or record somebody else's name against the
 * document they just read.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

export const currentCorrelationId = (): string => originOfCurrentRequest().correlationId;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: DocumentsRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/**
 * Nothing found — for a document in another tenant as well as one that does not exist, and for one
 * the caller may not see.
 *
 * "Forbidden" on a document identifier would confirm that a document of that kind exists for that
 * employee, which in this module is itself the disclosure. A caller who cannot see a medical
 * certificate is told there is nothing there.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });
