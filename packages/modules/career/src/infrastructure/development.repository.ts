import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DevelopmentPlanState } from '../domain/development.js';
import type {
  DevelopmentPlanFilters,
  DevelopmentPlanStore,
  Page,
  Paged,
} from '../application/career-ports.js';
import {
  developmentPlanColumns,
  developmentPlanState,
  developmentPlanValues,
  type DevelopmentPlanRow,
} from './career-development-rows.js';
import {
  boundClause,
  insertRow,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * Development plans and the things somebody is going to do.
 *
 * The items themselves live in `development-item.repository.ts`, split along the aggregate's own
 * seam: this file is the plan a person and their manager agreed, that one is the things on it.
 *
 * **Nothing in either joins Learning**, and nothing in either counts towards a 70-20-10 verdict.
 */
export class PostgresDevelopmentPlanRepository
  extends Repository<DevelopmentPlanRow & { version: number }>
  implements DevelopmentPlanStore
{
  public constructor() {
    super('career_development_plan');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DevelopmentPlanState | undefined> {
    const rows = await transaction.execute<DevelopmentPlanRow>(
      `select ${developmentPlanColumns('d')} from career_development_plan d
         where d.id = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : developmentPlanState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: DevelopmentPlanFilters,
    paged: Paged,
  ): Promise<Page<DevelopmentPlanState>> {
    const base = predicateFor('d', transaction.tenantId, developmentPlanFilters(filters));
    const parameters = [...base.parameters];
    const predicate = withClause(
      base,
      boundClause(filters.employmentIdsIn, 'd.employment_id', parameters),
    );
    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<DevelopmentPlanRow, DevelopmentPlanState>(
      transaction,
      {
        select: `select ${developmentPlanColumns('d')} from career_development_plan d
                   where ${bounded.clause}
                   order by d.started_on desc, d.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_development_plan d where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      developmentPlanState,
    );
  }

  public async activeFor(
    transaction: Transaction,
    employmentId: string,
  ): Promise<DevelopmentPlanState | undefined> {
    const rows = await transaction.execute<DevelopmentPlanRow>(
      `select ${developmentPlanColumns('d')} from career_development_plan d
         where d.employment_id = $1 and d.tenant_id = $2
           and d.status = 'active' and d.deleted_at is null
         order by d.started_on desc
         limit 1`,
      [employmentId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : developmentPlanState(rows[0]);
  }

  public insert(transaction: Transaction, state: DevelopmentPlanState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      developmentPlanValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DevelopmentPlanState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.developmentPlanId,
      expected,
      mutable(developmentPlanValues(state, transaction.tenantId)),
    );
  }
}

const developmentPlanFilters = (filters: DevelopmentPlanFilters): readonly Filter[] => [
  { column: 'd.employment_id', value: filters.employmentId },
  { column: 'd.status', value: filters.status },
  { column: 'd.career_plan_id', value: filters.careerPlanId },
];
