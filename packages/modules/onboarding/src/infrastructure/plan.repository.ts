import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PlanState } from '../domain/plan.js';
import type { PlanVersionState, TaskTemplateState } from '../domain/plan-version.js';
import type {
  Page,
  PlanQuery,
  PlanStore,
  PlanVersionStore,
  TaskTemplateStore,
} from '../application/onboarding-ports.js';

import {
  PLAN_COLUMNS,
  PLAN_VERSION_COLUMNS,
  TASK_TEMPLATE_COLUMNS,
  planInsert,
  planUpdate,
  planVersionInsert,
  planVersionUpdate,
  taskTemplateInsert,
  toPlan,
  toPlanVersion,
  toTaskTemplate,
  type PlanRow,
  type PlanVersionRow,
  type TaskTemplateRow,
} from './plan-rows.js';
import { planFilters } from './onboarding-search.js';
import { insertRow, pageOf } from './row-writer.js';

/**
 * Plans, their versions and the templates a version holds, in PostgreSQL.
 *
 * Every read carries `tenant_id` and `deleted_at is null` explicitly, even though row-level security
 * would refuse a cross-tenant row anyway. Two independent guarantees rather than one (ADR-0030): if
 * a future connection ever reaches these tables without the tenant setting, the predicate is still
 * there.
 */

export class PlanRepository extends Repository<{ id: string; version: number }> implements PlanStore {
  public constructor() {
    super('onboarding_plan');
  }

  public async byId(transaction: Transaction, id: string): Promise<PlanState | undefined> {
    const rows = await transaction.execute<PlanRow>(
      `select ${PLAN_COLUMNS} from onboarding_plan p
        where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlan(row);
  }

  /** The read the create makes before it writes; the unique index is what actually enforces it. */
  public async byCode(transaction: Transaction, code: string): Promise<PlanState | undefined> {
    const rows = await transaction.execute<PlanRow>(
      `select ${PLAN_COLUMNS} from onboarding_plan p
        where p.tenant_id = $1 and p.code = $2 and p.deleted_at is null`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlan(row);
  }

  public search(transaction: Transaction, query: PlanQuery): Promise<Page<PlanState>> {
    const { where, parameters } = planFilters(transaction.tenantId, query);
    const limit = `$${String(parameters.length + 1)}`;
    const offset = `$${String(parameters.length + 2)}`;

    return pageOf<PlanRow, PlanState>(
      transaction,
      {
        select: `select ${PLAN_COLUMNS} from onboarding_plan p where ${where}
                 order by p.code limit ${limit} offset ${offset}`,
        count: `select count(*)::text as total from onboarding_plan p where ${where}`,
        parameters,
        limit: query.limit,
        offset: query.offset,
      },
      toPlan,
    );
  }

  public async all(transaction: Transaction): Promise<readonly PlanState[]> {
    const rows = await transaction.execute<PlanRow>(
      `select ${PLAN_COLUMNS} from onboarding_plan p
        where p.tenant_id = $1 and p.deleted_at is null order by p.code`,
      [transaction.tenantId],
    );
    return rows.map(toPlan);
  }

  public async insert(transaction: Transaction, state: PlanState): Promise<void> {
    await insertRow(transaction, this.table, planInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PlanState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, planUpdate(state));
  }
}

export class PlanVersionRepository
  extends Repository<{ id: string; version: number }>
  implements PlanVersionStore
{
  public constructor() {
    super('onboarding_plan_version');
  }

  public async byId(transaction: Transaction, id: string): Promise<PlanVersionState | undefined> {
    const rows = await transaction.execute<PlanVersionRow>(
      `select ${PLAN_VERSION_COLUMNS} from onboarding_plan_version v
        where v.id = $1 and v.tenant_id = $2 and v.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlanVersion(row);
  }

  public async forPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<readonly PlanVersionState[]> {
    const rows = await transaction.execute<PlanVersionRow>(
      `select ${PLAN_VERSION_COLUMNS} from onboarding_plan_version v
        where v.tenant_id = $1 and v.plan_id = $2 and v.deleted_at is null
        order by v.version_number`,
      [transaction.tenantId, planId],
    );
    return rows.map(toPlanVersion);
  }

  /**
   * The version an onboarding is generated from: the highest published one.
   *
   * Highest rather than "the one not superseded", because superseding is a second write and a plan
   * whose supersede failed would otherwise resolve to two published versions and a checklist that
   * depends on row order.
   */
  public async publishedForPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<PlanVersionState | undefined> {
    const rows = await transaction.execute<PlanVersionRow>(
      `select ${PLAN_VERSION_COLUMNS} from onboarding_plan_version v
        where v.tenant_id = $1 and v.plan_id = $2 and v.status = 'published' and v.deleted_at is null
        order by v.version_number desc limit 1`,
      [transaction.tenantId, planId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlanVersion(row);
  }

  public async insert(transaction: Transaction, state: PlanVersionState): Promise<void> {
    await insertRow(transaction, this.table, planVersionInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PlanVersionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, planVersionUpdate(state));
  }
}

export class TaskTemplateRepository
  extends Repository<{ id: string; version: number }>
  implements TaskTemplateStore
{
  public constructor() {
    super('onboarding_task_template');
  }

  public async forVersion(
    transaction: Transaction,
    planVersionId: string,
  ): Promise<readonly TaskTemplateState[]> {
    const rows = await transaction.execute<TaskTemplateRow>(
      `select ${TASK_TEMPLATE_COLUMNS} from onboarding_task_template t
        where t.tenant_id = $1 and t.plan_version_id = $2 and t.deleted_at is null
        order by t.sequence, t.code`,
      [transaction.tenantId, planVersionId],
    );
    return rows.map(toTaskTemplate);
  }

  public async byCode(
    transaction: Transaction,
    planVersionId: string,
    code: string,
  ): Promise<TaskTemplateState | undefined> {
    const rows = await transaction.execute<TaskTemplateRow>(
      `select ${TASK_TEMPLATE_COLUMNS} from onboarding_task_template t
        where t.tenant_id = $1 and t.plan_version_id = $2 and t.code = $3 and t.deleted_at is null`,
      [transaction.tenantId, planVersionId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toTaskTemplate(row);
  }

  public async insert(transaction: Transaction, state: TaskTemplateState): Promise<void> {
    await insertRow(transaction, this.table, taskTemplateInsert(state), new Date());
  }

  /**
   * Removes a template from a *draft* version. Soft, like every delete in this product.
   *
   * Soft rather than hard because the row carries who wrote it and when, and an administrator asking
   * "who took the safety briefing off the field-engineer plan" is asking a question a hard delete
   * makes unanswerable. The published versions an instance was generated from are never touched by
   * this path — the application refuses before it reaches here.
   */
  public async remove(transaction: Transaction, id: string, expected: number): Promise<void> {
    await this.softDeleteRow(transaction, id, expected);
  }
}
