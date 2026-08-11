import { success, type Command, type CommandHandler } from '@work/kernel';
import { recordScore } from '../domain/review.js';
import { notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { scoreFrom, scoringInputsFor } from './scoring.service.js';
import type { ComponentScoreRecord } from './performance-ports.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Calculating a review's score, as a command of its own.
 *
 * Deliberately not a side effect of submitting an assessment. A manager submitting is one decision
 * and a review being rated is another, and collapsing them would make it impossible to see a score
 * that had been computed and then examined before completion.
 */

export interface ScoreReviewCommand extends Command {
  readonly commandName: 'performance.score-review';
  readonly reviewId: string;
  readonly expectedVersion: number;
}

export interface ReviewScored {
  readonly reviewId: string;
  readonly score: number;
  readonly ratingLevelId: string;
}

/**
 * Calculating a review's score, and writing the working alongside it.
 *
 * The engine's component outcomes are persisted, not merely used: a rating somebody disagrees with
 * is a conversation, and a conversation needs the weights, the denominators and the reasons each
 * excluded item was excluded. Rescoring replaces the working; nothing accumulates.
 *
 * Every refusal the approved decisions require reaches the caller as a refusal rather than a
 * number — component weights that do not total 10,000, an assessed item outside the scale, a review
 * where nothing at all was assessed. **None of them produces a score of zero.**
 */
export const scoreReviewHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<ScoreReviewCommand, ReviewScored> => ({
  commandName: 'performance.score-review',
  permission: PerformancePermissions.assess,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const review = await dependencies.stores.reviews.byId(transaction, command.reviewId);

      if (review === undefined) return notFound<ReviewScored>('performance_review');

      const cycle = await dependencies.stores.cycles.byId(transaction, review.cycleId);
      const template =
        cycle === undefined
          ? undefined
          : await dependencies.stores.templates.byId(transaction, cycle.reviewTemplateId);

      if (template === undefined) return notFound<ReviewScored>('performance_review_template');

      const components = await dependencies.stores.templates.componentsFor(
        transaction,
        template.templateId,
      );
      const inputs = await scoringInputsFor(
        dependencies,
        transaction,
        review,
        template,
        components,
      );

      if (typeof inputs === 'string') return refuseWith<ReviewScored>(inputs);

      const scored = scoreFrom(inputs);

      if (!scored.ok) return refusedBy<ReviewScored>(scored.error);

      const at = dependencies.clock.now();
      const recorded = recordScore(review, scored.value, at);

      if (!recorded.ok) return refusedBy<ReviewScored>(recorded.error);

      const working: readonly ComponentScoreRecord[] = scored.value.components.map((component) => ({
        ...component,
        reviewId: review.reviewId,
        calculatedAt: at,
      }));

      await dependencies.stores.componentScores.replace(transaction, review.reviewId, working);
      await dependencies.stores.reviews.update(
        transaction,
        { ...recorded.value, version: review.version },
        command.expectedVersion,
      );
      return success({
        reviewId: review.reviewId,
        score: scored.value.score,
        ratingLevelId: scored.value.ratingLevelId,
      });
    }),
});
