import type { Transaction } from '@work/kernel';

import { coversDate } from '../domain/plan-assignment.js';
import { InMemoryStore, scoped } from './in-memory-support.js';
import {
  InMemoryAdjustmentStore,
  InMemoryChangeStore,
  InMemoryDecisionStore,
  InMemoryOneTimeStore,
  InMemoryRecurringStore,
} from './in-memory-records.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState, PlanComponentTerms } from '../domain/compensation-plan.js';
import type { ImportBatchState } from '../domain/import-batch.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type { PayGradeState, SalaryStructureState } from '../domain/salary-structure.js';
import type { PayScaleState, SalaryStepState } from '../domain/pay-scale.js';
import type { CompensationStores } from './compensation-ports.js';

/**
 * The configuration stores, and the bundle that assembles all fourteen.
 *
 * Split from `in-memory-records.ts` because that file holds the four whose behaviour is
 * load-bearing — the authoritative records, the one-time items, the decisions and the history — and
 * mixing them with the configuration tables would bury the parts a reviewer should actually read.
 */

export class InMemoryPlanStore extends InMemoryStore<CompensationPlanState> {
  public byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CompensationPlanState | undefined> {
    return Promise.resolve(
      [...this.scoped(transaction).filter((row) => row.code === code)].sort(
        (left, right) => right.versionNumber - left.versionNumber,
      )[0],
    );
  }
}

export class InMemoryPlanComponentStore {
  public readonly rows: PlanComponentTerms[] = [];

  public forPlan(transaction: Transaction, planId: string): Promise<readonly PlanComponentTerms[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.compensationPlanId === planId),
    );
  }

  public insert(_transaction: Transaction, state: PlanComponentTerms): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

export class InMemoryPlanAssignmentStore extends InMemoryStore<PlanAssignmentState> {
  /**
   * Every assignment that could govern these scopes on this date.
   *
   * A tenant-scoped assignment matches whatever the scope list contains, because it applies to
   * everybody — which is why it is checked separately rather than by looking for its identifier.
   */
  public candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PlanAssignmentState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          coversDate(row, onDate) &&
          (row.scope === 'tenant' || (row.scopeId !== undefined && scopeIds.includes(row.scopeId))),
      ),
    );
  }

  public forPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<readonly PlanAssignmentState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.compensationPlanId === planId),
    );
  }
}

export class InMemoryStructureStore extends InMemoryStore<SalaryStructureState> {}

export class InMemoryGradeStore extends InMemoryStore<PayGradeState> {
  public forStructure(
    transaction: Transaction,
    salaryStructureId: string,
  ): Promise<readonly PayGradeState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.salaryStructureId === salaryStructureId),
    );
  }
}

export class InMemoryScaleStore extends InMemoryStore<PayScaleState> {
  public forGrade(transaction: Transaction, payGradeId: string): Promise<readonly PayScaleState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => row.payGradeId === payGradeId));
  }
}

export class InMemoryStepStore extends InMemoryStore<SalaryStepState> {
  public forParent(
    transaction: Transaction,
    parent: { readonly payScaleId?: string; readonly payGradeId?: string },
  ): Promise<readonly SalaryStepState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          (parent.payScaleId !== undefined && row.payScaleId === parent.payScaleId) ||
          (parent.payGradeId !== undefined && row.payGradeId === parent.payGradeId),
      ),
    );
  }
}

export class InMemoryComponentStore extends InMemoryStore<CompensationComponentState> {
  public byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CompensationComponentState | undefined> {
    return Promise.resolve(
      [...this.scoped(transaction).filter((row) => row.code === code)].sort(
        (left, right) => right.versionNumber - left.versionNumber,
      )[0],
    );
  }

  public byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly CompensationComponentState[]> {
    return Promise.resolve(this.scoped(transaction).filter((row) => ids.includes(row.id)));
  }
}

export class InMemoryImportBatchStore extends InMemoryStore<ImportBatchState> {
  public recent(transaction: Transaction, limit: number): Promise<readonly ImportBatchState[]> {
    return Promise.resolve(this.scoped(transaction).slice(-limit).reverse());
  }
}

/** All fourteen stores, assembled. What the application and API suites inject. */
export const inMemoryCompensationStores = (): CompensationStores => ({
  plans: new InMemoryPlanStore(),
  planComponents: new InMemoryPlanComponentStore(),
  planAssignments: new InMemoryPlanAssignmentStore(),
  structures: new InMemoryStructureStore(),
  grades: new InMemoryGradeStore(),
  scales: new InMemoryScaleStore(),
  steps: new InMemoryStepStore(),
  components: new InMemoryComponentStore(),
  recurring: new InMemoryRecurringStore(),
  oneTime: new InMemoryOneTimeStore(),
  adjustments: new InMemoryAdjustmentStore(),
  decisions: new InMemoryDecisionStore(),
  changes: new InMemoryChangeStore(),
  imports: new InMemoryImportBatchStore(),
});
