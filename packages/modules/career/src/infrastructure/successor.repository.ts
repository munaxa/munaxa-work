import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { SuccessorState } from '../domain/succession.js';
import type {
  BenchCounts,
  Page,
  Paged,
  SuccessorFilters,
  SuccessorStore,
} from '../application/career-ports.js';
import {
  successorColumns,
  successorState,
  successorValues,
  type SuccessorRow,
} from './career-record-rows.js';
import {
  asNumber,
  boundClause,
  insertRowIfAbsent,
  mutable,
  pageOf,
  predicateFor,
  withClause,
  type Filter,
} from './row-writer.js';

/**
 * The people put forward against a succession plan.
 *
 * Split from the plan's own repository along the seam the aggregate already has: a plan is a
 * commitment to keep a bench for a position, and a nomination is a statement about a *person*.
 *
 * **Duplicate nominations are `career_successor_open_idx`'s** — the specification's "Duplicate
 * Successor Assignments" validation, arbitrated by the database because two managers can submit at
 * the same instant and a pre-check would let both through (§15). The index covers
 * `status in ('nominated','confirmed')`, so a withdrawn nomination frees the slot and somebody taken
 * off a bench may be put back on it.
 *
 * **No placement, band or nine-box is joined here.** There is no Performance table in any query
 * below and there could not be: Career's foreign keys point only at Career's own tables (D-5).
 */

export class PostgresSuccessorRepository
  extends Repository<SuccessorRow & { version: number }>
  implements SuccessorStore
{
  public constructor() {
    super('career_successor');
  }

  public async byId(transaction: Transaction, id: string): Promise<SuccessorState | undefined> {
    const rows = await transaction.execute<SuccessorRow>(
      `select ${successorColumns('n')} from career_successor n
         where n.id = $1 and n.tenant_id = $2 and n.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : successorState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: SuccessorFilters,
    paged: Paged,
  ): Promise<Page<SuccessorState>> {
    const base = predicateFor('n', transaction.tenantId, successorFilters(filters));
    const parameters = [...base.parameters];
    const predicate = withClause(
      base,
      boundClause(filters.employmentIdsIn, 'n.employment_id', parameters),
    );
    const bounded = { ...predicate, parameters, next: parameters.length + 1 };

    return pageOf<SuccessorRow, SuccessorState>(
      transaction,
      {
        select: `select ${successorColumns('n')} from career_successor n
                   where ${bounded.clause}
                   order by n.rank nulls last, n.nominated_on, n.id
                   limit $${String(bounded.next)} offset $${String(bounded.next + 1)}`,
        count: `select count(*)::text as total from career_successor n where ${bounded.clause}`,
        parameters: bounded.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      successorState,
    );
  }

  /**
   * The bench, whole and in rank order.
   *
   * Withdrawn nominations are included: "we put this person forward and later took them off" is
   * exactly the history a succession review reads.
   */
  public async forPlan(
    transaction: Transaction,
    successionPlanId: string,
  ): Promise<readonly SuccessorState[]> {
    const rows = await transaction.execute<SuccessorRow>(
      `select ${successorColumns('n')} from career_successor n
         where n.succession_plan_id = $1 and n.tenant_id = $2 and n.deleted_at is null
         order by n.rank nulls last, n.nominated_on, n.id`,
      [successionPlanId, transaction.tenantId],
    );

    return rows.map(successorState);
  }

  public async openFor(
    transaction: Transaction,
    successionPlanId: string,
    employmentId: string,
  ): Promise<SuccessorState | undefined> {
    const rows = await transaction.execute<SuccessorRow>(
      `select ${successorColumns('n')} from career_successor n
         where n.succession_plan_id = $1 and n.employment_id = $2 and n.tenant_id = $3
           and n.status in ('nominated', 'confirmed') and n.deleted_at is null`,
      [successionPlanId, employmentId, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : successorState(rows[0]);
  }

  /**
   * How deep a bench is, counted by the database in one statement.
   *
   * A count derived from `forPlan(...).length` would be the size of whatever was fetched, and "this
   * director has three successors" computed that way would be wrong the moment there were more than
   * a page of them. The tenant predicate is in the count too, because a total computed without it
   * would disclose how many successors another organization has groomed even while hiding the rows.
   */
  public async benchCountsOf(
    transaction: Transaction,
    successionPlanId: string,
  ): Promise<BenchCounts> {
    const rows = await transaction.execute<{ nominated: string; confirmed: string }>(
      `select count(*) filter (where status = 'nominated')::text as nominated,
              count(*) filter (where status = 'confirmed')::text as confirmed
         from career_successor
        where succession_plan_id = $1 and tenant_id = $2 and deleted_at is null`,
      [successionPlanId, transaction.tenantId],
    );

    return {
      nominated: asNumber(rows[0]?.nominated ?? '0'),
      confirmed: asNumber(rows[0]?.confirmed ?? '0'),
    };
  }

  public insertIfAbsent(transaction: Transaction, state: SuccessorState): Promise<boolean> {
    return insertRowIfAbsent(
      transaction,
      this.table,
      successorValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: SuccessorState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.successorId,
      expected,
      mutable(successorValues(state, transaction.tenantId)),
    );
  }
}

const successorFilters = (filters: SuccessorFilters): readonly Filter[] => [
  { column: 'n.succession_plan_id', value: filters.successionPlanId },
  { column: 'n.employment_id', value: filters.employmentId },
  { column: 'n.status', value: filters.status },
];
