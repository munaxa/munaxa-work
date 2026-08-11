import { auditForUpdate } from '@work/persistence';
import type { Transaction } from '@work/kernel';
import type { FeedbackState } from '../domain/feedback.js';
import type { ReviewSnapshotState } from '../domain/review-snapshot.js';
import type {
  FeedbackFilters,
  FeedbackStore,
  Page,
  Paged,
  SnapshotStore,
} from '../application/performance-ports.js';
import {
  feedbackState,
  feedbackValues,
  snapshotState,
  snapshotValues,
  type FeedbackRow,
  type SnapshotRow,
} from './outcome-rows.js';
import { insertRow, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Feedback and the completion snapshot.
 *
 * Neither offers an edit. Withdrawal is a soft delete that touches only the delete columns and the
 * audit that accompanies them — the trigger refuses anything else, so the text stays exactly as it
 * was written; and a snapshot is inserted once, at completion, and refused thereafter.
 */

export class PostgresFeedbackRepository implements FeedbackStore {
  public async byId(transaction: Transaction, id: string): Promise<FeedbackState | undefined> {
    const rows = await transaction.execute<FeedbackRow>(
      `select * from performance_feedback
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : feedbackState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: FeedbackFilters,
    paged: Paged,
  ): Promise<Page<FeedbackState>> {
    const predicate = predicateFor('f', transaction.tenantId, feedbackFilters(filters));
    const parameters = [...predicate.parameters];
    let clause = predicate.clause;

    if (filters.subjectEmploymentIdsIn !== undefined) {
      parameters.push([...filters.subjectEmploymentIdsIn]);
      clause += ` and f.subject_employment_id = any($${String(parameters.length)}::uuid[])`;
    }

    const next = parameters.length + 1;

    return pageOf<FeedbackRow, FeedbackState>(
      transaction,
      {
        select: `select f.* from performance_feedback f
                   where ${clause}
                   order by f.given_at desc, f.id desc
                   limit $${String(next)} offset $${String(next + 1)}`,
        count: `select count(*)::text as total from performance_feedback f where ${clause}`,
        parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      feedbackState,
    );
  }

  public insert(transaction: Transaction, state: FeedbackState): Promise<void> {
    return insertRow(
      transaction,
      'performance_feedback',
      feedbackValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async withdraw(transaction: Transaction, id: string, at: Date, by: string): Promise<void> {
    const audit = auditForUpdate(at);

    await transaction.execute(
      `update performance_feedback
          set deleted_at = $1, deleted_by = $2, updated_at = $3, updated_by = $4,
              version = version + 1
        where id = $5 and tenant_id = $6 and deleted_at is null`,
      [at, by, audit.updated_at, audit.updated_by, id, transaction.tenantId],
    );
  }
}

const feedbackFilters = (filters: FeedbackFilters): readonly Filter[] => [
  { column: 'f.subject_employment_id', value: filters.subjectEmploymentId },
  { column: 'f.author_employment_id', value: filters.authorEmploymentId },
  { column: 'f.related_review_id', value: filters.relatedReviewId },
];

/** Insert and read. Written once at completion; the reason a rating survives a reorganization. */
export class PostgresSnapshotRepository implements SnapshotStore {
  public async forReview(
    transaction: Transaction,
    reviewId: string,
  ): Promise<ReviewSnapshotState | undefined> {
    const rows = await transaction.execute<SnapshotRow>(
      `select * from performance_review_snapshot
         where tenant_id = $1 and review_id = $2 and deleted_at is null`,
      [transaction.tenantId, reviewId],
    );

    return rows[0] === undefined ? undefined : snapshotState(rows[0]);
  }

  public insert(transaction: Transaction, state: ReviewSnapshotState): Promise<void> {
    return insertRow(
      transaction,
      'performance_review_snapshot',
      snapshotValues(state, transaction.tenantId),
      new Date(),
    );
  }
}
