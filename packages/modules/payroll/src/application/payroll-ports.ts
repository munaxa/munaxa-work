import type { Transaction } from '@work/kernel';

import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { ApprovalDecisionState } from '../domain/payroll-approval.js';
import type { PayrollAdjustmentState } from '../domain/payroll-adjustment.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type {
  DeductionLine,
  EarningLine,
  PayrollExceptionState,
  PayrollResultState,
} from '../domain/payroll-lines.js';
import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type { EmploymentSnapshot } from '../domain/payroll-snapshot.js';

/**
 * What the application layer needs from persistence, stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case here be tested against fakes with no database
 * present. Every method takes the `Transaction`, so a use case cannot accidentally read outside the
 * unit of work it is writing in.
 *
 * Several stores are **deliberately narrower than the rest**. `SnapshotStore`, `ResultStore`,
 * `EarningLineStore`, `DeductionLineStore`, `DecisionStore`, `ReconciliationStore`,
 * `AccountingStore` and `PaymentStore` offer inserts, reads and a `finalize` — and **no general
 * `update` and no `remove`**. A payslip somebody disputes is explained by those rows, and the
 * cheapest guarantee that nobody rewrote one is to have no method that could. The database refuses
 * it too (ADR-0066); this is the same rule expressed where a developer meets it first.
 *
 * The writes are **batched** throughout: `insertMany` rather than `insert` in a loop. At a hundred
 * thousand employments the difference is not a percentage.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface GroupStore {
  byId(transaction: Transaction, id: string): Promise<PayrollGroupState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<PayrollGroupState | undefined>;
  all(transaction: Transaction): Promise<readonly PayrollGroupState[]>;
  insert(transaction: Transaction, state: PayrollGroupState): Promise<void>;
  update(transaction: Transaction, state: PayrollGroupState, expected: number): Promise<void>;
}

export interface DeductionDefinitionStore {
  byId(transaction: Transaction, id: string): Promise<DeductionDefinitionState | undefined>;
  forGroup(transaction: Transaction, groupId: string): Promise<readonly DeductionDefinitionState[]>;
  insert(transaction: Transaction, state: DeductionDefinitionState): Promise<void>;
  update(
    transaction: Transaction,
    state: DeductionDefinitionState,
    expected: number,
  ): Promise<void>;
}

export interface PeriodStore {
  byId(transaction: Transaction, id: string): Promise<PayrollPeriodState | undefined>;
  forGroup(transaction: Transaction, groupId: string): Promise<readonly PayrollPeriodState[]>;
  page(transaction: Transaction, paged: Paged): Promise<Page<PayrollPeriodState>>;
  insert(transaction: Transaction, state: PayrollPeriodState): Promise<void>;
  update(transaction: Transaction, state: PayrollPeriodState, expected: number): Promise<void>;
}

export interface RunStore {
  byId(transaction: Transaction, id: string): Promise<PayrollRunState | undefined>;
  forPeriod(transaction: Transaction, periodId: string): Promise<readonly PayrollRunState[]>;
  page(transaction: Transaction, paged: Paged): Promise<Page<PayrollRunState>>;
  insert(transaction: Transaction, state: PayrollRunState): Promise<void>;
  update(transaction: Transaction, state: PayrollRunState, expected: number): Promise<void>;
  /** Stamps `finalized_at` across every row of the run, in one statement per table. */
  finalize(transaction: Transaction, runId: string, moment: Date): Promise<void>;
}

export interface SnapshotStore {
  forRun(transaction: Transaction, runId: string): Promise<readonly EmploymentSnapshot[]>;
  forEmployment(
    transaction: Transaction,
    runId: string,
    employmentId: string,
  ): Promise<EmploymentSnapshot | undefined>;
  /** The digests as stored, for reconciliation to compare without loading the payloads. */
  digestsFor(transaction: Transaction, runId: string): Promise<ReadonlyMap<string, StoredDigests>>;
  insertMany(
    transaction: Transaction,
    runId: string,
    snapshots: readonly EmploymentSnapshot[],
  ): Promise<void>;
  /**
   * Removes the snapshots a named set of employments produced in this run.
   *
   * Called before every batch's inserts, for the same reason the result store has one: a
   * recalculation must **replace** what it consumed rather than insert alongside it, or
   * `payroll_input_snapshot_unique_idx` raises 23505 and — worse, where a fake does not enforce
   * that index — the persisted snapshot stops matching the result it explains, which is the
   * property the whole reproducibility argument rests on.
   */
  clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void>;
}

export interface StoredDigests {
  readonly employmentVersion?: number;
  readonly compensationDigest?: string;
  readonly attendanceDigest?: string;
  readonly attendanceSequence?: number;
  readonly leaveDigest?: string;
  readonly snapshotDigest: string;
}

export interface ResultStore {
  byId(transaction: Transaction, id: string): Promise<PayrollResultState | undefined>;
  forRun(transaction: Transaction, runId: string, paged: Paged): Promise<Page<PayrollResultState>>;
  forEmployment(
    transaction: Transaction,
    runId: string,
    employmentId: string,
  ): Promise<readonly PayrollResultState[]>;
  insertMany(transaction: Transaction, results: readonly PayrollResultState[]): Promise<void>;
  /** Removes the results of a run **that is not finalized**, so a recalculation can replace them. */
  clearRun(transaction: Transaction, runId: string): Promise<void>;
  /**
   * Removes the rows a **named set of employments** produced in this run, so a recalculation
   * replaces them instead of inserting alongside them.
   *
   * Called before every batch's inserts. On a first pass it matches nothing; on a recalculation it
   * is what stops `payroll_result_unique_idx` being violated and — where a fake does not enforce
   * that index — what stops one person holding two results for one run. Narrow by design (D-14):
   * an employment that did not go stale is never touched.
   */
  clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void>;
}

export interface EarningLineStore {
  forResult(transaction: Transaction, resultId: string): Promise<readonly EarningLine[]>;
  insertMany(
    transaction: Transaction,
    runId: string,
    lines: readonly ResultLine<EarningLine>[],
  ): Promise<void>;
  clearRun(transaction: Transaction, runId: string): Promise<void>;
  /** As `clearRun`, for a named set of employments only. Called before every batch's inserts. */
  clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void>;
}

export interface DeductionLineStore {
  forResult(transaction: Transaction, resultId: string): Promise<readonly DeductionLine[]>;
  insertMany(
    transaction: Transaction,
    runId: string,
    lines: readonly ResultLine<DeductionLine>[],
  ): Promise<void>;
  clearRun(transaction: Transaction, runId: string): Promise<void>;
  /** As `clearRun`, for a named set of employments only. Called before every batch's inserts. */
  clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void>;
}

/** A line and the result it belongs to, so the batch insert needs no second lookup. */
export interface ResultLine<TLine> {
  readonly resultId: string;
  readonly line: TLine;
}

export interface ExceptionStore {
  forRun(transaction: Transaction, runId: string): Promise<readonly PayrollExceptionState[]>;
  insertMany(transaction: Transaction, exceptions: readonly PayrollExceptionState[]): Promise<void>;
  clearRun(transaction: Transaction, runId: string): Promise<void>;
  /** As `clearRun`, for a named set of employments only. Called before every batch's inserts. */
  clearEmployments(
    transaction: Transaction,
    runId: string,
    employmentIds: readonly string[],
  ): Promise<void>;
}

export interface AdjustmentStore {
  byId(transaction: Transaction, id: string): Promise<PayrollAdjustmentState | undefined>;
  forRun(transaction: Transaction, runId: string): Promise<readonly PayrollAdjustmentState[]>;
  insert(transaction: Transaction, state: PayrollAdjustmentState): Promise<void>;
}

export interface DecisionStore {
  forRun(transaction: Transaction, runId: string): Promise<readonly ApprovalDecisionState[]>;
  byId(transaction: Transaction, id: string): Promise<ApprovalDecisionState | undefined>;
  insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void>;
}

export interface ReconciliationRecord {
  readonly payrollRunId: string;
  readonly employmentId: string;
  readonly staleSource: string;
  readonly previousDigest?: string;
  readonly currentDigest?: string;
  readonly detectedAt: Date;
}

export interface ReconciliationStore {
  forRun(transaction: Transaction, runId: string): Promise<readonly ReconciliationRecord[]>;
  insertMany(transaction: Transaction, records: readonly ReconciliationRecord[]): Promise<void>;
}

export interface AccountingStore {
  forRun(transaction: Transaction, runId: string, paged: Paged): Promise<Page<AccountingLine>>;
  insertMany(transaction: Transaction, lines: readonly AccountingLine[]): Promise<void>;
}

export interface PaymentStore {
  forRun(transaction: Transaction, runId: string, paged: Paged): Promise<Page<PaymentInstruction>>;
  insertMany(transaction: Transaction, instructions: readonly PaymentInstruction[]): Promise<void>;
}

export interface DashboardCounts {
  readonly openPeriods: number;
  readonly runsAwaitingApproval: number;
  readonly staleRuns: number;
  readonly unresolvedExceptions: number;
  readonly finalizedThisMonth: number;
  readonly groupsConfigured: number;
}

export interface DashboardStore {
  counts(transaction: Transaction): Promise<DashboardCounts>;
}

export interface PayrollStores {
  readonly groups: GroupStore;
  readonly deductionDefinitions: DeductionDefinitionStore;
  readonly periods: PeriodStore;
  readonly runs: RunStore;
  readonly snapshots: SnapshotStore;
  readonly results: ResultStore;
  readonly earnings: EarningLineStore;
  readonly deductions: DeductionLineStore;
  readonly exceptions: ExceptionStore;
  readonly adjustments: AdjustmentStore;
  readonly decisions: DecisionStore;
  readonly reconciliations: ReconciliationStore;
  readonly accounting: AccountingStore;
  readonly payments: PaymentStore;
  readonly dashboard: DashboardStore;
}
