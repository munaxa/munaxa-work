import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  acknowledgeDevelopmentPlan,
  addDevelopmentItem,
  createDevelopmentPlan,
  moveDevelopmentItem,
  moveDevelopmentPlan,
} from '../domain/development.js';
import type { Acknowledger } from '../domain/development.js';
import type {
  DevelopmentCategory,
  DevelopmentItemKind,
  DevelopmentItemStatus,
  DevelopmentPlanStatus,
} from '../domain/career-vocabulary.js';
import { civilDateOf, currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Development plans, and the things somebody is going to do.
 *
 * **Career owns the plan and the non-course items** — coaching, mentoring, projects, stretch
 * assignments (ADR-0073, D-2). Learning owns courses, assignments, enrolments and completions.
 *
 * **A course item is a reference and nothing else.** It carries a `learningAssignmentId`, confirmed
 * to exist through Learning's published contract at the moment it is written, and Career stores no
 * title, no completion date and no progress for it. Nothing in this file creates a Career course, a
 * Career training assignment, a Career completion or a Career learning path — and `moveItem` refuses
 * outright to record progress on one, because Career storing a second answer to "did they finish"
 * would disagree with Learning the first time somebody withdrew from the enrolment.
 *
 * **The 70-20-10 mix is `NOT VERIFIED`** (D-12). A category is recorded and counted; nothing here
 * validates a balance, applies a tolerance, computes a percentage or refuses a plan for being
 * lopsided. The specification gives a weighting and the word "validated" and defines neither the
 * rule, the tolerance, how contribution is measured, nor what an uncategorized item does — so this
 * product counts and does not judge.
 *
 * **Joint ownership is `NOT VERIFIED`** (D-9). The plan records that an administrator *recorded* an
 * acknowledgement, with the authenticated actor's name against it. Neither the employee nor the
 * manager can sign in — there is no principal-to-employment resolution (ADR-0032) — and a field
 * claiming either of them pressed a button would claim something the platform cannot deliver.
 */

export interface CreateDevelopmentPlanCommand extends Command {
  readonly commandName: 'career.create-development-plan';
  readonly employmentId: string;
  readonly careerPlanId?: string;
  readonly cycleLabel?: string;
  readonly startedOn: string;
  readonly targetDate?: string;
}

export interface DevelopmentPlanIdentified {
  readonly developmentPlanId: string;
}

export const createDevelopmentPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CreateDevelopmentPlanCommand, DevelopmentPlanIdentified> => ({
  commandName: 'career.create-development-plan',
  permission: CareerPermissions.developmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.factsFor(command.employmentId);

      if (employment === undefined) {
        return refuseWith<DevelopmentPlanIdentified>('employment-not-found');
      }

      const careerPlanId = command.careerPlanId;

      if (
        careerPlanId !== undefined &&
        (await dependencies.stores.plans.byId(transaction, careerPlanId)) === undefined
      ) {
        return refuseWith<DevelopmentPlanIdentified>('career-plan-not-found');
      }

      const created = createDevelopmentPlan({ developmentPlanId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<DevelopmentPlanIdentified>(created.error);

      await dependencies.stores.developmentPlans.insert(transaction, created.value);
      return success({ developmentPlanId: created.value.developmentPlanId });
    }),
});

export interface MoveDevelopmentPlanCommand extends Command {
  readonly commandName: 'career.move-development-plan';
  readonly developmentPlanId: string;
  readonly to: DevelopmentPlanStatus;
  readonly expectedVersion: number;
}

/**
 * Activating a plan, or ending it.
 *
 * **A plan with nothing on it activates nothing** — an empty development plan presented as active
 * reads as "we have a plan for this person" when nobody has written one down. The item count comes
 * from the database rather than from a page of rows.
 */
export const moveDevelopmentPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<MoveDevelopmentPlanCommand, DevelopmentPlanIdentified> => ({
  commandName: 'career.move-development-plan',
  permission: CareerPermissions.developmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.developmentPlans.byId(
        transaction,
        command.developmentPlanId,
      );

      if (plan === undefined) return notFound<DevelopmentPlanIdentified>('career_development_plan');

      const items = await dependencies.stores.developmentItems.itemCountOf(
        transaction,
        plan.developmentPlanId,
      );
      const moved = moveDevelopmentPlan(plan, items, {
        to: command.to,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
      });

      if (!moved.ok) return refusedBy<DevelopmentPlanIdentified>(moved.error);

      await dependencies.stores.developmentPlans.update(
        transaction,
        moved.value,
        command.expectedVersion,
      );
      return success({ developmentPlanId: plan.developmentPlanId });
    }),
});

export interface AcknowledgeDevelopmentPlanCommand extends Command {
  readonly commandName: 'career.acknowledge-development-plan';
  readonly developmentPlanId: string;
  /** Which party acknowledged. **Not who is calling** — see the file note and D-9. */
  readonly party: Acknowledger;
  readonly on: string;
  readonly expectedVersion: number;
}

/**
 * Recording that a party acknowledged the plan.
 *
 * **This is not a signature, and the command shape says so.** `party` names *whose* acknowledgement
 * is being recorded; `recordedBy` is the authenticated administrator writing it down, and it is
 * taken from the context rather than the command. The employee did not press this button, because
 * the employee cannot sign in.
 *
 * An acknowledgement is recorded once. A second would overwrite the day the first recorded, and that
 * day is the historical fact.
 */
export const acknowledgeDevelopmentPlanHandler = (
  dependencies: CareerDependencies,
): CommandHandler<AcknowledgeDevelopmentPlanCommand, DevelopmentPlanIdentified> => ({
  commandName: 'career.acknowledge-development-plan',
  permission: CareerPermissions.developmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.developmentPlans.byId(
        transaction,
        command.developmentPlanId,
      );

      if (plan === undefined) return notFound<DevelopmentPlanIdentified>('career_development_plan');

      const acknowledged = acknowledgeDevelopmentPlan(plan, {
        by: command.party,
        on: command.on,
        recordedBy: currentActor(),
      });

      if (!acknowledged.ok) return refusedBy<DevelopmentPlanIdentified>(acknowledged.error);

      await dependencies.stores.developmentPlans.update(
        transaction,
        acknowledged.value,
        command.expectedVersion,
      );
      return success({ developmentPlanId: plan.developmentPlanId });
    }),
});

export interface AddDevelopmentItemCommand extends Command {
  readonly commandName: 'career.add-development-item';
  readonly developmentPlanId: string;
  readonly category: DevelopmentCategory;
  readonly kind: DevelopmentItemKind;
  readonly title: string;
  /** Learning's identifier, required for a `course` item and refused on any other. */
  readonly learningAssignmentId?: string;
  readonly targetDate?: string;
}

export interface DevelopmentItemIdentified {
  readonly developmentItemId: string;
}

/**
 * Adding an item.
 *
 * A `course` item must name a Learning assignment and only a `course` item may — the domain refuses
 * both mistakes and a check constraint refuses them again. Here the application adds the part
 * neither can know: that the assignment **actually exists in Learning**. Storing an identifier
 * nothing backs would be a reference to a course nobody was ever assigned.
 *
 * `category` is recorded and counted, never validated (D-12).
 */
export const addDevelopmentItemHandler = (
  dependencies: CareerDependencies,
): CommandHandler<AddDevelopmentItemCommand, DevelopmentItemIdentified> => ({
  commandName: 'career.add-development-item',
  permission: CareerPermissions.developmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.developmentPlans.byId(
        transaction,
        command.developmentPlanId,
      );

      if (plan === undefined) return notFound<DevelopmentItemIdentified>('career_development_plan');

      const assignment = command.learningAssignmentId;

      if (assignment !== undefined && !(await dependencies.learning.assignmentExists(assignment))) {
        return refuseWith<DevelopmentItemIdentified>('learning-assignment-not-found');
      }

      const added = addDevelopmentItem(plan, { developmentItemId: uuidV7(), ...command });

      if (!added.ok) return refusedBy<DevelopmentItemIdentified>(added.error);

      await dependencies.stores.developmentItems.insert(transaction, added.value);
      return success({ developmentItemId: added.value.developmentItemId });
    }),
});

export interface MoveDevelopmentItemCommand extends Command {
  readonly commandName: 'career.move-development-item';
  readonly developmentItemId: string;
  readonly to: DevelopmentItemStatus;
  readonly expectedVersion: number;
}

/**
 * Moving an item — and refusing to move one Learning owns.
 *
 * This is ADR-0073 made executable at the application boundary. An item referencing a
 * `learningAssignmentId` takes its progress from Learning: recording `completed` here would be
 * Career storing a second answer to "did they finish the course", and the two would disagree the
 * first time somebody withdrew from the enrolment. The domain refuses it, the check constraint
 * refuses it, and the caller is told which rule refused rather than being quietly ignored.
 */
export const moveDevelopmentItemHandler = (
  dependencies: CareerDependencies,
): CommandHandler<MoveDevelopmentItemCommand, DevelopmentItemIdentified> => ({
  commandName: 'career.move-development-item',
  permission: CareerPermissions.developmentManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const item = await dependencies.stores.developmentItems.byId(
        transaction,
        command.developmentItemId,
      );

      if (item === undefined) return notFound<DevelopmentItemIdentified>('career_development_item');

      const moved = moveDevelopmentItem(item, {
        to: command.to,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
      });

      if (!moved.ok) return refusedBy<DevelopmentItemIdentified>(moved.error);

      await dependencies.stores.developmentItems.update(
        transaction,
        moved.value,
        command.expectedVersion,
      );
      return success({ developmentItemId: item.developmentItemId });
    }),
});
