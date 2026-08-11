import {
  isFeedbackKind,
  isFeedbackVisibility,
  type FeedbackKind,
  type FeedbackVisibility,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';

/**
 * Feedback given outside a review.
 *
 * **`performance_feedback`, never a bare `feedback`.** Recruitment (Phase 7) already owns interview
 * feedback with its own states and its own meaning; two things called `feedback` in one database is
 * a vocabulary collision waiting to be mis-joined by somebody who reads only one of them (D-20).
 * Nothing in this file touches Recruitment's domain.
 *
 * **It is written once.** There is no operation here that edits it and no update path in any
 * repository: what somebody said is what they said, and a record that can be rewritten afterwards
 * is not a record of what was said. Withdrawal is a soft delete, which leaves every word in place.
 *
 * **There is no anonymous visibility, and there will not be one.** The row carries its author's
 * employment, the audit columns carry the actor, row-level security carries the tenant and the
 * correlation identifier carries the request. A visibility called `anonymous` would be this module
 * claiming a guarantee the architecture cannot keep, and hiding a name in a screen is not the same
 * thing (D-12).
 */

export interface FeedbackState {
  readonly feedbackId: string;
  readonly subjectEmploymentId: string;
  readonly authorEmploymentId: string;
  readonly kind: FeedbackKind;
  readonly visibility: FeedbackVisibility;
  readonly body: string;
  readonly relatedGoalId?: string;
  readonly relatedReviewId?: string;
  readonly requestedBy?: string;
  readonly givenAt: Date;
  readonly version: number;
}

export interface GiveFeedbackRequest {
  readonly feedbackId: string;
  readonly subjectEmploymentId: string;
  /** Resolved from the authenticated context by the application layer. Never from a body. */
  readonly authorEmploymentId: string;
  readonly kind: string;
  readonly visibility: string;
  readonly body: string;
  readonly relatedGoalId?: string;
  readonly relatedReviewId?: string;
  readonly requestedBy?: string;
  readonly givenAt: Date;
}

/** How much text one piece of feedback may carry. Long enough to be useful, bounded so a body is
 * not a file upload by another route. */
const MAX_BODY = 4000;

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const giveFeedback = (request: GiveFeedbackRequest): PerformanceResult<FeedbackState> => {
  const checked = validate(request);

  if (!checked.ok) return checked;

  return accept({
    feedbackId: request.feedbackId,
    subjectEmploymentId: request.subjectEmploymentId,
    authorEmploymentId: request.authorEmploymentId,
    kind: checked.value.kind,
    visibility: checked.value.visibility,
    body: request.body.trim(),
    givenAt: request.givenAt,
    version: 1,
    ...optional('relatedGoalId', request.relatedGoalId),
    ...optional('relatedReviewId', request.relatedReviewId),
    ...optional('requestedBy', request.requestedBy),
  });
};

interface Checked {
  readonly kind: FeedbackKind;
  readonly visibility: FeedbackVisibility;
}

const validate = (request: GiveFeedbackRequest): PerformanceResult<Checked> => {
  if (!isFeedbackKind(request.kind)) return refuse('feedback-kind-unknown', { kind: request.kind });
  if (!isFeedbackVisibility(request.visibility)) {
    return refuse('feedback-visibility-unknown', { visibility: request.visibility });
  }
  if (request.body.trim().length === 0) return refuse('feedback-body-empty');
  if (request.body.trim().length > MAX_BODY) {
    return refuse('feedback-body-too-long', { maximum: String(MAX_BODY) });
  }
  // Feedback about oneself is a note. Counting it would let anybody move every aggregate built from
  // this table by writing about themselves.
  if (request.subjectEmploymentId === request.authorEmploymentId)
    return refuse('feedback-about-self');

  return accept({ kind: request.kind, visibility: request.visibility });
};

/**
 * Who may read a piece of feedback, expressed as the question the application layer actually asks.
 *
 * The subject always may — feedback the person it is about cannot see is a record kept on them
 * rather than for them. Their manager may where the visibility says so, and HR reads through a
 * permission rather than through this function.
 */
export const readableBySubject = (state: FeedbackState, employmentId: string): boolean =>
  state.subjectEmploymentId === employmentId;

export const readableByManager = (state: FeedbackState): boolean =>
  state.visibility === 'manager' || state.visibility === 'hr';
