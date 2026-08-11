import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { CycleState } from '../domain/cycle.js';
import type { ReviewState } from '../domain/review.js';
import type {
  CycleStore,
  Page,
  Paged,
  ReviewFilters,
  ReviewStore,
} from '../application/performance-ports.js';
import {
  CYCLE_COLUMNS,
  cycleState,
  cycleValues,
  reviewState,
  reviewValues,
  type CycleRow,
  type ReviewRow,
} from './review-rows.js';
import { boundClause } from './bound-clause.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Cycles, reviews and reviewer assignments.
 *
 * **The authorization bound is a SQL predicate, not a filter applied afterwards.** A caller scoped
 * to a manager's reports gets `employment_id = any($n)` inside the query, so the rows that are not
 * theirs never leave the database. Filtering in TypeScript would mean they had, and the *count* of
 * what was then removed would itself be a disclosure — "your colleague has a review in this cycle"
 * is information.
 */

export class PostgresCycleRepository
  extends Repository<CycleRow & { version: number }>
  implements CycleStore
{
  public constructor() {
    super('performance_cycle');
  }

  public async byId(transaction: Transaction, id: string): Promise<CycleState | undefined> {
    const rows = await transaction.execute<CycleRow>(
      `select ${CYCLE_COLUMNS} from performance_cycle
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : cycleState(rows[0]);
  }

  public async byCode(transaction: Transaction, code: string): Promise<CycleState | undefined> {
    const rows = await transaction.execute<CycleRow>(
      `select ${CYCLE_COLUMNS} from performance_cycle
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : cycleState(rows[0]);
  }

  public all(transaction: Transaction, paged: Paged): Promise<Page<CycleState>> {
    return pageOf<CycleRow, CycleState>(
      transaction,
      {
        select: `select ${CYCLE_COLUMNS} from performance_cycle
                   where tenant_id = $1 and deleted_at is null
                   order by period_end desc, id desc
                   limit $2 offset $3`,
        count: `select count(*)::text as total from performance_cycle
                  where tenant_id = $1 and deleted_at is null`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      cycleState,
    );
  }

  public insert(transaction: Transaction, state: CycleState): Promise<void> {
    return insertRow(transaction, this.table, cycleValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CycleState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.cycleId,
      expected,
      mutable(cycleValues(state, transaction.tenantId)),
    );
  }
}

export class PostgresReviewRepository
  extends Repository<ReviewRow & { version: number }>
  implements ReviewStore
{
  public constructor() {
    super('performance_review');
  }

  public async byId(transaction: Transaction, id: string): Promise<ReviewState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : reviewState(row);
  }

  public async forParticipant(
    transaction: Transaction,
    cycleId: string,
    employmentId: string,
  ): Promise<ReviewState | undefined> {
    const rows = await transaction.execute<ReviewRow>(
      `select * from performance_review
         where tenant_id = $1 and cycle_id = $2 and employment_id = $3 and deleted_at is null`,
      [transaction.tenantId, cycleId, employmentId],
    );

    return rows[0] === undefined ? undefined : reviewState(rows[0]);
  }

  public async forCycle(
    transaction: Transaction,
    cycleId: string,
  ): Promise<readonly ReviewState[]> {
    const rows = await transaction.execute<ReviewRow>(
      `select * from performance_review
         where tenant_id = $1 and cycle_id = $2 and deleted_at is null
         order by employment_id`,
      [transaction.tenantId, cycleId],
    );

    return rows.map(reviewState);
  }

  public search(
    transaction: Transaction,
    filters: ReviewFilters,
    paged: Paged,
  ): Promise<Page<ReviewState>> {
    const predicate = predicateFor('r', transaction.tenantId, reviewFilters(filters));
    const parameters = [...predicate.parameters];
    const bound = boundClause(filters.employmentIdsIn, 'r.employment_id', parameters);
    const clause = bound === undefined ? predicate.clause : `${predicate.clause} and ${bound}`;
    const next = parameters.length + 1;

    return pageOf<ReviewRow, ReviewState>(
      transaction,
      {
        select: `select r.* from performance_review r
                   where ${clause}
                   order by r.employment_id, r.id
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from performance_review r where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      reviewState,
    );
  }

  public insert(transaction: Transaction, state: ReviewState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      reviewValues(state, transaction.tenantId),
      new Date(),
    );
  }

  /**
   * Optimistic, and the base class's `where version = $expected` is what settles a completion race.
   *
   * Two managers reading version 3 and both completing produce one update affecting one row and one
   * affecting none; the second raises `ConcurrencyException`, which the edge turns into a 409. No
   * unique index is involved — a partial index on "the completed state" would be vacuous, because
   * one row cannot collide with itself.
   */
  public async update(
    transaction: Transaction,
    state: ReviewState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.reviewId,
      expected,
      mutable(reviewValues(state, transaction.tenantId)),
    );
  }
}

const reviewFilters = (filters: ReviewFilters): readonly Filter[] => [
  { column: 'r.cycle_id', value: filters.cycleId },
  { column: 'r.employment_id', value: filters.employmentId },
  { column: 'r.manager_employment_id', value: filters.managerEmploymentId },
  { column: 'r.status', value: filters.status },
];
