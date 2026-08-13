import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { SuccessionPlanState } from '../domain/succession.js';
import type {
  Page,
  Paged,
  SuccessionFilters,
  SuccessionPlanStore,
} from '../application/career-ports.js';
import {
  successionPlanColumns,
  successionPlanState,
  successionPlanValues,
  type SuccessionPlanRow,
} from './career-record-rows.js';
import {
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * Succession plans and the people put forward against them.
 *
 * **No criticality is read, stored or joined anywhere below.** Organization owns it (AD-004), the
 * bounded filter that would let Career ask "which positions are critical" was not authorized (D-4),
 * and a repository that reached for it would be the first step towards a second, staler answer.
 * This class knows a `position_id` and nothing else about the position.
 *
 * **No placement, band or nine-box is joined either.** There is no Performance table in any query
 * here, and there could not be: Career's foreign keys point only at Career's own tables, and a
 * cross-module join would couple two schemas whose migrations run independently.
 *
 * The nominations themselves live in `successor.repository.ts`, split along the seam the aggregate
 * already has: this file is the commitment to keep a bench for a position, that one is the
 * statements about people.
 */
export class PostgresSuccessionPlanRepository
  extends Repository<SuccessionPlanRow & { version: number }>
  implements SuccessionPlanStore
{
  public constructor() {
    super('career_succession_plan');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<SuccessionPlanState | undefined> {
    const rows = await transaction.execute<SuccessionPlanRow>(
      `select ${successionPlanColumns('s')} from career_succession_plan s
         where s.id = $1 and s.tenant_id = $2 and s.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : successionPlanState(rows[0]);
  }

  /**
   * The plans this tenant holds — **not the tenant's critical positions**, which is a larger set
   * Career cannot enumerate (D-4).
   *
   * `reviewOnOrBefore` answers "which reviews have come due", and it comes due because somebody ran
   * this query. Nothing fires: `JobPort` has no adapter, and scheduled review is `NOT VERIFIED`.
   */
  public search(
    transaction: Transaction,
    filters: SuccessionFilters,
    paged: Paged,
  ): Promise<Page<SuccessionPlanState>> {
    const base = predicateFor('s', transaction.tenantId, successionFilters(filters));
    const parameters = [...base.parameters];
    let predicate = base;

    if (filters.reviewOnOrBefore !== undefined) {
      parameters.push(filters.reviewOnOrBefore);
      predicate = withClause(
        predicate,
        `s.status = 'active' and s.review_on is not null
           and s.review_on <= $${String(parameters.length)}::date`,
      );
    }

    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<SuccessionPlanRow, SuccessionPlanState>(
      transaction,
      {
        select: `select ${successionPlanColumns('s')} from career_succession_plan s
                   where ${bounded.clause}
                   order by s.review_on nulls last, s.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_succession_plan s where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      successionPlanState,
    );
  }

  public async activeFor(
    transaction: Transaction,
    positionId: string,
  ): Promise<SuccessionPlanState | undefined> {
    const rows = await transaction.execute<SuccessionPlanRow>(
      `select ${successionPlanColumns('s')} from career_succession_plan s
         where s.position_id = $1 and s.tenant_id = $2
           and s.status = 'active' and s.deleted_at is null`,
      [positionId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : successionPlanState(rows[0]);
  }

  public insertIfAbsent(transaction: Transaction, state: SuccessionPlanState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      successionPlanValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: SuccessionPlanState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.successionPlanId,
      expected,
      mutable(successionPlanValues(state, transaction.tenantId)),
    );
  }
}

const successionFilters = (filters: SuccessionFilters): readonly Filter[] => [
  { column: 's.position_id', value: filters.positionId },
  { column: 's.status', value: filters.status },
];
