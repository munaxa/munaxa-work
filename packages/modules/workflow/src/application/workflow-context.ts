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

import type { WorkflowRejection } from '../domain/workflow-rejection.js';

/**
 * The small translations every handler here needs: the ambient execution context into the identities
 * a decision records, and a domain rejection into a pipeline failure.
 *
 * They live in one place because both are the kind of thing written correctly twenty times and
 * wrongly once — and in this module the wrong one is an approval recorded under somebody else's
 * name, or a business refusal returned as a server error.
 */

export const originOfCurrentRequest = (): EventOrigin => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) {
    throw new Error('A Workflow operation ran outside a tenant context.');
  }
  return {
    tenantId: context.tenantId,
    correlationId: context.correlationId,
    actor: context.actor,
  };
};

export const currentTenant = (): string => currentTenantId();

/**
 * The audit actor — `user:<workforceUserId>`.
 *
 * Written to `created_by` and `updated_by` on every row, and the column the
 * `workflow_decision_human_check` constraint refuses `system:auto-approval` on. It says *which
 * authenticated request wrote this*, which is a different question from the two below.
 */
export const currentActor = (): string => originOfCurrentRequest().actor;

export const currentCorrelation = (): string => originOfCurrentRequest().correlationId;

/**
 * **Which member is asking** — the identity an approval is addressed to.
 *
 * Three identifiers travel with a request and they mean three different things. `platformUserId` is
 * the account Platform vouched for. `workforceUserId` is the person, and it is what `actor` names.
 * `membershipId` is *that person in this tenant*, and it is the one an approver is recorded as,
 * because a person may hold memberships in several tenants (AD-005) and an approval belongs to one.
 * It is also the identifier Identity's delegation register is keyed on.
 *
 * **`undefined` is a real answer**, not a defect. A reconciliation command, a migration and every
 * test fixture construct a context directly and name no membership. The safe response is to refuse
 * the operations that need one rather than to guess — which is why this returns the absence instead
 * of throwing, and why `requireMembership` exists to turn it into a refusal at the one place that
 * needs it.
 *
 * **Never read from a command.** A caller who could supply this could read anybody's approval queue
 * and answer anybody's step by changing a field.
 */
export const currentMembership = (): string | undefined => {
  const context = currentContext();

  if (context === undefined || isSystemContext(context)) return undefined;
  return context.membershipId;
};

/**
 * A refused business rule becomes a `rejected` failure, which the API renders as 422: the request
 * was understood and refused, rather than malformed.
 */
export const refusedBy = <TValue>(rejection: WorkflowRejection): Result<TValue, HandlerFailure> =>
  rejected(rejection.messageKey);

/** A refusal raised by the application rather than by an aggregate. Same catalogue namespace. */
export const refuseWith = <TValue>(reason: string): Result<TValue, HandlerFailure> =>
  rejected(`workflow.rejection.${reason}`);

/**
 * Nothing found — for a record in another tenant as well as one that does not exist, and for one
 * the caller may not see.
 *
 * "Forbidden" on an instance identifier would confirm that an approval exists for that subject, and
 * knowing that a named requisition is currently sitting with a named director is itself the
 * disclosure. A caller who may not see it is told there is nothing there.
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
