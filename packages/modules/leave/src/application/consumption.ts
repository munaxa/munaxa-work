import type { Transaction } from '@work/kernel';

import { accept, refuse, type LeaveResult } from '../domain/leave-rejection.js';
import { leaveYearFor } from '../domain/leave-year.js';
import { reversalOf } from '../domain/ledger.js';
import { appendToLedger } from './ledger-writer.js';
import type { LeaveRequestState } from '../domain/leave-request-state.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * What an approval takes from a balance, and what a cancellation gives back.
 *
 * Both go through the ledger and neither touches a balance figure directly. The balance is a
 * projection; this writes the movements it will be recomputed from, and marks it stale in the same
 * transaction (`appendToLedger` does all three things at once, deliberately).
 *
 * **Consumption is one entry per request, not one per day.** The day rows already say which dates
 * are covered and for how long; a ledger entry per date would multiply the ledger by an order of
 * magnitude and would make the idempotency key — one entry per `(source, kind)` — impossible.
 * Reversing a request is then one entry too, which is what makes a cancellation atomic rather than
 * a loop that could half-fail.
 *
 * **A cancellation reverses; it never deletes.** The original consumption stays exactly where it
 * is, and the reversal names it. "Consumed and then given back" and "never consumed" are different
 * facts about somebody's year, and a report that could not tell them apart would be wrong about
 * both.
 */

export const consumeFor = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  request: LeaveRequestState,
): Promise<LeaveResult<true>> => {
  if (request.totalMinutes <= 0) return refuse('request_consumes_nothing');

  const policy = await dependencies.stores.policies.byId(transaction, request.leavePolicyId);

  if (policy === undefined) return refuse('no_policy_assigned');

  const written = await appendToLedger(transaction, dependencies, {
    tenantId: request.tenantId,
    employmentId: request.employmentId,
    leaveTypeId: request.leaveTypeId,
    leaveYear: leaveYearFor(policy, request.fromDate),
    kind: 'consumption',
    minutes: -request.totalMinutes,
    effectiveOn: request.fromDate,
    sourceKind: 'request',
    sourceId: request.id,
    leavePolicyId: policy.id,
  });

  return written.ok ? accept(true) : written;
};

/**
 * The reversal a cancellation or an amendment writes.
 *
 * Idempotent through the same key every other writer uses: a `reversal` for this request exists at
 * most once, so a retried cancellation gives the time back once. Where the request never consumed
 * anything — it was cancelled before approval, or its consumption was already reversed — there is
 * nothing to reverse and that is a success, not a failure.
 */
export const reverseConsumptionFor = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  request: LeaveRequestState,
  reasonCode?: string,
): Promise<LeaveResult<true>> => {
  const entries = await dependencies.stores.ledger.forSource(transaction, {
    sourceKind: 'request',
    sourceId: request.id,
  });
  const consumption = entries.find((entry) => entry.kind === 'consumption');

  if (consumption === undefined) return accept(true);
  if (entries.some((entry) => entry.reversesEntryId === consumption.id)) return accept(true);

  const policy = await dependencies.stores.policies.byId(transaction, request.leavePolicyId);

  if (policy === undefined) return refuse('no_policy_assigned');

  const balance = await dependencies.stores.balances.forBucket(transaction, {
    employmentId: request.employmentId,
    leaveTypeId: request.leaveTypeId,
    leaveYearStart: consumption.leaveYearStart,
  });
  const reversal = reversalOf(
    consumption,
    {
      sourceKind: 'request',
      sourceId: request.id,
      // Dated to the day the reversal happens rather than to the original leave date: the leave was
      // genuinely consumed until it was given back, and back-dating the reversal would make an
      // as-of balance for last month wrong in the other direction.
      effectiveOn: effectiveToday(dependencies),
      balanceBeforeMinutes: balance?.availableMinutes ?? 0,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    },
    dependencies.clock.now(),
  );

  if (!reversal.ok) return reversal;

  const written = await appendToLedger(transaction, dependencies, {
    tenantId: reversal.value.tenantId,
    employmentId: reversal.value.employmentId,
    leaveTypeId: reversal.value.leaveTypeId,
    leaveYear: leaveYearFor(policy, consumption.leaveYearStart),
    kind: 'reversal',
    minutes: reversal.value.minutes,
    effectiveOn: reversal.value.effectiveOn,
    sourceKind: 'request',
    sourceId: request.id,
    reversesEntryId: consumption.id,
    leavePolicyId: policy.id,
    ...(reasonCode === undefined ? {} : { reasonCode }),
  });

  return written.ok ? accept(true) : written;
};

const effectiveToday = (dependencies: LeaveDependencies): string =>
  dependencies.clock.now().toISOString().slice(0, 10);
