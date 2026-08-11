import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { ReviewerAssignmentState } from '../domain/review.js';
import type { Page, Paged, ReviewerAssignmentStore } from '../application/performance-ports.js';
import {
  reviewerAssignmentState,
  reviewerAssignmentValues,
  type ReviewerAssignmentRow,
} from './review-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/**
 * Who was asked to assess a review, and in what capacity.
 *
 * This is where 360° lives: a peer, a direct report and a skip-level manager are three reviewer
 * roles on one review rather than three parallel systems. Every row names who was asked and who
 * asked, and nothing here is anonymous.
 */

export class PostgresReviewerAssignmentRepository
  extends Repository<ReviewerAssignmentRow & { version: number }>
  implements ReviewerAssignmentStore
{
  public constructor() {
    super('performance_reviewer_assignment');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<ReviewerAssignmentState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : reviewerAssignmentState(row);
  }

  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<readonly ReviewerAssignmentState[]> {
    const rows = await transaction.execute<ReviewerAssignmentRow>(
      `select * from performance_reviewer_assignment
         where tenant_id = $1 and review_id = $2 and deleted_at is null
         order by role, reviewer_employment_id`,
      [transaction.tenantId, reviewId],
    );

    return rows.map(reviewerAssignmentState);
  }

  public forReviewer(
    transaction: Transaction,
    reviewerEmploymentId: string,
    paged: Paged,
  ): Promise<Page<ReviewerAssignmentState>> {
    return pageOf<ReviewerAssignmentRow, ReviewerAssignmentState>(
      transaction,
      {
        select: `select * from performance_reviewer_assignment
                   where tenant_id = $1 and reviewer_employment_id = $2 and deleted_at is null
                   order by requested_at desc, id desc
                   limit $3 offset $4`,
        count: `select count(*)::text as total from performance_reviewer_assignment
                  where tenant_id = $1 and reviewer_employment_id = $2 and deleted_at is null`,
        parameters: [transaction.tenantId, reviewerEmploymentId],
        limit: paged.limit,
        offset: paged.offset,
      },
      reviewerAssignmentState,
    );
  }

  public insert(transaction: Transaction, state: ReviewerAssignmentState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      reviewerAssignmentValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: ReviewerAssignmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.reviewerAssignmentId,
      expected,
      mutable(reviewerAssignmentValues(state, transaction.tenantId)),
    );
  }
}
