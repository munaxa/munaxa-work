import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { RatingLevelState, RatingScaleState } from '../domain/rating-scale.js';
import type { RatingScaleStore } from '../application/performance-ports.js';
import {
  SCALE_COLUMNS,
  ratingLevelState,
  ratingLevelValues,
  ratingScaleState,
  ratingScaleValues,
  type RatingLevelRow,
  type RatingScaleRow,
} from './configuration-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The configuration repositories: rating scales, competency frameworks, goal categories and review
 * templates.
 *
 * **A parent and its children are written in one call**, inside the caller's transaction, because
 * the invariant is about the set. A scale whose levels arrived separately would be readable in a
 * state the domain refuses — bands that do not tile the range — and a reader who happened to score
 * a review in that instant would get a rating from a scale with a hole in it.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id` and excludes soft-deleted rows.
 * The tenant predicate is not a filter a caller supplies; row-level security enforces it again at
 * the table, and a query that omitted it here would still be refused — but it would be refused
 * confusingly, so it is stated.
 */

export class PostgresRatingScaleRepository
  extends Repository<RatingScaleRow & { version: number }>
  implements RatingScaleStore
{
  public constructor() {
    super('performance_rating_scale');
  }

  public async byId(transaction: Transaction, id: string): Promise<RatingScaleState | undefined> {
    const rows = await transaction.execute<RatingScaleRow>(
      `select ${SCALE_COLUMNS} from performance_rating_scale
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : ratingScaleState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<RatingScaleState | undefined> {
    const rows = await transaction.execute<RatingScaleRow>(
      `select ${SCALE_COLUMNS} from performance_rating_scale
         where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : ratingScaleState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly RatingScaleState[]> {
    const rows = await transaction.execute<RatingScaleRow>(
      `select ${SCALE_COLUMNS} from performance_rating_scale
         where tenant_id = $1 and deleted_at is null
         order by code`,
      [transaction.tenantId],
    );

    return rows.map(ratingScaleState);
  }

  public async levelsFor(
    transaction: Transaction,
    scaleId: string,
  ): Promise<readonly RatingLevelState[]> {
    const rows = await transaction.execute<RatingLevelRow>(
      `select * from performance_rating_level
         where tenant_id = $1 and performance_rating_scale_id = $2 and deleted_at is null
         order by ordinal`,
      [transaction.tenantId, scaleId],
    );

    return rows.map(ratingLevelState);
  }

  public async insert(
    transaction: Transaction,
    scale: RatingScaleState,
    levels: readonly RatingLevelState[],
  ): Promise<void> {
    const now = new Date();

    await insertRow(transaction, this.table, ratingScaleValues(scale, transaction.tenantId), now);
    for (const level of levels) {
      await insertRow(
        transaction,
        'performance_rating_level',
        ratingLevelValues(level, transaction.tenantId),
        now,
      );
    }
  }

  public async update(
    transaction: Transaction,
    scale: RatingScaleState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      scale.ratingScaleId,
      expected,
      mutable(ratingScaleValues(scale, transaction.tenantId)),
    );
  }
}
