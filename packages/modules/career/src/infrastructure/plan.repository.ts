import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CareerPlanState } from '../domain/plan.js';
import type { Page, Paged, PlanFilters, PlanStore } from '../application/career-ports.js';
import { planColumns, planState, planValues, type PlanRow } from './career-config-rows.js';
import {
  boundClause,
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * Career plans, as a table.
 *
 * **One active plan per employment is `career_plan_active_idx`'s**, not this class's. There is no
 * read-then-write check anywhere below, deliberately: two administrators activating two drafts for
 * the same person at the same instant both pass a pre-check, and only a partial unique index refuses
 * the second (§15). `insertIfAbsent` maps to `insert … on conflict do nothing` and reports which
 * happened; the update path lets the index raise, and `updateRow` surfaces it as the same 409 a
 * stale version produces — somebody else changed this person's plan while you were looking at it.
 *
 * The index is *partial*: it covers `status = 'active'` only, so a draft and an ended plan are free.
 * A full unique index would refuse a second plan after the first was achieved, which is a real thing
 * that happens to real careers.
 */
export class PostgresPlanRepository
  extends Repository<PlanRow & { version: number }>
  implements PlanStore
{
  public constructor() {
    super('career_plan');
  }

  public async byId(transaction: Transaction, id: string): Promise<CareerPlanState | undefined> {
    const rows = await transaction.execute<PlanRow>(
      `select ${planColumns('p')} from career_plan p
         where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : planState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: PlanFilters,
    paged: Paged,
  ): Promise<Page<CareerPlanState>> {
    const base = predicateFor('p', transaction.tenantId, planFilters(filters));
    const parameters = [...base.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'p.employment_id', parameters);
    const predicate = { ...withClause(base, bound), parameters, next: parameters.length + 1 };

    return pageOf<PlanRow, CareerPlanState>(
      transaction,
      {
        select: `select ${planColumns('p')} from career_plan p
                   where ${predicate.clause}
                   order by p.started_on desc, p.id
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from career_plan p where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      planState,
    );
  }

  public async activeFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<CareerPlanState | undefined> {
    const rows = await transaction.execute<PlanRow>(
      `select ${planColumns('p')} from career_plan p
         where p.employment_id = $1 and p.tenant_id = $2
           and p.status = 'active' and p.deleted_at is null`,
      [employmentId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : planState(rows[0]);
  }

  public insertIfAbsent(transaction: Transaction, state: CareerPlanState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      planValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: CareerPlanState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.careerPlanId,
      expected,
      mutable(planValues(state, transaction.tenantId)),
    );
  }
}

const planFilters = (filters: PlanFilters): readonly Filter[] => [
  { column: 'p.employment_id', value: filters.employmentId },
  { column: 'p.path_id', value: filters.pathId },
  { column: 'p.status', value: filters.status },
];
