import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  defineRatingScale,
  retireRatingScale,
  type DefineRatingLevelRequest,
} from '../domain/rating-scale.js';
import { isEntityCode, type LocalizedNameInput } from './localized.js';
import { conflicted, currentActor, notFound, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { GoalCategoryState } from './performance-ports.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * The rating scale a tenant rates against, and what it calls a kind of goal.
 *
 * **A scale is defined whole, with its levels, in one command.** Not because it is convenient but
 * because the invariant is about the *set*: the levels must tile the scale end to end with no gap
 * and no overlap, and a scale that could be assembled level by level would spend most of its life
 * in a state the domain refuses. Adding a level afterwards is therefore not offered — a scale that
 * needs different bands is a new scale, and the reviews rated against the old one keep it.
 *
 * **Retiring never deletes.** A scale a tenant stops using is still the scale last year's reviews
 * were rated against, and their snapshots hold it precisely so a retirement cannot rewrite them.
 */

export interface DefineRatingScaleCommand extends Command {
  readonly commandName: 'performance.define-rating-scale';
  readonly code: string;
  readonly name: LocalizedNameInput;
  readonly description?: LocalizedNameInput;
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly levels: readonly {
    readonly code: string;
    readonly name: LocalizedNameInput;
    readonly description?: LocalizedNameInput;
    readonly ordinal: number;
    readonly minimumScore: number;
    readonly maximumScore: number;
  }[];
}

export interface RatingScaleDefined {
  readonly ratingScaleId: string;
}

export const defineRatingScaleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<DefineRatingScaleCommand, RatingScaleDefined> => ({
  commandName: 'performance.define-rating-scale',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.ratingScales.byCode(transaction, command.code);

      // Checked here for a readable refusal; the unique index is what actually settles two
      // administrators defining `annual-1-5` at the same moment.
      if (existing !== undefined) return conflicted<RatingScaleDefined>('rating_scale_code_taken');

      const ratingScaleId = uuidV7();
      const levels: readonly DefineRatingLevelRequest[] = command.levels.map((level) => ({
        ratingLevelId: uuidV7(),
        ...level,
      }));
      const defined = defineRatingScale({ ratingScaleId, ...command, levels });

      if (!defined.ok) return refusedBy<RatingScaleDefined>(defined.error);

      await dependencies.stores.ratingScales.insert(
        transaction,
        defined.value.scale,
        defined.value.levels,
      );
      return success({ ratingScaleId });
    }),
});

export interface RetireRatingScaleCommand extends Command {
  readonly commandName: 'performance.retire-rating-scale';
  readonly ratingScaleId: string;
  readonly expectedVersion: number;
}

export const retireRatingScaleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RetireRatingScaleCommand, RatingScaleDefined> => ({
  commandName: 'performance.retire-rating-scale',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.ratingScales.byId(transaction, command.ratingScaleId);

      if (held === undefined) return notFound<RatingScaleDefined>('performance_rating_scale');

      const retired = retireRatingScale(held, dependencies.clock.now());

      if (!retired.ok) return refusedBy<RatingScaleDefined>(retired.error);

      await dependencies.stores.ratingScales.update(
        transaction,
        // `version` is not written by the caller: the repository appends `version = version + 1`,
        // and supplying it here would assign the column twice in one statement.
        { ...retired.value, version: held.version },
        command.expectedVersion,
      );
      return success({ ratingScaleId: held.ratingScaleId });
    }),
});

export interface DefineGoalCategoryCommand extends Command {
  readonly commandName: 'performance.define-goal-category';
  readonly code: string;
  readonly name: LocalizedNameInput;
}

export interface GoalCategoryDefined {
  readonly goalCategoryId: string;
}

export const defineGoalCategoryHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<DefineGoalCategoryCommand, GoalCategoryDefined> => ({
  commandName: 'performance.define-goal-category',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (!isEntityCode(command.code)) {
        return refusedBy<GoalCategoryDefined>({
          reason: 'goal-category-code-invalid',
          messageKey: 'performance.rejection.goal-category-code-invalid',
        });
      }

      const existing = await dependencies.stores.goalCategories.byCode(transaction, command.code);

      if (existing !== undefined)
        return conflicted<GoalCategoryDefined>('goal_category_code_taken');

      const state: GoalCategoryState = {
        goalCategoryId: uuidV7(),
        code: command.code,
        name: command.name,
        active: true,
        version: 1,
      };

      await dependencies.stores.goalCategories.insert(transaction, state);
      return success({ goalCategoryId: state.goalCategoryId });
    }),
});

export interface SetGoalCategoryActiveCommand extends Command {
  readonly commandName: 'performance.set-goal-category-active';
  readonly goalCategoryId: string;
  readonly expectedVersion: number;
  readonly active: boolean;
}

export const setGoalCategoryActiveHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<SetGoalCategoryActiveCommand, GoalCategoryDefined> => ({
  commandName: 'performance.set-goal-category-active',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goalCategories.byId(
        transaction,
        command.goalCategoryId,
      );

      if (held === undefined) return notFound<GoalCategoryDefined>('performance_goal_category');

      await dependencies.stores.goalCategories.update(
        transaction,
        { ...held, active: command.active },
        command.expectedVersion,
      );
      // Recorded so a later audit can answer who withdrew a category mid-cycle. The actor comes
      // from the context; a command that carried one could put anybody's name here.
      await dependencies.notifications.intend({
        templateKey: 'performance.goal-category.changed',
        recipients: [currentActor()],
        variables: { code: held.code, active: String(command.active) },
      });
      return success({ goalCategoryId: held.goalCategoryId });
    }),
});
