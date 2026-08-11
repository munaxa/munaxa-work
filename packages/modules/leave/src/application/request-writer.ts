import { uuidV7, type Transaction } from '@work/kernel';

import { LeaveRequest } from '../domain/leave-request.js';
import { isoOf } from '../domain/leave-year.js';
import { accept, refuse, type LeaveResult } from '../domain/leave-rejection.js';
import { currentActor, currentTenant } from './leave-context.js';
import { planRequest } from './request-planning.js';
import { recordRequestEvent } from './request-history.js';
import type { Breakdown, DayDraft, PortionRequest } from '../domain/duration.js';
import type { Metadata } from '../domain/leave-aggregate.js';
import type { LeaveRequestState, RequestDayState } from '../domain/leave-request-state.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Creating a request and its day rows, shared by the ordinary path and by amendment.
 *
 * Shared rather than duplicated because an amendment **is** a request — a new one that supersedes
 * an approved original — and two code paths that built one would eventually differ in which policy
 * check they ran or which day rows they wrote. The difference would show up as an amendment that
 * skipped a check the original had passed.
 *
 * The day rows are written **at creation**, which is what puts the overlap invariant in the
 * database's hands: two people racing for the same morning collide on the exclusion constraint
 * rather than both passing an application check and both committing.
 */

export interface CreateRequest {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly fromDate: string;
  readonly toDate: string;
  readonly portions?: readonly PortionRequest[];
  readonly reasonCode?: string;
  readonly justification?: string;
  readonly contactDuringAbsence?: string;
  readonly addressDuringAbsence?: string;
  readonly replacementEmploymentId?: string;
  readonly delegationId?: string;
  readonly attachmentReference?: string;
  readonly supersedesRequestId?: string;
  readonly metadata?: Metadata;
}

export interface CreatedRequest {
  readonly state: LeaveRequestState;
  readonly breakdown: Breakdown;
}

export const createLeaveRequest = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  command: CreateRequest,
): Promise<LeaveResult<CreatedRequest>> => {
  const now = dependencies.clock.now();
  const plan = await planRequest(transaction, dependencies, {
    employmentId: command.employmentId,
    leaveTypeId: command.leaveTypeId,
    fromDate: command.fromDate,
    toDate: command.toDate,
    portions: command.portions ?? [],
    hasAttachment: command.attachmentReference !== undefined,
    today: isoOf(now),
  });

  if (!plan.ok) return plan;

  const raised = LeaveRequest.raise(
    {
      ...command,
      tenantId: currentTenant(),
      leavePolicyId: plan.value.policy.id,
      totalMinutes: plan.value.breakdown.totalMinutes,
      durationBasis: plan.value.policy.durationBasis,
      requestedBy: currentActor(),
      balanceAtRequestMinutes: plan.value.balanceMinutes,
      approvalsRequired: plan.value.policy.approvalsRequired,
    },
    now,
  );

  if (!raised.ok) return raised;

  const state = raised.value.snapshot();

  await dependencies.stores.requests.insert(transaction, state);

  const written = await writeDays(transaction, dependencies, state, plan.value.breakdown.days);

  if (!written.ok) return written;

  await recordRequestEvent(transaction, dependencies, {
    requestId: state.id,
    kind: 'created',
    toState: state.state,
  });

  // Re-read so the caller holds the stamped version. An insert sets `version` to 1, and a caller
  // that went on to update the row against the pre-insert value would fail on a version nobody had
  // changed.
  const stored = await dependencies.stores.requests.byId(transaction, state.id);

  return accept({ state: stored ?? state, breakdown: plan.value.breakdown });
};

/**
 * The day rows, one at a time, with the overlap constraint translated into a refusal.
 *
 * One at a time rather than in a batch because the exclusion constraint reports *which* date
 * collided, and a batch insert would lose that — "you already have leave on the fourteenth" is a
 * far more useful refusal than "this request overlaps something".
 *
 * **The constraint is the guarantee and this is the message.** Two people racing for the same
 * morning both pass every application check; one of them loses at the database, and what comes back
 * is a `23P01`. Letting that propagate would turn somebody's ordinary mistake into a 500 — so it is
 * caught here and returned as the business refusal it is. The check is *not* moved into
 * application code: a read-then-write would lose the race it exists to settle.
 */
const EXCLUSION_VIOLATION = '23P01';

const writeDays = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  request: LeaveRequestState,
  days: readonly DayDraft[],
): Promise<LeaveResult<true>> => {
  for (const day of days) {
    const state: RequestDayState = {
      id: uuidV7(request.requestedAt.getTime()),
      tenantId: request.tenantId,
      leaveRequestId: request.id,
      employmentId: request.employmentId,
      onDate: day.onDate,
      portion: day.portion,
      minutes: day.minutes,
      ...(day.startLocal === undefined ? {} : { startLocal: day.startLocal }),
      ...(day.endLocal === undefined ? {} : { endLocal: day.endLocal }),
      zone: day.zone,
      expectedMinutes: day.expectedMinutes,
      version: 0,
    };

    try {
      await dependencies.stores.requestDays.insert(transaction, state);
    } catch (cause) {
      if (!isExclusionViolation(cause)) throw cause;

      return refuse('leave_already_covers_this_date', { onDate: day.onDate });
    }
  }
  return accept(true);
};

/**
 * The exclusion violation, recognised without importing the driver.
 *
 * Recognised by SQLSTATE rather than by message, because the message is the server's and is
 * localized; and without importing `pg`, because the application layer may not depend on a driver.
 */
const isExclusionViolation = (cause: unknown): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause as { readonly code?: unknown }).code === EXCLUSION_VIOLATION;
