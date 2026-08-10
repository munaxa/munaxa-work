import type { PayrollRunState } from '../domain/payroll-run.js';
import type { RunKind, RunStatus } from '../domain/payroll-vocabulary.js';
import type {
  AttendanceFacts,
  CompensationFacts,
  EmploymentFacts,
  EmploymentSnapshot,
  LeaveFacts,
} from '../domain/payroll-snapshot.js';
import type { StoredDigests } from '../application/payroll-ports.js';
import { asNumber, orNull, type RowValues } from './row-writer.js';

/** Rows to state and back, for the run and the snapshot. `version` never appears in a values map. */

export interface PayrollRunRow {
  readonly id: string;
  readonly payroll_period_id: string;
  readonly payroll_group_id: string;
  readonly run_sequence: number;
  readonly run_kind: string;
  readonly status: string;
  readonly calculation_version: number;
  readonly rule_set_digest: string;
  readonly population_digest: string | null;
  readonly snapshot_digest: string | null;
  readonly eligibility_rule_version: number;
  readonly country_pack_id: string | null;
  readonly country_pack_version: number | null;
  readonly cursor_employment_id: string | null;
  readonly population_size: number;
  readonly result_count: number;
  readonly exception_count: number;
  readonly stale_count: number;
  readonly calculated_at: Date | null;
  readonly calculated_by: string | null;
  readonly approved_at: Date | null;
  readonly approved_by: string | null;
  readonly finalized_at: Date | null;
  readonly finalized_by: string | null;
  readonly reversal_of_run_id: string | null;
  readonly reversed_at: Date | null;
  readonly reversed_by: string | null;
  readonly stale_detected_at: Date | null;
  readonly accounting_prepared_at: Date | null;
  readonly payment_prepared_at: Date | null;
  readonly failure_reason: string | null;
  readonly version: number;
}

const present = <TKey extends string, TValue>(
  key: TKey,
  value: TValue | null,
): Partial<Record<TKey, TValue>> =>
  value === null ? {} : ({ [key]: value } as Record<TKey, TValue>);

export const runState = (row: PayrollRunRow): PayrollRunState => ({
  payrollRunId: row.id,
  payrollPeriodId: row.payroll_period_id,
  payrollGroupId: row.payroll_group_id,
  runSequence: asNumber(row.run_sequence),
  runKind: row.run_kind as RunKind,
  status: row.status as RunStatus,
  calculationVersion: asNumber(row.calculation_version),
  ruleSetDigest: row.rule_set_digest,
  eligibilityRuleVersion: asNumber(row.eligibility_rule_version),
  populationSize: asNumber(row.population_size),
  resultCount: asNumber(row.result_count),
  exceptionCount: asNumber(row.exception_count),
  staleCount: asNumber(row.stale_count),
  version: asNumber(row.version),
  ...present('populationDigest', row.population_digest),
  ...present('snapshotDigest', row.snapshot_digest),
  ...present('countryPackId', row.country_pack_id),
  ...present('countryPackVersion', row.country_pack_version),
  ...present('cursor', row.cursor_employment_id),
  ...present('calculatedAt', row.calculated_at),
  ...present('calculatedBy', row.calculated_by),
  ...present('approvedAt', row.approved_at),
  ...present('approvedBy', row.approved_by),
  ...present('finalizedAt', row.finalized_at),
  ...present('finalizedBy', row.finalized_by),
  ...present('reversalOfRunId', row.reversal_of_run_id),
  ...present('reversedAt', row.reversed_at),
  ...present('reversedBy', row.reversed_by),
  ...present('staleDetectedAt', row.stale_detected_at),
  ...present('accountingPreparedAt', row.accounting_prepared_at),
  ...present('paymentPreparedAt', row.payment_prepared_at),
  ...present('failureReason', row.failure_reason),
});

export const runValues = (state: PayrollRunState, tenantId: string): RowValues => ({
  id: state.payrollRunId,
  tenant_id: tenantId,
  payroll_period_id: state.payrollPeriodId,
  payroll_group_id: state.payrollGroupId,
  run_sequence: state.runSequence,
  run_kind: state.runKind,
  status: state.status,
  calculation_version: state.calculationVersion,
  rule_set_digest: state.ruleSetDigest,
  population_digest: orNull(state.populationDigest),
  snapshot_digest: orNull(state.snapshotDigest),
  eligibility_rule_version: state.eligibilityRuleVersion,
  country_pack_id: orNull(state.countryPackId),
  country_pack_version: orNull(state.countryPackVersion),
  cursor_employment_id: orNull(state.cursor),
  population_size: state.populationSize,
  result_count: state.resultCount,
  exception_count: state.exceptionCount,
  stale_count: state.staleCount,
  calculated_at: orNull(state.calculatedAt),
  calculated_by: orNull(state.calculatedBy),
  approved_at: orNull(state.approvedAt),
  approved_by: orNull(state.approvedBy),
  finalized_at: orNull(state.finalizedAt),
  finalized_by: orNull(state.finalizedBy),
  reversal_of_run_id: orNull(state.reversalOfRunId),
  reversed_at: orNull(state.reversedAt),
  reversed_by: orNull(state.reversedBy),
  stale_detected_at: orNull(state.staleDetectedAt),
  accounting_prepared_at: orNull(state.accountingPreparedAt),
  payment_prepared_at: orNull(state.paymentPreparedAt),
  failure_reason: orNull(state.failureReason),
});

export interface SnapshotRow {
  readonly id: string;
  readonly payroll_run_id: string;
  readonly employment_id: string;
  readonly employment_facts: EmploymentFacts | null;
  readonly compensation_facts: SerializedCompensation | null;
  readonly attendance_facts: SerializedAttendance | null;
  readonly leave_facts: LeaveFacts | null;
  readonly employment_version: number | null;
  readonly compensation_digest: string | null;
  readonly compensation_version: number | null;
  readonly attendance_digest: string | null;
  readonly attendance_sequence: number | null;
  readonly leave_digest: string | null;
  readonly leave_version: number | null;
  readonly snapshot_digest: string;
  readonly eligibility_rule_version: number;
  readonly captured_at: Date;
  readonly finalized_at: Date | null;
  readonly version: number;
}

/**
 * The compensation payload as `jsonb` holds it: **every amount a decimal string**.
 *
 * `bigint` has no JSON representation, so the amounts are serialized as strings on the way in and
 * parsed with `BigInt` on the way out. That is not a workaround — it is the same discipline the
 * columns follow, and it is what keeps a snapshot exact above 2^53 through a round trip.
 */
interface SerializedCompensation extends Omit<CompensationFacts, 'currencies'> {
  readonly currencies: readonly SerializedCurrency[];
}

interface SerializedCurrency {
  readonly currencyCode: string;
  readonly currencyExponent: number;
  readonly recurring: readonly SerializedComponent[];
  readonly oneTime: readonly SerializedOneTime[];
}

interface SerializedAmount {
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

type SerializedComponent = Omit<
  CompensationFacts['currencies'][number]['recurring'][number],
  'amount'
> & { readonly amount: SerializedAmount };

type SerializedOneTime = Omit<
  CompensationFacts['currencies'][number]['oneTime'][number],
  'amount'
> & { readonly amount: SerializedAmount };

type SerializedAttendance = Omit<AttendanceFacts, 'frozenAt'> & { readonly frozenAt: string };

export const snapshotState = (row: SnapshotRow): EmploymentSnapshot => ({
  employmentId: row.employment_id,
  ...present('employment', row.employment_facts),
  ...(row.compensation_facts === null
    ? {}
    : { compensation: parsedCompensation(row.compensation_facts) }),
  ...(row.attendance_facts === null
    ? {}
    : {
        attendance: { ...row.attendance_facts, frozenAt: new Date(row.attendance_facts.frozenAt) },
      }),
  ...present('leave', row.leave_facts),
  capturedAt: row.captured_at,
});

const parsedCompensation = (facts: SerializedCompensation): CompensationFacts => ({
  ...facts,
  currencies: facts.currencies.map((block) => ({
    ...block,
    recurring: block.recurring.map((component) => ({
      ...component,
      amount: parsedAmount(component.amount),
    })),
    oneTime: block.oneTime.map((item) => ({ ...item, amount: parsedAmount(item.amount) })),
  })),
});

const parsedAmount = (
  amount: SerializedAmount,
): { amountMinor: bigint; currencyCode: string; currencyExponent: number } => ({
  amountMinor: BigInt(amount.amountMinor),
  currencyCode: amount.currencyCode,
  currencyExponent: amount.currencyExponent,
});

export const snapshotDigests = (row: SnapshotRow): StoredDigests => ({
  ...present('employmentVersion', row.employment_version),
  ...present('compensationDigest', row.compensation_digest),
  ...present('attendanceDigest', row.attendance_digest),
  ...present('attendanceSequence', row.attendance_sequence),
  ...present('leaveDigest', row.leave_digest),
  snapshotDigest: row.snapshot_digest,
});
