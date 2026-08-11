import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';
import { cancelCycle, closeCycle, createCycle, moveCycle } from '../domain/cycle.js';
import {
  currentActor,
  conflicted,
  notFound,
  refuseWith,
  refusedBy,
} from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { CycleStatus } from '../domain/performance-vocabulary.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Cycles: created, opened, moved, closed by a named human, or cancelled with a reason.
 *
 * **Nothing here happens on a schedule.** A cycle does not open itself when its period starts, does
 * not chase anybody when a due date passes, and does not close when the last review is finished.
 * `JobPort` has no adapter anywhere in this repository, so every transition is a command somebody
 * issues and "overdue" is a query somebody runs (D-22). The due dates on a cycle are configuration
 * that nothing fires, and the checkpoint report says so rather than letting a date field imply a
 * scheduler.
 *
 * **Enrolment and review are the same row.** A participant who has no review is not a participant,
 * so there is no separate enrolment record to fall out of step. Enrolment is re-runnable: an
 * employment already enrolled is skipped rather than duplicated, which is what makes recovering
 * from a half-finished enrolment a matter of running it again.
 */

export interface OpenCycleCommand extends Command {
  readonly commandName: 'performance.create-cycle';
  readonly code: string;
  readonly name: { readonly en: string; readonly ar: string };
  readonly reviewTemplateId: string;
  readonly kind: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly selfAssessmentDue?: Date;
  readonly managerAssessmentDue?: Date;
  readonly peerAssessmentDue?: Date;
  readonly calibrationDue?: Date;
}

export interface CycleIdentified {
  readonly cycleId: string;
}

export const createCycleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<OpenCycleCommand, CycleIdentified> => ({
  commandName: 'performance.create-cycle',
  permission: PerformancePermissions.cycleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.cycles.byCode(transaction, command.code);

      if (existing !== undefined) return conflicted<CycleIdentified>('cycle_code_taken');

      const template = await dependencies.stores.templates.byId(
        transaction,
        command.reviewTemplateId,
      );

      if (template === undefined) return notFound<CycleIdentified>('performance_review_template');
      if (!template.active) return refuseWith<CycleIdentified>('cycle-template-retired');

      const created = createCycle({ cycleId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<CycleIdentified>(created.error);

      await dependencies.stores.cycles.insert(transaction, created.value);
      return success({ cycleId: created.value.cycleId });
    }),
});

export interface MoveCycleCommand extends Command {
  readonly commandName: 'performance.move-cycle';
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly status: CycleStatus;
}

export const moveCycleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<MoveCycleCommand, CycleIdentified> => ({
  commandName: 'performance.move-cycle',
  permission: PerformancePermissions.cycleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.cycles.byId(transaction, command.cycleId);

      if (held === undefined) return notFound<CycleIdentified>('performance_cycle');
      // Closure and cancellation carry an actor and a reason respectively. Routing either through
      // the generic move would let a cycle reach `closed` with nobody's name against it.
      if (command.status === 'closed' || command.status === 'cancelled') {
        return refuseWith<CycleIdentified>('cycle-use-specific-command');
      }

      const moved = moveCycle(held, command.status, dependencies.clock.now());

      if (!moved.ok) return refusedBy<CycleIdentified>(moved.error);

      await dependencies.stores.cycles.update(
        transaction,
        { ...moved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ cycleId: held.cycleId });
    }),
});

export interface CloseCycleCommand extends Command {
  readonly commandName: 'performance.close-cycle';
  readonly cycleId: string;
  readonly expectedVersion: number;
}

/**
 * Closing a cycle, and the completeness check that precedes it.
 *
 * A cycle whose reviews are not all completed is refused, because closing the container would leave
 * reviews nobody finished looking as though somebody had. The alternative — closing anyway and
 * reporting the stragglers — was rejected: the report is a query nobody is required to read.
 */
export const closeCycleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<CloseCycleCommand, CycleIdentified> => ({
  commandName: 'performance.close-cycle',
  permission: PerformancePermissions.cycleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.cycles.byId(transaction, command.cycleId);

      if (held === undefined) return notFound<CycleIdentified>('performance_cycle');

      const reviews = await dependencies.stores.reviews.forCycle(transaction, command.cycleId);
      const unfinished = reviews.filter(
        (review) => review.status !== 'completed' && review.status !== 'archived',
      );

      if (unfinished.length > 0) {
        return refuseWith<CycleIdentified>('cycle-has-incomplete-reviews');
      }

      const closed = closeCycle(held, currentActor(), dependencies.clock.now());

      if (!closed.ok) return refusedBy<CycleIdentified>(closed.error);

      await dependencies.stores.cycles.update(
        transaction,
        { ...closed.value, version: held.version },
        command.expectedVersion,
      );
      return success({ cycleId: held.cycleId });
    }),
});

export interface CancelCycleCommand extends Command {
  readonly commandName: 'performance.cancel-cycle';
  readonly cycleId: string;
  readonly expectedVersion: number;
  readonly reason: string;
}

export const cancelCycleHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<CancelCycleCommand, CycleIdentified> => ({
  commandName: 'performance.cancel-cycle',
  permission: PerformancePermissions.cycleManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.cycles.byId(transaction, command.cycleId);

      if (held === undefined) return notFound<CycleIdentified>('performance_cycle');

      const cancelled = cancelCycle(held, command.reason, dependencies.clock.now());

      if (!cancelled.ok) return refusedBy<CycleIdentified>(cancelled.error);

      await dependencies.stores.cycles.update(
        transaction,
        { ...cancelled.value, version: held.version },
        command.expectedVersion,
      );
      return success({ cycleId: held.cycleId });
    }),
});
