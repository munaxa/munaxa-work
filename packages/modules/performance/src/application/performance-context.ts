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

import type { PerformanceRejection } from '../domain/performance-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into an event
 * origin, and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly twenty times and
 * wrongly once — and in this module the wrong one is an assessment recorded against the wrong
 * author, or a business refusal returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Performance operation ran outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: context.actor,
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * Who is acting, for every column that records a decision.
 *
 * Taken from the authenticated context and **never from a command**. This is what makes
 * `performance_assessment.submitted_by`, `performance_calibration_decision.decided_by` and
 * `performance_review.completed_by` mean anything: a caller who could supply any of them could
 * sign off their own review, calibrate it themselves, or file an assessment under a colleague's
 * name.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

export const currentCorrelationId = (): string => originOfCurrentRequest().correlationId;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(
  rejection: PerformanceRejection,
): Result<TValue, HandlerFailure> => rejected(rejection.messageKey);

/** A refusal raised by the application rather than by an aggregate. Same catalogue namespace. */
export const refuseWith = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  rejected(`performance.rejection.${reason}`);

/**
 * Nothing found — for a review in another tenant as well as one that does not exist, and for one
 * the caller may not see.
 *
 * "Forbidden" on a review identifier would confirm that a review exists for that employment in that
 * cycle, and in this module the existence of a review is itself information: it says somebody is
 * being appraised. A caller who may not see it is told there is nothing there.
 */
export const notFound = <TValue>(resource: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'not_found', resource });

export const conflicted = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'conflict', reason });

/**
 * Refused because of who is asking rather than what they asked for.
 *
 * Used only where the *subject* is already known to the caller — an unassigned reviewer trying to
 * submit against a review they were told about, say. Where knowing the subject exists would itself
 * be a disclosure, `notFound` is the correct answer and this is not.
 */
export const forbidden = <TValue>(permission: string): Result<TValue, HandlerFailure> =>
  err({ kind: 'forbidden', permission });
