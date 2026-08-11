import { evaluateRule, type Transaction } from '@work/kernel';

import { accrue } from '../domain/accrual.js';
import { entitlement } from '../domain/entitlement.js';
import { leaveYearFor, type LeaveYear } from '../domain/leave-year.js';
import { appendToLedger } from './ledger-writer.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { EmploymentForLeave } from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';
import type { AccrualRunState } from '../domain/runs.js';

/**
 * One employment's accrual, and the two idempotency reads that make a run restartable.
 *
 * Apart from the command because the command is about *the run* — its bounds, its counts, its
 * record — and this is about one person's entitlement. Keeping them together would have put a file
 * over budget and, more to the point, would have buried the arithmetic under the bookkeeping.
 *
 * **No statutory figure appears here.** The amount comes from the policy version, and for
 * `service_band` from a `RuleDefinition` the tenant or a country pack supplied, evaluated by the
 * kernel engine. That twenty-one days follow five years is Jordanian law, not this product's
 * opinion (§22).
 */

export type Outcome = 'written' | 'skipped' | 'refused';

/**
 * What one employment's accrual needs to know, carried as plain values.
 *
 * Plain values rather than the command, so this file does not import the command that imports it.
 * A cycle between the two would be an import-order accident waiting to happen, and the dependency
 * gate refuses it outright.
 */
export interface RunContext {
  readonly run: AccrualRunState;
  readonly policy: LeavePolicyState;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** One employment's accrual, skipped where this run already granted it. */
export const accrueOne = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  context: RunContext,
  employment: EmploymentForLeave,
): Promise<Outcome> => {
  const leaveYear = leaveYearFor(context.policy, context.periodStart);
  const already = await dependencies.stores.entitlements.bySource(transaction, {
    employmentId: employment.employmentId,
    leaveTypeId: context.policy.leaveTypeId,
    leaveYearStart: leaveYear.start,
    source: 'accrual',
    sourceId: context.run.id,
  });

  // This run already granted this employment. The read is what turns a retry into a no-op; the
  // unique index is what guarantees it under concurrency.
  if (already !== undefined) return 'skipped';

  const computed = accrue(context.policy, {
    employmentStartDate: employment.startDate,
    periodStart: context.periodStart,
    periodEnd: context.periodEnd,
    leaveYearStart: leaveYear.start,
    leaveYearEnd: leaveYear.end,
    ...bandFor(context.policy, employment),
  });

  if (!computed.ok) return 'refused';
  if (computed.value.minutes <= 0) return 'skipped';

  return writeAccrual(transaction, dependencies, {
    context,
    employment,
    leaveYear,
    minutes: computed.value.minutes,
  });
};

/**
 * The service band a rule resolved to, for `service_band` policies.
 *
 * Evaluated here rather than inside `accrue`, because the accrual function is pure and a rule
 * engine needs facts and produces a trace. The outcome the pack's rule carries is a number of
 * minutes; a rule that does not match yields no band, and the run refuses that employment rather
 * than granting zero — a person no band covers is a configuration gap somebody needs to see.
 */
const bandFor = (
  policy: LeavePolicyState,
  employment: EmploymentForLeave,
): { readonly bandMinutes?: number } => {
  if (policy.accrualMethod !== 'service_band' || policy.eligibilityRule === undefined) return {};

  const evaluation = evaluateRule(policy.eligibilityRule, {
    employmentStatus: employment.status,
    startDate: employment.startDate,
  });

  if (!evaluation.ok || !evaluation.value.matched) return {};

  const outcome: unknown = evaluation.value.outcome;

  return typeof outcome === 'number' ? { bandMinutes: outcome } : {};
};

interface WriteAccrual {
  readonly context: RunContext;
  readonly employment: EmploymentForLeave;
  readonly leaveYear: LeaveYear;
  readonly minutes: number;
}

const writeAccrual = async (
  transaction: Transaction,
  dependencies: LeaveDependencies,
  write: WriteAccrual,
): Promise<Outcome> => {
  const granted = entitlement(
    {
      tenantId: write.context.run.tenantId,
      employmentId: write.employment.employmentId,
      leaveTypeId: write.context.policy.leaveTypeId,
      leavePolicyId: write.context.policy.id,
      leaveYear: write.leaveYear,
      grantedMinutes: write.minutes,
      source: 'accrual',
      sourceId: write.context.run.id,
    },
    dependencies.clock.now(),
  );

  if (!granted.ok) return 'refused';

  await dependencies.stores.entitlements.insert(transaction, granted.value);

  const written = await appendToLedger(transaction, dependencies, {
    tenantId: granted.value.tenantId,
    employmentId: granted.value.employmentId,
    leaveTypeId: granted.value.leaveTypeId,
    leaveYear: write.leaveYear,
    kind: 'accrual',
    minutes: write.minutes,
    effectiveOn: write.context.periodEnd,
    // Keyed on the entitlement, which is one per employment. Keying it on the run would make the
    // whole run a single ledger entry and skip everybody after the first.
    sourceKind: 'entitlement',
    sourceId: granted.value.id,
    leavePolicyId: write.context.policy.id,
  });

  if (!written.ok) return 'refused';

  return written.value.written ? 'written' : 'skipped';
};
