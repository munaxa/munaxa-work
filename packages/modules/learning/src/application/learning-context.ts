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

import type { LearningRejection } from '../domain/learning-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into an event
 * origin, and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly twenty times and
 * wrongly once — and in this module the wrong one is a completion recorded under somebody else's
 * name, or a business refusal returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Learning operation ran outside a tenant context.');
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
 * `learning_enrolment.completed_by`, `learning_certification.issued_by`,
 * `learning_assessment_result.assessed_by` and `learning_assignment.waived_by` mean anything: a
 * caller who could supply any of them could record their own completion, issue themselves a
 * certificate, pass their own assessment, or file a waiver under a colleague's name.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: LearningRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/** A refusal raised by the application rather than by an aggregate. Same catalogue namespace. */
export const refuseWith = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  rejected(`learning.rejection.${reason}`);

/**
 * Nothing found — for a record in another tenant as well as one that does not exist, and for one
 * the caller may not see.
 *
 * "Forbidden" on an enrolment identifier would confirm that somebody is on a course, and in this
 * module that is itself information: a remedial safety course says something about the person on
 * it. A caller who may not see it is told there is nothing there.
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
 * Every date this module compares — a due date, an occurrence key, an expiry — is a civil date, and
 * "today" has to be derived the same way everywhere or the comparisons disagree by a day depending
 * on where the container ran.
 */
export const civilDateOf = (moment: Date): string => moment.toISOString().slice(0, 10);
