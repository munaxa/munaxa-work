import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CompensationPlanState, PlanComponentTerms } from '../domain/compensation-plan.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type {
  PlanAssignmentStore,
  PlanComponentStore,
  PlanStore,
} from '../application/compensation-ports.js';

import {
  ASSIGNMENT_COLUMNS,
  PLAN_COLUMNS,
  PLAN_COMPONENT_COLUMNS,
  assignmentValues,
  planComponentValues,
  planValues,
  toAssignment,
  toPlan,
  toPlanComponent,
  type CompensationPlanRow,
  type PlanAssignmentRow,
  type PlanComponentRow,
} from './definition-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The plan, its component terms and its assignments, in PostgreSQL.
 *
 * `candidates` is the one worth reading. It returns **every** assignment that could govern an
 * employment on a date, across all four scopes, **unranked** — because most-specific-wins is a
 * domain rule and a query that applied it in SQL would put the rule in two places. The
 * tenant-scoped rows are matched separately from the identified ones, since a tenant assignment has
 * no scope identifier and `scope_id = any(...)` would never match it.
 */
export class CompensationPlanRepository
  extends Repository<{ id: string; version: number }>
  implements PlanStore
{
  public constructor() {
    super('compensation_plan');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CompensationPlanState | undefined> {
    const rows = await transaction.execute<CompensationPlanRow>(
      `select ${PLAN_COLUMNS} from compensation_plan p
        where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlan(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CompensationPlanState | undefined> {
    const rows = await transaction.execute<CompensationPlanRow>(
      `select ${PLAN_COLUMNS} from compensation_plan p
        where p.tenant_id = $1 and p.code = $2 and p.deleted_at is null
        order by p.version_number desc limit 1`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toPlan(row);
  }

  public async all(transaction: Transaction): Promise<readonly CompensationPlanState[]> {
    const rows = await transaction.execute<CompensationPlanRow>(
      `select ${PLAN_COLUMNS} from compensation_plan p
        where p.tenant_id = $1 and p.deleted_at is null
        order by p.code, p.version_number`,
      [transaction.tenantId],
    );
    return rows.map(toPlan);
  }

  public async insert(transaction: Transaction, state: CompensationPlanState): Promise<void> {
    await insertRow(transaction, 'compensation_plan', planValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CompensationPlanState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(planValues(state)));
  }
}

export class PlanComponentRepository implements PlanComponentStore {
  public async forPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<readonly PlanComponentTerms[]> {
    const rows = await transaction.execute<PlanComponentRow>(
      `select ${PLAN_COMPONENT_COLUMNS} from compensation_plan_component c
        where c.tenant_id = $1 and c.compensation_plan_id = $2 and c.deleted_at is null`,
      [transaction.tenantId, planId],
    );
    return rows.map(toPlanComponent);
  }

  public async insert(transaction: Transaction, state: PlanComponentTerms): Promise<void> {
    await insertRow(
      transaction,
      'compensation_plan_component',
      planComponentValues(state),
      new Date(),
    );
  }
}

export class PlanAssignmentRepository
  extends Repository<{ id: string; version: number }>
  implements PlanAssignmentStore
{
  public constructor() {
    super('compensation_plan_assignment');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<PlanAssignmentState | undefined> {
    const rows = await transaction.execute<PlanAssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from compensation_plan_assignment a
        where a.id = $1 and a.tenant_id = $2 and a.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toAssignment(row);
  }

  public async candidates(
    transaction: Transaction,
    scopeIds: readonly string[],
    onDate: string,
  ): Promise<readonly PlanAssignmentState[]> {
    const rows = await transaction.execute<PlanAssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from compensation_plan_assignment a
        where a.tenant_id = $1 and a.deleted_at is null
          and a.effective_from <= $2::date
          and (a.effective_to is null or a.effective_to > $2::date)
          and (a.scope = 'tenant' or a.scope_id = any($3::uuid[]))`,
      [transaction.tenantId, onDate, [...scopeIds]],
    );
    return rows.map(toAssignment);
  }

  public async forPlan(
    transaction: Transaction,
    planId: string,
  ): Promise<readonly PlanAssignmentState[]> {
    const rows = await transaction.execute<PlanAssignmentRow>(
      `select ${ASSIGNMENT_COLUMNS} from compensation_plan_assignment a
        where a.tenant_id = $1 and a.compensation_plan_id = $2 and a.deleted_at is null
        order by a.effective_from`,
      [transaction.tenantId, planId],
    );
    return rows.map(toAssignment);
  }

  public async insert(transaction: Transaction, state: PlanAssignmentState): Promise<void> {
    await insertRow(
      transaction,
      'compensation_plan_assignment',
      assignmentValues(state),
      new Date(),
    );
  }
}
