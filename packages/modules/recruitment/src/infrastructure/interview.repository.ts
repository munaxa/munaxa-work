import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { InterviewFeedbackState, InterviewState } from '../domain/interview.js';
import type { FeedbackStore, InterviewStore } from '../application/recruitment-ports.js';

import {
  FEEDBACK_COLUMNS,
  INTERVIEW_COLUMNS,
  feedbackInsert,
  interviewInsert,
  interviewUpdate,
  toFeedback,
  toInterview,
  type FeedbackRow,
  type InterviewRow,
} from './pipeline-rows.js';
import { insertRow } from './row-writer.js';

export class InterviewRepository
  extends Repository<{ id: string; version: number }>
  implements InterviewStore
{
  public constructor() {
    super('recruitment_interview');
  }

  public async byId(transaction: Transaction, id: string): Promise<InterviewState | undefined> {
    const rows = await transaction.execute<InterviewRow>(
      `select ${INTERVIEW_COLUMNS} from recruitment_interview i
        where i.id = $1 and i.tenant_id = $2 and i.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toInterview(row);
  }

  public async forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly InterviewState[]> {
    const rows = await transaction.execute<InterviewRow>(
      `select ${INTERVIEW_COLUMNS} from recruitment_interview i
        where i.tenant_id = $1 and i.application_id = $2 and i.deleted_at is null
        order by i.round_number`,
      [transaction.tenantId, applicationId],
    );
    return rows.map(toInterview);
  }

  public async forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly InterviewState[]> {
    if (applicationIds.length === 0) return [];

    const rows = await transaction.execute<InterviewRow>(
      `select ${INTERVIEW_COLUMNS} from recruitment_interview i
        where i.tenant_id = $1 and i.application_id = any($2::uuid[]) and i.deleted_at is null
        order by i.round_number`,
      [transaction.tenantId, [...applicationIds]],
    );
    return rows.map(toInterview);
  }

  /**
   * The schedule screen's query, bounded by the window it asks for.
   *
   * Bounded by the window rather than by a page, because a day's interviews is what a schedule *is*
   * — and unbounded by the tenant only in the sense that row-level security has already bounded it.
   */
  public async scheduledBetween(
    transaction: Transaction,
    from: Date,
    to: Date,
  ): Promise<readonly InterviewState[]> {
    const rows = await transaction.execute<InterviewRow>(
      `select ${INTERVIEW_COLUMNS} from recruitment_interview i
        where i.tenant_id = $1 and i.deleted_at is null
          and i.scheduled_from >= $2 and i.scheduled_from < $3
        order by i.scheduled_from`,
      [transaction.tenantId, from, to],
    );
    return rows.map(toInterview);
  }

  public async all(transaction: Transaction): Promise<readonly InterviewState[]> {
    const rows = await transaction.execute<InterviewRow>(
      `select ${INTERVIEW_COLUMNS} from recruitment_interview i
        where i.tenant_id = $1 and i.deleted_at is null order by i.scheduled_from nulls last`,
      [transaction.tenantId],
    );
    return rows.map(toInterview);
  }

  public async insert(transaction: Transaction, state: InterviewState): Promise<void> {
    await insertRow(transaction, this.table, interviewInsert(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: InterviewState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, interviewUpdate(state));
  }
}

/**
 * Interview feedback: written once, never edited.
 *
 * There is no `update`, and that is the protection. An interviewer who could revise their score
 * after hearing the others is not giving an independent opinion, and a recruiter who could amend
 * somebody else's would make every score worthless in a dispute.
 */
export class FeedbackRepository implements FeedbackStore {
  public async forInterview(
    transaction: Transaction,
    interviewId: string,
  ): Promise<readonly InterviewFeedbackState[]> {
    const rows = await transaction.execute<FeedbackRow>(
      `select ${FEEDBACK_COLUMNS} from recruitment_interview_feedback
        where tenant_id = $1 and interview_id = $2 and deleted_at is null
        order by submitted_at`,
      [transaction.tenantId, interviewId],
    );
    return rows.map(toFeedback);
  }

  public async forInterviews(
    transaction: Transaction,
    interviewIds: readonly string[],
  ): Promise<readonly InterviewFeedbackState[]> {
    if (interviewIds.length === 0) return [];

    const rows = await transaction.execute<FeedbackRow>(
      `select ${FEEDBACK_COLUMNS} from recruitment_interview_feedback
        where tenant_id = $1 and interview_id = any($2::uuid[]) and deleted_at is null
        order by submitted_at`,
      [transaction.tenantId, [...interviewIds]],
    );
    return rows.map(toFeedback);
  }

  public async byInterviewer(
    transaction: Transaction,
    interviewId: string,
    interviewerEmploymentId: string,
  ): Promise<InterviewFeedbackState | undefined> {
    const rows = await transaction.execute<FeedbackRow>(
      `select ${FEEDBACK_COLUMNS} from recruitment_interview_feedback
        where tenant_id = $1 and interview_id = $2 and interviewer_employment_id = $3
          and deleted_at is null`,
      [transaction.tenantId, interviewId, interviewerEmploymentId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toFeedback(row);
  }

  public async insert(transaction: Transaction, state: InterviewFeedbackState): Promise<void> {
    await insertRow(
      transaction,
      'recruitment_interview_feedback',
      feedbackInsert(state),
      new Date(),
    );
  }
}
