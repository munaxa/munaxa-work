import type { Transaction } from '@work/kernel';

import type { AdjustmentState } from '../domain/adjustment.js';
import type { ApprovalDecisionState } from '../domain/approval.js';
import type { CompensationChangeState } from '../domain/change-log.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState, PlanComponentTerms } from '../domain/compensation-plan.js';
import type { ImportBatchState } from '../domain/import-batch.js';
import type { OneTimeState } from '../domain/one-time.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type { RecurringState } from '../domain/recurring.js';
import type { PayGradeState, SalaryStructureState } from '../domain/salary-structure.js';
import type { PayScaleState, SalaryStepState } from '../domain/pay-scale.js';

/**
 * What the application layer needs from persistence, stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Every persistence method takes the `Transaction`, so a use case cannot
 * accidentally read outside the unit of work it is writing in.
 *
 * Two stores are deliberately **narrower than the rest**. `ChangeStore` and `DecisionStore` offer
 * `insert` and reads and nothing else — no `update`, no `remove` — because a compensation figure
 * somebody disputes is explained by those rows, and the cheapest guarantee that nobody rewrote one
 * is to have no method that could.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface PlanStore {
  byId(transaction: Transaction, id: string): Promise<CompensationPlanState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CompensationPlanState | undefined>;
  all(transaction: Transaction): Promise<readonly CompensationPlanState[]>;
  insert(transaction: Transaction, state: CompensationPlanState): Promise<void>;
  update(transaction: Transaction, state: CompensationPlanState, expected: number): Promise<void>;
}

export interface PlanComponentStore {
  forPlan(transaction: Transaction, planId: string): Promise<readonly PlanComponentTerms[]>;
  insert(transaction: Transaction, state: PlanComponentTerms): Promise<void>;
}

export interface PlanAssignmentStore {
  byId(transaction: Transaction, id: string): Promise<PlanAssignmentState | undefined>;
  /**
   * Every assignment that could govern these scopes on this date, **unranked**.
   *
   * Most-specific-wins is a domain rule, and a query that applied it in SQL would put the rule in
   * two places. The tenant-scoped rows are matched separately from the identified ones, because a
   * tenant assignment has no scope identifier and `scope_id = any(...)` would never match it.
   */
  candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PlanAssignmentState[]>;
  forPlan(transaction: Transaction, planId: string): Promise<readonly PlanAssignmentState[]>;
  insert(transaction: Transaction, state: PlanAssignmentState): Promise<void>;
}

export interface StructureStore {
  byId(transaction: Transaction, id: string): Promise<SalaryStructureState | undefined>;
  all(transaction: Transaction): Promise<readonly SalaryStructureState[]>;
  insert(transaction: Transaction, state: SalaryStructureState): Promise<void>;
  update(transaction: Transaction, state: SalaryStructureState, expected: number): Promise<void>;
}

export interface PayGradeStore {
  byId(transaction: Transaction, id: string): Promise<PayGradeState | undefined>;
  all(transaction: Transaction): Promise<readonly PayGradeState[]>;
  forStructure(
    transaction: Transaction,
    salaryStructureId: string,
  ): Promise<readonly PayGradeState[]>;
  insert(transaction: Transaction, state: PayGradeState): Promise<void>;
  update(transaction: Transaction, state: PayGradeState, expected: number): Promise<void>;
}

export interface PayScaleStore {
  byId(transaction: Transaction, id: string): Promise<PayScaleState | undefined>;
  all(transaction: Transaction): Promise<readonly PayScaleState[]>;
  forGrade(transaction: Transaction, payGradeId: string): Promise<readonly PayScaleState[]>;
  insert(transaction: Transaction, state: PayScaleState): Promise<void>;
}

export interface SalaryStepStore {
  byId(transaction: Transaction, id: string): Promise<SalaryStepState | undefined>;
  all(transaction: Transaction): Promise<readonly SalaryStepState[]>;
  forParent(
    transaction: Transaction,
    parent: { readonly payScaleId?: string; readonly payGradeId?: string },
  ): Promise<readonly SalaryStepState[]>;
  insert(transaction: Transaction, state: SalaryStepState): Promise<void>;
}

export interface ComponentStore {
  byId(transaction: Transaction, id: string): Promise<CompensationComponentState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<CompensationComponentState | undefined>;
  byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly CompensationComponentState[]>;
  all(transaction: Transaction): Promise<readonly CompensationComponentState[]>;
  insert(transaction: Transaction, state: CompensationComponentState): Promise<void>;
  update(
    transaction: Transaction,
    state: CompensationComponentState,
    expected: number,
  ): Promise<void>;
}

export interface RecurringQuery extends Paged {
  readonly employmentId?: string;
  readonly componentId?: string;
  readonly effectiveOn?: string;
}

/** A page of employments and a period — what the set-based payroll read takes. */
export interface PeriodQuery {
  readonly employmentIds: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface RecurringStore {
  byId(transaction: Transaction, id: string): Promise<RecurringState | undefined>;
  /** Every period for one employment, oldest first. What the history and timeline reads use. */
  forEmployment(transaction: Transaction, employmentId: string): Promise<readonly RecurringState[]>;
  /** Every period for one `(employment, component)`. What an amendment reads before it writes. */
  forComponent(
    transaction: Transaction,
    employmentId: string,
    componentId: string,
  ): Promise<readonly RecurringState[]>;
  /** The records in force on a date, across every component. One statement, one employment. */
  inForceOn(
    transaction: Transaction,
    employmentId: string,
    onDate: string,
  ): Promise<readonly RecurringState[]>;
  /**
   * **The set-based payroll read.**
   *
   * A page of employments resolved in one statement, not one timeline read per employment. The
   * alternative is 100,000 round trips per payroll run, and it is the read the no-projection
   * decision rests on (D-7).
   */
  overlappingPeriod(
    transaction: Transaction,
    query: PeriodQuery,
  ): Promise<readonly RecurringState[]>;
  /** What Payroll pulls to find retroactive corrections. System time, not business time. */
  recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly RecurringState[]>;
  /** The idempotency read an import makes before it writes. The unique index enforces it. */
  bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<RecurringState | undefined>;
  search(transaction: Transaction, query: RecurringQuery): Promise<Page<RecurringState>>;
  insert(transaction: Transaction, state: RecurringState): Promise<void>;
  /**
   * Closes a period, or records its approval.
   *
   * The **only** update this store offers, and the value columns are not among what it writes: an
   * end date, an approval state and an approval instant. There is no method that could change an
   * amount, a currency or an effective start.
   */
  update(transaction: Transaction, state: RecurringState, expected: number): Promise<void>;
}

export interface OneTimeQuery extends Paged {
  readonly employmentId?: string;
  readonly componentId?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
}

export interface OneTimeStore {
  byId(transaction: Transaction, id: string): Promise<OneTimeState | undefined>;
  payableWithin(transaction: Transaction, query: PeriodQuery): Promise<readonly OneTimeState[]>;
  recordedAfter(
    transaction: Transaction,
    recordedAfter: Date,
    period: { readonly from: string; readonly to: string },
    limit: number,
  ): Promise<readonly OneTimeState[]>;
  bySource(
    transaction: Transaction,
    source: {
      readonly source: string;
      readonly sourceId: string;
      readonly componentId: string;
      readonly employmentId: string;
    },
  ): Promise<OneTimeState | undefined>;
  search(transaction: Transaction, query: OneTimeQuery): Promise<Page<OneTimeState>>;
  insert(transaction: Transaction, state: OneTimeState): Promise<void>;
  update(transaction: Transaction, state: OneTimeState, expected: number): Promise<void>;
}

export interface AdjustmentQuery extends Paged {
  readonly employmentId?: string;
  readonly componentId?: string;
}

export interface AdjustmentStore {
  byId(transaction: Transaction, id: string): Promise<AdjustmentState | undefined>;
  search(transaction: Transaction, query: AdjustmentQuery): Promise<Page<AdjustmentState>>;
  insert(transaction: Transaction, state: AdjustmentState): Promise<void>;
  update(transaction: Transaction, state: AdjustmentState, expected: number): Promise<void>;
}

/**
 * Approval decisions: **inserted and read, and nothing else**.
 *
 * A wrong decision is corrected by a reversal naming the one it reverses. There is no `update` and
 * no `remove`, so an approval chain cannot be quietly rewritten to say somebody approved something
 * they did not.
 */
export interface DecisionStore {
  forSubject(
    transaction: Transaction,
    subjectKind: string,
    subjectId: string,
  ): Promise<readonly ApprovalDecisionState[]>;
  byId(transaction: Transaction, id: string): Promise<ApprovalDecisionState | undefined>;
  pendingCount(transaction: Transaction): Promise<number>;
  insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void>;
}

export interface ChangeQuery extends Paged {
  readonly employmentId?: string;
  readonly componentId?: string;
}

/** Compensation history: **inserted and read**. Append-only in the strongest sense available. */
export interface ChangeStore {
  forEmployment(
    transaction: Transaction,
    employmentId: string,
    paged: Paged,
  ): Promise<Page<CompensationChangeState>>;
  search(transaction: Transaction, query: ChangeQuery): Promise<Page<CompensationChangeState>>;
  insert(transaction: Transaction, state: CompensationChangeState): Promise<void>;
}

export interface ImportBatchStore {
  byId(transaction: Transaction, id: string): Promise<ImportBatchState | undefined>;
  recent(transaction: Transaction, limit: number): Promise<readonly ImportBatchState[]>;
  insert(transaction: Transaction, state: ImportBatchState): Promise<void>;
  update(transaction: Transaction, state: ImportBatchState, expected: number): Promise<void>;
}

/** Everything this module's use cases persist, in one injectable bundle — all fourteen. */
export interface CompensationStores {
  readonly plans: PlanStore;
  readonly planComponents: PlanComponentStore;
  readonly planAssignments: PlanAssignmentStore;
  readonly structures: StructureStore;
  readonly grades: PayGradeStore;
  readonly scales: PayScaleStore;
  readonly steps: SalaryStepStore;
  readonly components: ComponentStore;
  readonly recurring: RecurringStore;
  readonly oneTime: OneTimeStore;
  readonly adjustments: AdjustmentStore;
  readonly decisions: DecisionStore;
  readonly changes: ChangeStore;
  readonly imports: ImportBatchStore;
}
