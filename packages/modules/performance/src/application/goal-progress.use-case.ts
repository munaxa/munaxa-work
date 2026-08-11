import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';
import { closeGoal, recordProgress } from '../domain/goal.js';
import { currentActor, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import { confirmEvidence } from './goal.use-case.js';
import type { GoalIdentified } from './goal.use-case.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Progress against a goal, and closing it.
 *
 * A progress entry is appended and never edited: what somebody reported in March is what a disputed
 * rating is argued from in December. Closure carries the one asymmetry that matters — an achieved or
 * missed goal carries a final score, and **a cancelled goal carries none**, because the sixth
 * approved scoring decision excludes it entirely.
 */

export interface RecordGoalProgressCommand extends Command {
  readonly commandName: 'performance.record-goal-progress';
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly progressBasisPoints: number;
  readonly observedValue?: bigint;
  readonly note?: string;
  readonly evidenceDocumentId?: string;
  readonly keyResultId?: string;
}

/**
 * A progress entry, appended, and the goal's headline figure moved to match.
 *
 * Both in one transaction. The entry is never edited — what somebody reported in March is what a
 * disputed rating is argued from in December, and the store offers no method that could change it.
 */
export const recordGoalProgressHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RecordGoalProgressCommand, GoalIdentified> => ({
  commandName: 'performance.record-goal-progress',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goals.byId(transaction, command.goalId);

      if (held === undefined) return notFound<GoalIdentified>('performance_goal');

      const evidence = await confirmEvidence(dependencies, command.evidenceDocumentId);

      if (evidence !== undefined) return refuseWith<GoalIdentified>(evidence);

      const recorded = recordProgress(
        held,
        uuidV7(),
        { ...command, recordedAt: dependencies.clock.now(), recordedBy: currentActor() },
        command.keyResultId,
      );

      if (!recorded.ok) return refusedBy<GoalIdentified>(recorded.error);

      await dependencies.stores.goalProgress.insert(transaction, recorded.value.progress);
      await dependencies.stores.goals.update(
        transaction,
        { ...recorded.value.goal, version: held.version },
        command.expectedVersion,
      );
      return success({ goalId: held.goalId });
    }),
});

export interface CloseGoalCommand extends Command {
  readonly commandName: 'performance.close-goal';
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly outcome: 'achieved' | 'missed' | 'cancelled';
  readonly finalScore?: number;
  readonly reason?: string;
}

/**
 * Closing a goal, and the one asymmetry that matters.
 *
 * An achieved or missed goal carries a final score, because it was assessed. **A cancelled goal
 * carries none** — the sixth approved scoring decision excludes it entirely, and a score recorded
 * against it would find its way into the aggregate that is supposed not to see it.
 */
export const closeGoalHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<CloseGoalCommand, GoalIdentified> => ({
  commandName: 'performance.close-goal',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goals.byId(transaction, command.goalId);

      if (held === undefined) return notFound<GoalIdentified>('performance_goal');

      const closed = closeGoal(held, {
        ...command,
        closedAt: dependencies.clock.now(),
        closedBy: currentActor(),
      });

      if (!closed.ok) return refusedBy<GoalIdentified>(closed.error);

      await dependencies.stores.goals.update(
        transaction,
        { ...closed.value, version: held.version },
        command.expectedVersion,
      );
      return success({ goalId: held.goalId });
    }),
});
