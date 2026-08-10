import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import { RUN_TRANSITIONS, type RunKind, type RunStatus } from './payroll-vocabulary.js';

/**
 * A payroll run: **one auditable execution**, not a batch identifier.
 *
 * It names what was calculated, under which rules, from which inputs, by whom, and what happened to
 * it afterwards. Everything needed to answer "why did this person receive this amount" hangs off a
 * run, and everything needed to answer "and why can we still answer that" — the calculation
 * version, the rule-set digest, the snapshot digest, the country pack version — is on the run row
 * itself rather than resolved from configuration that has since changed.
 *
 * `cursor` is what makes a hundred-thousand-employee run survivable. The run is processed in
 * bounded batches, each in its own transaction, and the cursor is how the next batch knows where to
 * resume after a failure. A run whose cursor has not reached the end is **not `calculated`**, and
 * therefore cannot be approved — a partial payroll must never look like a complete one.
 */

export interface PayrollRunState {
  readonly payrollRunId: string;
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly runSequence: number;
  readonly runKind: RunKind;
  readonly status: RunStatus;
  readonly calculationVersion: number;
  readonly ruleSetDigest: string;
  readonly populationDigest?: string;
  readonly snapshotDigest?: string;
  readonly eligibilityRuleVersion: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  /** The employment the next batch resumes from. Absent once the run has covered everybody. */
  readonly cursor?: string;
  readonly populationSize: number;
  readonly resultCount: number;
  readonly exceptionCount: number;
  readonly staleCount: number;
  readonly calculatedAt?: Date;
  readonly calculatedBy?: string;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly finalizedAt?: Date;
  readonly finalizedBy?: string;
  readonly reversalOfRunId?: string;
  readonly reversedAt?: Date;
  readonly reversedBy?: string;
  readonly staleDetectedAt?: Date;
  readonly accountingPreparedAt?: Date;
  readonly paymentPreparedAt?: Date;
  readonly failureReason?: string;
  readonly version: number;
}

export interface StartPayrollRun {
  readonly payrollRunId: string;
  readonly payrollPeriodId: string;
  readonly payrollGroupId: string;
  readonly runSequence: number;
  readonly runKind: RunKind;
  readonly calculationVersion: number;
  readonly ruleSetDigest: string;
  readonly eligibilityRuleVersion: number;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly reversalOfRunId?: string;
}

export const createPayrollRun = (command: StartPayrollRun): PayrollRunState => ({
  payrollRunId: command.payrollRunId,
  payrollPeriodId: command.payrollPeriodId,
  payrollGroupId: command.payrollGroupId,
  runSequence: command.runSequence,
  runKind: command.runKind,
  status: 'draft',
  calculationVersion: command.calculationVersion,
  ruleSetDigest: command.ruleSetDigest,
  eligibilityRuleVersion: command.eligibilityRuleVersion,
  ...(command.countryPackId === undefined ? {} : { countryPackId: command.countryPackId }),
  ...(command.countryPackVersion === undefined
    ? {}
    : { countryPackVersion: command.countryPackVersion }),
  ...(command.reversalOfRunId === undefined ? {} : { reversalOfRunId: command.reversalOfRunId }),
  populationSize: 0,
  resultCount: 0,
  exceptionCount: 0,
  staleCount: 0,
  version: 1,
});

/** A status change, checked against the transition table. The refusal names both ends. */
export const moveRunTo = (
  state: PayrollRunState,
  status: RunStatus,
): PayrollResult<PayrollRunState> => {
  if (!RUN_TRANSITIONS[state.status].includes(status)) {
    return refuse('run_transition_not_permitted', { from: state.status, to: status });
  }
  return accept({ ...state, status, version: state.version + 1 });
};

/**
 * A run is only `calculated` when the cursor has covered the whole population.
 *
 * The check is here rather than at the call site because it is the invariant that stops a partial
 * run being approved, and an invariant enforced in one place is one that cannot be forgotten in
 * another.
 */
export const completeCalculation = (
  state: PayrollRunState,
  totals: {
    readonly populationDigest: string;
    readonly snapshotDigest: string;
    readonly populationSize: number;
    readonly resultCount: number;
    readonly exceptionCount: number;
  },
  moment: Date,
  actor: string,
): PayrollResult<PayrollRunState> => {
  const moved = moveRunTo(state, 'calculated');

  if (!moved.ok) return moved;

  const { cursor: _covered, ...withoutCursor } = moved.value;

  return accept({
    ...withoutCursor,
    populationDigest: totals.populationDigest,
    snapshotDigest: totals.snapshotDigest,
    populationSize: totals.populationSize,
    resultCount: totals.resultCount,
    exceptionCount: totals.exceptionCount,
    calculatedAt: moment,
    calculatedBy: actor,
  });
};

export const markRunStale = (
  state: PayrollRunState,
  staleCount: number,
  moment: Date,
): PayrollResult<PayrollRunState> => {
  const moved = moveRunTo(state, 'stale');

  if (!moved.ok) return moved;
  return accept({ ...moved.value, staleCount, staleDetectedAt: moment });
};

/**
 * Approval, and the two things that make it a record rather than a formality.
 *
 * The actor comes from the authenticated context, and a run in `stale` cannot be approved — the
 * whole point of detecting staleness is that nobody signs off figures whose inputs have moved.
 */
export const approveRun = (
  state: PayrollRunState,
  moment: Date,
  actor: string,
): PayrollResult<PayrollRunState> => {
  if (state.exceptionCount > 0 && state.resultCount === 0) return refuse('run_has_no_results');

  const moved = moveRunTo(state, 'approved');

  if (!moved.ok) return moved;
  return accept({ ...moved.value, approvedAt: moment, approvedBy: actor });
};

/**
 * Finalization: the strong boundary.
 *
 * After this the run's results and lines are immutable, and every path that could edit them refuses.
 * A run carrying unresolved exceptions cannot be finalized, because finalizing is the statement
 * that these figures are the ones to act on.
 */
export const finalizeRun = (
  state: PayrollRunState,
  moment: Date,
  actor: string,
): PayrollResult<PayrollRunState> => {
  if (state.exceptionCount > 0) {
    return refuse('run_has_unresolved_exceptions', { count: String(state.exceptionCount) });
  }

  const moved = moveRunTo(state, 'finalized');

  if (!moved.ok) return moved;

  return accept({
    ...moved.value,
    finalizedAt: moment,
    finalizedBy: actor,
    accountingPreparedAt: moment,
    paymentPreparedAt: moment,
  });
};

export const reverseRun = (
  state: PayrollRunState,
  moment: Date,
  actor: string,
): PayrollResult<PayrollRunState> => {
  const moved = moveRunTo(state, 'reversed');

  if (!moved.ok) return moved;
  return accept({ ...moved.value, reversedAt: moment, reversedBy: actor });
};

/** Whether a run's figures are frozen. The one predicate every write path consults. */
export const isFinalized = (state: PayrollRunState): boolean =>
  state.status === 'finalized' || state.status === 'reversed';
