import { success, type Query, type QueryHandler, type Transaction } from '@work/kernel';
import { bounded, listed, type PageRequest, type Listed } from './performance-queries.js';
import { boundBy, reviewScopeFor, scopeAdmits } from './authorization.js';
import { notFound } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { submittedMultiRater } from './scoring.service.js';
import {
  assessmentView,
  calibrationDecisionView,
  calibrationSessionView,
  componentScoreView,
  feedbackView,
  placementView,
  reviewView,
  reviewerView,
  snapshotView,
} from './performance-views.js';
import type { PerformanceDependencies } from './performance-dependencies.js';
import type {
  CalibrationSessionView,
  FeedbackView,
  PeerAggregateView,
  ReconciliationFindingView,
  ReviewDetailView,
  ReviewView,
  TalentPlacementView,
} from '../contracts/views.js';

/**
 * The review reads: the manager queue, one review with its working, calibration, the talent matrix,
 * feedback, and what reconciliation found.
 *
 * **Scoped before the store, not after it.** A caller holding `review.read-team` has their query
 * narrowed to the employments Employment says report to them, and the bound goes *into* the store
 * call. Filtering afterwards would mean the rows had already left the database, and a count of what
 * was then removed is itself a disclosure — "your colleague has a review in this cycle" is
 * information.
 *
 * **A review outside the caller's scope answers 404 rather than 403.** Confirming that a review
 * exists for a given employment in a given cycle is the disclosure, because it says somebody is
 * being appraised.
 *
 * **A withheld aggregate says so.** Where a template's minimum has not been met, `peerAggregate`
 * comes back `available: false` with no scores. That withholds a number; it does not make the
 * responses anonymous, and nothing here pretends it does.
 */

export interface SearchReviews extends Query, PageRequest {
  readonly queryName: 'performance.reviews';
  readonly cycleId?: string;
  readonly status?: string;
  /** Honoured only per `reviewScopeFor` — a caller cannot name somebody else's team. */
  readonly managerEmploymentId?: string;
}

export const searchReviewsHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<SearchReviews, Listed<ReviewView>> => ({
  queryName: 'performance.reviews',
  permission: PerformancePermissions.reviewReadTeam,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await reviewScopeFor(dependencies, query);
      const page = await dependencies.stores.reviews.search(
        transaction,
        {
          ...(query.cycleId === undefined ? {} : { cycleId: query.cycleId }),
          ...(query.status === undefined ? {} : { status: query.status }),
          ...boundBy(scope),
        },
        bounded(query),
      );

      return success(listed({ items: page.items.map(reviewView), total: page.total }));
    }),
});

export interface ReadReview extends Query {
  readonly queryName: 'performance.read-review';
  readonly reviewId: string;
  /**
   * The manager whose team the caller is reading as. Honoured exactly as it is for the collection
   * read: a `read-all` caller needs none, and a `read-team` caller who supplies none reads nothing.
   */
  readonly managerEmploymentId?: string;
}

/**
 * One review, with the working, the panel and — once completed — the snapshot.
 *
 * A review outside the caller's scope answers **404 rather than 403**: confirming that a review
 * exists for a given employment in a given cycle is itself the disclosure, because it says somebody
 * is being appraised.
 */
export const readReviewHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ReadReview, ReviewDetailView> => ({
  queryName: 'performance.read-review',
  permission: PerformancePermissions.reviewReadTeam,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const review = await dependencies.stores.reviews.byId(transaction, query.reviewId);

      if (review === undefined) return notFound<ReviewDetailView>('performance_review');

      // **The scope comes from the caller, never from the review.** Deriving it from the review's
      // own manager would have made every review readable by anybody holding `read-team`: the
      // review always has a manager, and that manager always has it among their reports. It was a
      // free pass wearing the shape of a check, and the journey suite found it.
      const scope = await reviewScopeFor(dependencies, {
        ...(query.managerEmploymentId === undefined
          ? {}
          : { managerEmploymentId: query.managerEmploymentId }),
      });

      if (!scopeAdmits(scope, review.employmentId)) {
        return notFound<ReviewDetailView>('performance_review');
      }

      return success(await detailFor(dependencies, transaction, review));
    }),
});

type ReviewRow = Awaited<ReturnType<PerformanceDependencies['stores']['reviews']['byId']>>;

const detailFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  review: NonNullable<ReviewRow>,
): Promise<ReviewDetailView> => {
  const [reviewers, assessments, components, decisions, snapshot, cycle] = await Promise.all([
    dependencies.stores.reviewers.forReview(transaction, review.reviewId),
    dependencies.stores.assessments.forReview(transaction, review.reviewId),
    dependencies.stores.componentScores.forReview(transaction, review.reviewId),
    dependencies.stores.calibrationDecisions.forReview(transaction, review.reviewId),
    dependencies.stores.snapshots.forReview(transaction, review.reviewId),
    dependencies.stores.cycles.byId(transaction, review.cycleId),
  ]);
  const template =
    cycle === undefined
      ? undefined
      : await dependencies.stores.templates.byId(transaction, cycle.reviewTemplateId);
  const views = await Promise.all(
    assessments.map(async (assessment) =>
      assessmentView(
        assessment,
        await dependencies.stores.assessments.itemsFor(transaction, assessment.assessmentId),
      ),
    ),
  );
  const [latest] = decisions;

  return {
    review: reviewView(review),
    reviewers: reviewers.map(reviewerView),
    assessments: views,
    componentScores: components.map(componentScoreView),
    peerAggregate: peerAggregateOf(assessments, template?.minimumPeerResponses),
    ...(latest === undefined ? {} : { calibration: calibrationDecisionView(latest) }),
    ...(snapshot === undefined ? {} : { snapshot: snapshotView(snapshot) }),
  };
};

/**
 * The multi-rater aggregate, or the honest statement that it is withheld.
 *
 * Below the minimum the scores are simply absent — one person's opinion presented as the group's is
 * worse than no aggregate at all. Withholding a number is the only protection this architecture can
 * actually provide; it is **not** anonymity, and the field name says `available` rather than
 * `anonymous` for exactly that reason.
 */
const peerAggregateOf = (
  assessments: Parameters<typeof submittedMultiRater>[0],
  minimumResponses: number | undefined,
): PeerAggregateView => {
  const responses = submittedMultiRater(assessments);
  const scored = responses.flatMap((response) =>
    response.overallScore === undefined ? [] : [response.overallScore],
  );
  const available = minimumResponses === undefined || responses.length >= minimumResponses;

  if (!available || scored.length === 0) {
    return {
      available: available && scored.length > 0,
      responseCount: responses.length,
      ...(minimumResponses === undefined ? {} : { minimumResponses }),
    };
  }

  // Integer arithmetic, like every other score in this module. A mean of hundredths is hundredths.
  const total = scored.reduce((running, score) => running + score, 0);

  return {
    available: true,
    responseCount: responses.length,
    averageScore: Math.round(total / scored.length),
    ...(minimumResponses === undefined ? {} : { minimumResponses }),
  };
};

export interface ListCalibrationSessions extends Query {
  readonly queryName: 'performance.calibration-sessions';
  readonly cycleId: string;
}

export const listCalibrationSessionsHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ListCalibrationSessions, Listed<CalibrationSessionView>> => ({
  queryName: 'performance.calibration-sessions',
  permission: PerformancePermissions.calibrate,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const sessions = await dependencies.stores.calibrationSessions.forCycle(
        transaction,
        query.cycleId,
      );
      const views = await Promise.all(
        sessions.map(async (session) =>
          calibrationSessionView(
            session,
            (
              await dependencies.stores.calibrationDecisions.forSession(
                transaction,
                session.calibrationSessionId,
              )
            ).length,
          ),
        ),
      );

      return success({ items: views, total: views.length });
    }),
});

export interface ReadTalentMatrix extends Query {
  readonly queryName: 'performance.talent-matrix';
  readonly cycleId: string;
}

export const readTalentMatrixHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ReadTalentMatrix, Listed<TalentPlacementView>> => ({
  queryName: 'performance.talent-matrix',
  permission: PerformancePermissions.talentRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const placements = await dependencies.stores.placements.forCycle(transaction, query.cycleId);

      return success({ items: placements.map(placementView), total: placements.length });
    }),
});

export interface SearchFeedback extends Query, PageRequest {
  readonly queryName: 'performance.feedback';
  readonly subjectEmploymentId?: string;
  readonly relatedReviewId?: string;
  readonly managerEmploymentId?: string;
}

export const searchFeedbackHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<SearchFeedback, Listed<FeedbackView>> => ({
  queryName: 'performance.feedback',
  permission: PerformancePermissions.feedbackReadTeam,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const scope = await reviewScopeFor(dependencies, query);
      const bound = boundBy(scope);
      const page = await dependencies.stores.feedback.search(
        transaction,
        {
          ...(query.subjectEmploymentId === undefined
            ? {}
            : { subjectEmploymentId: query.subjectEmploymentId }),
          ...(query.relatedReviewId === undefined
            ? {}
            : { relatedReviewId: query.relatedReviewId }),
          ...(bound.employmentIdsIn === undefined
            ? {}
            : { subjectEmploymentIdsIn: bound.employmentIdsIn }),
        },
        bounded(query),
      );

      return success(listed({ items: page.items.map(feedbackView), total: page.total }));
    }),
});

export interface ReadReconciliation extends Query {
  readonly queryName: 'performance.reconciliation';
  readonly cycleId: string;
}

/**
 * What reconciliation found. **It reports; it repairs nothing.**
 *
 * There is no scheduler to run it and nothing that acts on it — it is a query somebody runs, which
 * is the only honest shape while `JobPort` has no adapter (D-22).
 */
export const readReconciliationHandler = (
  dependencies: PerformanceDependencies,
): QueryHandler<ReadReconciliation, Listed<ReconciliationFindingView>> => ({
  queryName: 'performance.reconciliation',
  permission: PerformancePermissions.reconcile,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const findings = await dependencies.stores.reconciliation.findings(
        transaction,
        query.cycleId,
      );

      return success({ items: findings, total: findings.length });
    }),
});
