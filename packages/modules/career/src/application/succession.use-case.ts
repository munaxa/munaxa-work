import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  activateSuccessionPlan,
  archiveSuccessionPlan,
  createSuccessionPlan,
} from '../domain/succession.js';
import { currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Succession: a plan for a position, and the people put forward against it.
 *
 * **A nomination is not a promotion, and a confirmation is not one either** (ADR-0072, AD-005).
 * Confirming a successor records that an organization has committed to a name for a contingency. No
 * employment changes, no assignment is written, no letter is issued, nothing is scheduled and nobody
 * is told — and there is no port in this module through which any of that could happen.
 *
 * **The position is Organization's and so is its criticality** (AD-004, D-3). This module stores a
 * `positionId`, confirms it exists through Organization's published contract, and stores nothing
 * else about it. "List this tenant's critical positions" is `NOT VERIFIED`: `organization.list-
 * positions` has no `criticality` filter and that contract change was not authorized (D-4), so
 * Career shows the plans it holds and cannot enumerate positions it has no plan for. Paging the
 * whole catalogue and filtering here would be unbounded work over another module's data.
 *
 * **Nothing here shows a nine-box band.** That needs a filtered, paged placement read Performance
 * does not publish (D-5), and consuming the unpaged `talent-matrix` per nomination would be an
 * unbounded read at 100,000 employments.
 *
 * **`successor.confirm` is not implied by `successor.nominate`**, and `system:auto-approval` is
 * refused by the domain and again by a check constraint. Confirmation is a named human act with its
 * own permission — the position Phase 13 took with `calibrate` and Phase 14A with `waive` (D-8).
 */

export interface CreateSuccessionPlanCommand extends Command {
  readonly commandName: 'career.create-succession-plan';
  readonly positionId: string;
  readonly reviewOn?: string;
  readonly notes?: string;
}

export interface SuccessionPlanIdentified {
  readonly successionPlanId: string;
}

export const createSuccessionPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CreateSuccessionPlanCommand, SuccessionPlanIdentified> => ({
  commandName: 'career.create-succession-plan',
  permission: CareerPermissions.successionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const exists = await dependencies.organization.positionExists(command.positionId);

      if (!exists) return refuseWith<SuccessionPlanIdentified>('position-not-found');

      const created = createSuccessionPlan({ successionPlanId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<SuccessionPlanIdentified>(created.error);

      await dependencies.stores.successionPlans.insertIfAbsent(transaction, created.value);
      return success({ successionPlanId: created.value.successionPlanId });
    }),
});

export interface MoveSuccessionPlanCommand extends Command {
  readonly commandName: 'career.activate-succession-plan';
  readonly successionPlanId: string;
  readonly expectedVersion: number;
}

/**
 * Activating a plan: the point at which it is the tenant's live answer for this position.
 *
 * **A plan with nobody nominated activates nothing.** An empty bench presented as an active
 * succession plan is worse than no plan, because a review reads it as "covered". The count comes
 * from the database rather than from a page of rows.
 *
 * One active plan per position is a partial unique index, and it bites here rather than in a
 * pre-check for the reason every other uniqueness in this module does.
 */
export const activateSuccessionPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<MoveSuccessionPlanCommand, SuccessionPlanIdentified> => ({
  commandName: 'career.activate-succession-plan',
  permission: CareerPermissions.successionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.successionPlans.byId(
        transaction,
        command.successionPlanId,
      );

      if (plan === undefined) return notFound<SuccessionPlanIdentified>('career_succession_plan');

      const counts = await dependencies.stores.successors.benchCountsOf(
        transaction,
        plan.successionPlanId,
      );
      const activated = activateSuccessionPlan(plan, counts.nominated + counts.confirmed);

      if (!activated.ok) return refusedBy<SuccessionPlanIdentified>(activated.error);

      await dependencies.stores.successionPlans.update(
        transaction,
        activated.value,
        command.expectedVersion,
      );
      return success({ successionPlanId: plan.successionPlanId });
    }),
});

export interface ArchiveSuccessionPlanCommand extends Command {
  readonly commandName: 'career.archive-succession-plan';
  readonly successionPlanId: string;
  readonly expectedVersion: number;
}

/** Archiving. Nominations are retained: who was put forward is the history a review reads. */
export const archiveSuccessionPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<ArchiveSuccessionPlanCommand, SuccessionPlanIdentified> => ({
  commandName: 'career.archive-succession-plan',
  permission: CareerPermissions.successionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.successionPlans.byId(
        transaction,
        command.successionPlanId,
      );

      if (plan === undefined) return notFound<SuccessionPlanIdentified>('career_succession_plan');

      const archived = archiveSuccessionPlan(plan, dependencies.clock.now(), currentActor());

      if (!archived.ok) return refusedBy<SuccessionPlanIdentified>(archived.error);

      await dependencies.stores.successionPlans.update(
        transaction,
        archived.value,
        command.expectedVersion,
      );
      return success({ successionPlanId: plan.successionPlanId });
    }),
});
