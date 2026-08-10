import { uuidV7, type Transaction } from '@work/kernel';

import { calculateEmployment, type CalculationPolicy } from '../domain/payroll-calculation.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type {
  DeductionLine,
  EarningLine,
  PayrollExceptionState,
  PayrollResultState,
} from '../domain/payroll-lines.js';
import type { EmploymentSnapshot } from '../domain/payroll-snapshot.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type { ResultLine } from './payroll-ports.js';
import { captureSnapshots, eligibilityOf } from './snapshot-capture.js';
import type { PeriodWindow } from './cross-module-ports.js';

/**
 * One batch of a run: capture, calculate, persist — **in one transaction, for a bounded page**.
 *
 * This is where D-14's answer lives. A hundred-thousand-employee run is two hundred of these rather
 * than one enormous transaction, so peak memory is a function of the batch size and not of the
 * tenant, and a failure at employee sixty thousand resumes rather than restarts.
 *
 * The order inside a batch is four source reads, one pure calculation pass, and four batched
 * inserts. Nothing here reads a source per employment and nothing inserts a row at a time.
 */

/** Tuned by benchmark. Large enough that the per-batch overhead disappears, small enough to hold. */
export const BATCH_SIZE = 500;

export interface BatchRequest {
  readonly group: PayrollGroupState;
  readonly period: PeriodWindow;
  readonly payrollRunId: string;
  readonly employmentIds: readonly string[];
  readonly definitions: readonly DeductionDefinitionState[];
  readonly countryCode?: string;
  readonly moment: Date;
}

export interface BatchOutcome {
  readonly snapshots: readonly EmploymentSnapshot[];
  readonly results: readonly PayrollResultState[];
  readonly exceptions: readonly PayrollExceptionState[];
}

/**
 * Capture, select, calculate, persist.
 *
 * Population is resolved **from the snapshot rather than before it**, which is one source read
 * instead of two: the employment facts the eligibility rule needs are the same facts the
 * calculation needs. Only the selected employments' snapshots are persisted — somebody the group
 * does not cover is not part of this run and should leave no row suggesting they were considered
 * and paid nothing.
 */
export const calculateBatch = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  request: BatchRequest,
): Promise<BatchOutcome> => {
  const captured = await captureSnapshots(dependencies, {
    group: request.group,
    period: request.period,
    employmentIds: request.employmentIds,
    capturedAt: request.moment,
  });
  const selected = select(request, captured);
  const outcome = computeAll(dependencies, request, selected.snapshots);
  const exceptions = [...selected.exceptions, ...outcome.exceptions];

  await persist(dependencies, transaction, request, selected.snapshots, {
    ...outcome,
    exceptions,
  });
  return { snapshots: selected.snapshots, results: outcome.results, exceptions };
};

interface Selection {
  readonly snapshots: readonly EmploymentSnapshot[];
  readonly exceptions: readonly PayrollExceptionState[];
}

/**
 * Who this run covers, by the group's versioned rule (D-18).
 *
 * An employment whose facts could not be read is **an exception, not an exclusion** — the group's
 * rule cannot be applied to somebody Employment did not answer for, and dropping them silently
 * would shrink a payroll without anybody noticing.
 */
const select = (request: BatchRequest, captured: readonly EmploymentSnapshot[]): Selection => {
  const snapshots: EmploymentSnapshot[] = [];
  const exceptions: PayrollExceptionState[] = [];

  for (const snapshot of captured) {
    const employment = snapshot.employment;

    if (employment === undefined) {
      exceptions.push(exceptionFor(request, snapshot.employmentId, 'employment_unresolved'));
      continue;
    }

    const eligibility = eligibilityOf(request.group, {
      status: employment.status,
      employmentTypeCode: employment.employmentTypeCode,
      startedBeforePeriodEnd: employment.startDate <= request.period.periodEnd,
      endedBeforePeriodStart:
        employment.endDate !== undefined && employment.endDate < request.period.periodStart,
    });

    if (eligibility === 'included') snapshots.push(snapshot);
    else if (eligibility === 'rule_failed') {
      exceptions.push(exceptionFor(request, snapshot.employmentId, 'eligibility_rule_failed'));
    }
  }

  return { snapshots, exceptions };
};

interface Computed {
  readonly results: readonly PayrollResultState[];
  readonly exceptions: readonly PayrollExceptionState[];
  readonly earnings: readonly ResultLine<EarningLine>[];
  readonly deductions: readonly ResultLine<DeductionLine>[];
}

/** The pure part: no database, no source call, no clock beyond the one the caller already read. */
const computeAll = (
  dependencies: PayrollDependencies,
  request: BatchRequest,
  snapshots: readonly EmploymentSnapshot[],
): Computed => {
  const results: PayrollResultState[] = [];
  const exceptions: PayrollExceptionState[] = [];
  const earnings: ResultLine<EarningLine>[] = [];
  const deductions: ResultLine<DeductionLine>[] = [];

  for (const snapshot of snapshots) {
    const outcome = calculateEmployment({
      period: request.period,
      snapshot,
      policy: policyFor(request),
      definitions: request.definitions,
      countryRules: dependencies.countryRules,
      payrollRunId: request.payrollRunId,
      identifier: () => uuidV7(),
    });

    if (!outcome.ok) {
      exceptions.push(exceptionFor(request, snapshot.employmentId, outcome.error.reason));
      continue;
    }
    for (const result of outcome.value.results) {
      results.push(result);
      earnings.push(...result.earnings.map((line) => ({ resultId: result.payrollResultId, line })));
      deductions.push(
        ...result.deductions.map((line) => ({ resultId: result.payrollResultId, line })),
      );
    }
    for (const exception of outcome.value.exceptions) {
      exceptions.push(
        exceptionFor(request, snapshot.employmentId, exception.code, exception.detail),
      );
    }
  }

  return { results, exceptions, earnings, deductions };
};

const policyFor = (request: BatchRequest): CalculationPolicy => ({
  basis: request.group.prorationBasis,
  rounding: request.group.roundingMode,
  permittedCurrencies: request.group.permittedCurrencies,
  ...(request.countryCode === undefined ? {} : { countryCode: request.countryCode }),
});

const exceptionFor = (
  request: BatchRequest,
  employmentId: string,
  exceptionCode: string,
  detail?: Readonly<Record<string, string>>,
): PayrollExceptionState => ({
  payrollExceptionId: uuidV7(),
  payrollRunId: request.payrollRunId,
  employmentId,
  exceptionCode,
  ...(detail === undefined ? {} : { detail }),
});

/** Four batched inserts. Never one row at a time, at any scale. */
const persist = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  request: BatchRequest,
  snapshots: readonly EmploymentSnapshot[],
  computed: Computed,
): Promise<void> => {
  await dependencies.stores.snapshots.insertMany(transaction, request.payrollRunId, snapshots);
  await dependencies.stores.results.insertMany(transaction, computed.results);
  await dependencies.stores.earnings.insertMany(
    transaction,
    request.payrollRunId,
    computed.earnings,
  );
  await dependencies.stores.deductions.insertMany(
    transaction,
    request.payrollRunId,
    computed.deductions,
  );
  await dependencies.stores.exceptions.insertMany(transaction, computed.exceptions);
};
