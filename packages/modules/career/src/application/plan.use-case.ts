import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { amendCareerPlan, createCareerPlan, moveCareerPlan } from '../domain/plan.js';
import type { CareerPlanStatus } from '../domain/career-vocabulary.js';
import type { CareerPlanState } from '../domain/plan.js';
import { civilDateOf, currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * A career plan: where one person is, where they are heading, and how it ended.
 *
 * **A plan names an employment, never a person** (AD-001), and the employment is confirmed through
 * Employment's published contract before a plan is written. A plan for somebody who does not work
 * here is a record nobody can act on.
 *
 * **Creating a plan changes nothing about the employment it names.** No position, no salary, no
 * assignment (ADR-0072). Reaching `achieved` is a statement that somebody got where they intended,
 * and it moves nobody there.
 *
 * **One active plan per employment is the database's** (§15). `insertIfAbsent` maps to
 * `insert … on conflict do nothing` against the partial unique index, and a retry converges on the
 * plan that already exists rather than reporting a conflict — because a lost response and a
 * duplicate act are indistinguishable to the caller, and only one of them is a problem.
 */

export interface CreateCareerPlanCommand extends Command {
  readonly commandName: 'career.create-plan';
  readonly employmentId: string;
  readonly pathId?: string;
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly startedOn: string;
  readonly targetDate?: string;
  readonly notes?: string;
}

export interface PlanCreated {
  readonly careerPlanId: string;
  /** `false` where an active plan already existed. Convergence, not an error. */
  readonly created: boolean;
}

export const createPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CreateCareerPlanCommand, PlanCreated> => ({
  commandName: 'career.create-plan',
  permission: CareerPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.factsFor(command.employmentId);

      if (employment === undefined) return refuseWith<PlanCreated>('employment-not-found');

      const stages = await resolveStages(dependencies, transaction, command);

      if (stages !== undefined) return stages;

      const created = createCareerPlan({ careerPlanId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<PlanCreated>(created.error);

      // A draft plan is not the thing the index guards — only an active one is — so a plain insert
      // is correct here and the index arbitrates at activation.
      await dependencies.stores.plans.insertIfAbsent(transaction, created.value);
      return success({ careerPlanId: created.value.careerPlanId, created: true });
    }),
});

/**
 * Confirms the path and stages a plan names, where it names any.
 *
 * Returns a refusal or `undefined` for "nothing wrong". A stage belonging to a different path is
 * refused here rather than at the table: the check constraint knows a stage was named without a
 * path, and only the application can know the stage named belongs to the path named.
 */
const resolveStages = async (
  dependencies: CareerDependencies,
  transaction: Transaction,
  command: CreateCareerPlanCommand,
): Promise<ReturnType<typeof refuseWith<PlanCreated>> | undefined> => {
  const { pathId } = command;

  if (pathId === undefined) return undefined;

  const path = await dependencies.stores.paths.byId(transaction, pathId);

  if (path === undefined) return refuseWith<PlanCreated>('path-not-found');

  for (const stageId of [command.currentStageId, command.targetStageId]) {
    if (stageId === undefined) continue;

    const stage = await dependencies.stores.paths.stageById(transaction, stageId);

    if (stage === undefined || stage.pathId !== pathId) {
      return refuseWith<PlanCreated>('stage-not-on-path');
    }
  }
  return undefined;
};

export interface AmendCareerPlanCommand extends Command {
  readonly commandName: 'career.amend-plan';
  readonly careerPlanId: string;
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly targetDate?: string;
  readonly notes?: string;
  readonly expectedVersion: number;
}

export interface PlanIdentified {
  readonly careerPlanId: string;
}

/**
 * Amending a plan that has not ended.
 *
 * `employmentId`, `pathId` and `startedOn` cannot be amended, and the domain has no parameter for
 * them: a plan is *this person's* plan along *this* path from *that* day, and changing any of the
 * three would silently make it a different plan while keeping its history. The honest way to do that
 * is to abandon this one and write a new one.
 */
export const amendPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<AmendCareerPlanCommand, PlanIdentified> => ({
  commandName: 'career.amend-plan',
  permission: CareerPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, command.careerPlanId);

      if (plan === undefined) return notFound<PlanIdentified>('career_plan');

      const named = await namesForeignStage(dependencies, transaction, plan, command);

      if (named) return refuseWith<PlanIdentified>('stage-not-on-path');

      const amended = amendCareerPlan(plan, command);

      if (!amended.ok) return refusedBy<PlanIdentified>(amended.error);

      await dependencies.stores.plans.update(transaction, amended.value, command.expectedVersion);
      return success({ careerPlanId: plan.careerPlanId });
    }),
});

const namesForeignStage = async (
  dependencies: CareerDependencies,
  transaction: Transaction,
  plan: CareerPlanState,
  command: AmendCareerPlanCommand,
): Promise<boolean> => {
  for (const stageId of [command.currentStageId, command.targetStageId]) {
    if (stageId === undefined) continue;

    const stage = await dependencies.stores.paths.stageById(transaction, stageId);

    if (stage === undefined || stage.pathId !== plan.pathId) return true;
  }
  return false;
};

export interface MoveCareerPlanCommand extends Command {
  readonly commandName: 'career.move-plan';
  readonly careerPlanId: string;
  readonly to: CareerPlanStatus;
  readonly expectedVersion: number;
}

/**
 * Activating a plan, or ending it.
 *
 * **Activation is where the one-active-plan-per-employment index bites**, and it is deliberately not
 * pre-checked: two administrators activating two drafts for the same person at the same instant both
 * pass a read-then-write, and only the index refuses the second. The repository's `updateRow`
 * surfaces that as the same 409 a stale version produces, which is the honest answer — somebody else
 * changed this person's plan while you were looking at it.
 *
 * The civil day comes from the clock rather than the command: "when did they achieve it" is the day
 * it was recorded, and a caller who could supply it could backdate an ending.
 */
export const movePlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<MoveCareerPlanCommand, PlanIdentified> => ({
  commandName: 'career.move-plan',
  permission: CareerPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.plans.byId(transaction, command.careerPlanId);

      if (plan === undefined) return notFound<PlanIdentified>('career_plan');

      const moved = moveCareerPlan(plan, {
        to: command.to,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
      });

      if (!moved.ok) return refusedBy<PlanIdentified>(moved.error);

      await dependencies.stores.plans.update(transaction, moved.value, command.expectedVersion);
      return success({ careerPlanId: plan.careerPlanId });
    }),
});
