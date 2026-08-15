import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DevelopmentItemState } from '../domain/development.js';
import type {
  DevelopmentItemFilters,
  DevelopmentItemStore,
  Page,
  Paged,
} from '../application/career-ports.js';
import {
  developmentItemColumns,
  developmentItemState,
  developmentItemValues,
  type DevelopmentItemRow,
} from './career-development-rows.js';
import {
  asNumber,
  insertRow,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * The things somebody is going to do, as a table.
 *
 * **Nothing here joins Learning.** A course item carries a `learning_assignment_id` and no status of
 * its own; whether somebody finished is `learning_enrolment`'s answer, asked of Learning through its
 * published contract (ADR-0073). A join here would be Career querying another module's tables, and a
 * per-item lookup would be an N+1 on every page.
 *
 * **Nothing here counts towards a 70-20-10 verdict.** `category` is stored and grouped; no rule,
 * tolerance, target or balance judgement exists anywhere in this module, because the specification
 * supplies a weighting and no validation rule (D-12).
 */

export class PostgresDevelopmentItemRepository
  extends Repository<DevelopmentItemRow & { version: number }>
  implements DevelopmentItemStore
{
  public constructor() {
    super('career_development_item');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DevelopmentItemState | undefined> {
    const rows = await transaction.execute<DevelopmentItemRow>(
      `select ${developmentItemColumns('i')} from career_development_item i
         where i.id = $1 and i.tenant_id = $2 and i.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : developmentItemState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: DevelopmentItemFilters,
    paged: Paged,
  ): Promise<Page<DevelopmentItemState>> {
    const base = predicateFor('i', transaction.tenantId, developmentItemFilters(filters));
    const parameters = [...base.parameters];
    let predicate = base;

    if (filters.targetOnOrBefore !== undefined) {
      parameters.push(filters.targetOnOrBefore);
      predicate = withClause(
        predicate,
        `i.target_date is not null and i.target_date <= $${String(parameters.length)}::date`,
      );
    }

    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<DevelopmentItemRow, DevelopmentItemState>(
      transaction,
      {
        select: `select ${developmentItemColumns('i')} from career_development_item i
                   where ${bounded.clause}
                   order by i.target_date nulls last, i.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_development_item i where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      developmentItemState,
    );
  }

  /**
   * A plan's items, whole.
   *
   * Bounded by the aggregate: a development plan is the handful of things one person is going to do,
   * and the three category counts are computed from exactly these rows — so fetching a page here
   * would produce a count of the page rather than of the plan.
   */
  public async forPlan(
    transaction: Transaction,
    developmentPlanId: string,
  ): Promise<readonly DevelopmentItemState[]> {
    const rows = await transaction.execute<DevelopmentItemRow>(
      `select ${developmentItemColumns('i')} from career_development_item i
         where i.development_plan_id = $1 and i.tenant_id = $2 and i.deleted_at is null
         order by i.category, i.target_date nulls last, i.id`,
      [developmentPlanId, transaction.tenantId],
    );

    return rows.map(developmentItemState);
  }

  public async itemCountOf(transaction: Transaction, developmentPlanId: string): Promise<number> {
    const rows = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from career_development_item
         where development_plan_id = $1 and tenant_id = $2 and deleted_at is null`,
      [developmentPlanId, transaction.tenantId],
    );

    return asNumber(rows[0]?.total ?? '0');
  }

  public insert(transaction: Transaction, state: DevelopmentItemState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      developmentItemValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DevelopmentItemState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.developmentItemId,
      expected,
      mutable(developmentItemValues(state, transaction.tenantId)),
    );
  }
}

const developmentItemFilters = (filters: DevelopmentItemFilters): readonly Filter[] => [
  { column: 'i.development_plan_id', value: filters.developmentPlanId },
  { column: 'i.category', value: filters.category },
  { column: 'i.status', value: filters.status },
];
