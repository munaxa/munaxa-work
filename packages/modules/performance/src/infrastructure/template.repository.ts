import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type {
  GoalCategoryState,
  GoalCategoryStore,
  TemplateStore,
} from '../application/performance-ports.js';
import {
  goalCategoryState,
  goalCategoryValues,
  templateComponentState,
  templateComponentValues,
  templateState,
  templateValues,
  type GoalCategoryRow,
  type TemplateComponentRow,
  type TemplateRow,
} from './configuration-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * Goal categories and review templates.
 *
 * **A template is written whole, with its components, in one call.** The rule that the components
 * must total 10,000 basis points is about the *set*, so a template readable with half its
 * components would be readable in a state the scoring engine refuses — and a review scored in that
 * instant would get a number nobody could account for.
 */

export class PostgresGoalCategoryRepository
  extends Repository<GoalCategoryRow & { version: number }>
  implements GoalCategoryStore
{
  public constructor() {
    super('performance_goal_category');
  }

  public async byId(transaction: Transaction, id: string): Promise<GoalCategoryState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : goalCategoryState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<GoalCategoryState | undefined> {
    const rows = await transaction.execute<GoalCategoryRow>(
      `select * from performance_goal_category
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : goalCategoryState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly GoalCategoryState[]> {
    const rows = await transaction.execute<GoalCategoryRow>(
      `select * from performance_goal_category
         where tenant_id = $1 and deleted_at is null
         order by code`,
      [transaction.tenantId],
    );

    return rows.map(goalCategoryState);
  }

  public insert(transaction: Transaction, state: GoalCategoryState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      goalCategoryValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: GoalCategoryState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.goalCategoryId,
      expected,
      mutable(goalCategoryValues(state, transaction.tenantId)),
    );
  }
}

export class PostgresTemplateRepository
  extends Repository<TemplateRow & { version: number }>
  implements TemplateStore
{
  public constructor() {
    super('performance_review_template');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ReviewTemplateState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : templateState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<ReviewTemplateState | undefined> {
    const rows = await transaction.execute<TemplateRow>(
      `select * from performance_review_template
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : templateState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly ReviewTemplateState[]> {
    const rows = await transaction.execute<TemplateRow>(
      `select * from performance_review_template
         where tenant_id = $1 and deleted_at is null
         order by code`,
      [transaction.tenantId],
    );

    return rows.map(templateState);
  }

  public async componentsFor(
    transaction: Transaction,
    templateId: string,
  ): Promise<readonly TemplateComponentState[]> {
    const rows = await transaction.execute<TemplateComponentRow>(
      `select * from performance_review_template_component
         where tenant_id = $1 and template_id = $2 and deleted_at is null
         order by component`,
      [transaction.tenantId, templateId],
    );

    return rows.map(templateComponentState);
  }

  public async insert(
    transaction: Transaction,
    template: ReviewTemplateState,
    components: readonly TemplateComponentState[],
  ): Promise<void> {
    const now = new Date();

    await insertRow(transaction, this.table, templateValues(template, transaction.tenantId), now);
    for (const component of components) {
      await insertRow(
        transaction,
        'performance_review_template_component',
        templateComponentValues(component, transaction.tenantId),
        now,
      );
    }
  }

  public async update(
    transaction: Transaction,
    template: ReviewTemplateState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      template.templateId,
      expected,
      mutable(templateValues(template, transaction.tenantId)),
    );
  }
}
