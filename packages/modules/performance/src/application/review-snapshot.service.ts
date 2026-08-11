import { uuidV7, type Transaction } from '@work/kernel';
import {
  takeSnapshot,
  type ReviewSnapshotState,
  type TakeSnapshotRequest,
} from '../domain/review-snapshot.js';
import { currentActor } from './performance-context.js';
import { scaleBandFor } from './scoring.service.js';
import type { ReviewState } from '../domain/review.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * The completion snapshot: the inputs to the decision, frozen.
 *
 * The manager and the organizational placement are read *now*, at completion, because that is the
 * moment the review is about — a transfer next month must not change what this review says (D-13,
 * D-14). Names and pay are not read at all: a screen that wants a name asks People, and a
 * performance record has no business holding a salary.
 */

/**
 * The completion snapshot: the inputs to the decision, frozen.
 *
 * The manager and the organizational placement are read *now*, at completion, because that is the
 * moment the review is about — a transfer next month must not change what this review says (D-13,
 * D-14). Names and pay are not read at all: a screen that wants a name asks People, and a
 * performance record has no business holding a salary.
 */
export const snapshotFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  review: ReviewState,
  template: { readonly ratingScaleId: string; readonly competencyFrameworkId?: string },
): Promise<ReviewSnapshotState | string> => {
  const band = await scaleBandFor(dependencies, transaction, template.ratingScaleId);

  if (band === undefined) return 'review-scale-missing';

  const facts = await dependencies.employment.factsFor(
    review.employmentId,
    dependencies.clock.now(),
  );
  const legalEntityId =
    facts?.organizationUnitId === undefined
      ? undefined
      : await dependencies.organization.governingLegalEntityOf(facts.organizationUnitId);
  const [reviewers, goals, components, framework] = await Promise.all([
    dependencies.stores.reviewers.forReview(transaction, review.reviewId),
    dependencies.stores.goals.forReview(transaction, review.employmentId, review.cycleId),
    dependencies.stores.componentScores.forReview(transaction, review.reviewId),
    frameworkFor(dependencies, transaction, template.competencyFrameworkId),
  ]);
  const taken = takeSnapshot(review, {
    reviewSnapshotId: uuidV7(),
    reviewers,
    goals,
    componentScores: components,
    ratingScale: band,
    placement: present({
      organizationUnitId: facts?.organizationUnitId,
      positionId: facts?.positionId,
      legalEntityId,
    }),
    takenAt: dependencies.clock.now(),
    takenBy: currentActor(),
    ...present({ managerEmploymentId: facts?.managerEmploymentId, framework }),
  });

  return taken.ok ? taken.value : taken.error.reason;
};

type Defined<TShape> = { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> };

const present = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  ) as Defined<TShape>;

const frameworkFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  frameworkId: string | undefined,
): Promise<TakeSnapshotRequest['framework']> => {
  if (frameworkId === undefined) return undefined;

  const framework = await dependencies.stores.frameworks.byId(transaction, frameworkId);

  if (framework === undefined) return undefined;

  return {
    frameworkId: framework.frameworkId,
    code: framework.code,
    frameworkVersion: framework.frameworkVersion,
    weighted: framework.weighted,
    competencies: await dependencies.stores.frameworks.competenciesFor(transaction, frameworkId),
  };
};
