import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';
import { approveGoal, createGoal, moveGoal, type CreateGoalRequest } from '../domain/goal.js';
import { currentActor, notFound, refuseWith, refusedBy } from './performance-context.js';
import type { GoalStatus } from '../domain/performance-vocabulary.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Goals: created, approved by a named human, progressed, and closed.
 *
 * **A goal outlives the cycle that assessed it**, so `cycleId` is optional and a goal is not a
 * child of a review. An annual goal is assessed by a quarterly cycle and still exists afterwards.
 *
 * **The employment is confirmed through Employment's published contract, never taken on trust.** A
 * goal filed against an employment that does not exist — or one the caller invented — would be a
 * goal nobody owns, and it would still appear in whatever aggregate happened to select it.
 *
 * **Evidence is a reference and never a byte.** `evidenceDocumentId` is confirmed to exist through
 * Documents' published contract and stored as an identifier. This module holds no filename, no
 * size, no hash and no URL; upload and download remain `NOT VERIFIED` because `StoragePort` has no
 * adapter anywhere in this repository (D-24).
 *
 * **Approval is a named human's.** `system:auto-approval` is refused by the aggregate, by a check
 * constraint, and by the actor being taken from the authenticated context rather than a command.
 */

export interface CreateGoalCommand extends Command {
  readonly commandName: 'performance.create-goal';
  readonly scope: string;
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly cycleId?: string;
  readonly parentGoalId?: string;
  readonly goalCategoryId?: string;
  readonly title: string;
  readonly description?: string;
  readonly measurement: string;
  readonly targetDescription?: string;
  readonly weightBasisPoints: number;
  readonly startDate: Date;
  readonly dueDate: Date;
  readonly evidenceDocumentId?: string;
}

export interface GoalIdentified {
  readonly goalId: string;
}

export const createGoalHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<CreateGoalCommand, GoalIdentified> => ({
  commandName: 'performance.create-goal',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const subject = await confirmSubject(dependencies, command.employmentId);

      if (subject !== undefined) return refuseWith<GoalIdentified>(subject);

      const evidence = await confirmEvidence(dependencies, command.evidenceDocumentId);

      if (evidence !== undefined) return refuseWith<GoalIdentified>(evidence);

      const created = createGoal({ goalId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<GoalIdentified>(created.error);

      await dependencies.stores.goals.insert(transaction, created.value);
      return success({ goalId: created.value.goalId });
    }),
});

/**
 * That the employment exists and is active, as Employment reports it.
 *
 * Returns a refusal reason rather than a boolean so the caller says *why*. An employment that
 * cannot be confirmed is refused rather than assumed: this module reads Employment through a
 * published contract under a bounded grant, and a read that failed is not a licence to proceed.
 */
const confirmSubject = async (
  dependencies: PerformanceDependencies,
  employmentId: string | undefined,
): Promise<string | undefined> => {
  if (employmentId === undefined) return undefined;

  const facts = await dependencies.employment.factsFor(employmentId, dependencies.clock.now());

  if (facts === undefined) return 'goal-employment-unknown';
  return facts.active ? undefined : 'goal-employment-inactive';
};

/** That the document exists. Nothing here fetches it, and nothing here claims it can be fetched. */
export const confirmEvidence = async (
  dependencies: PerformanceDependencies,
  documentId: string | undefined,
): Promise<string | undefined> => {
  if (documentId === undefined) return undefined;

  return (await dependencies.documents.exists(documentId))
    ? undefined
    : 'evidence-document-unknown';
};

export interface UpdateGoalCommand extends Command {
  readonly commandName: 'performance.update-goal';
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly title?: string;
  readonly description?: string;
  readonly targetDescription?: string;
  readonly weightBasisPoints?: number;
  readonly dueDate?: Date;
  readonly evidenceDocumentId?: string;
}

/**
 * Editing a goal while it is still editable.
 *
 * A draft or an approved goal may be reshaped; an *active* one may have its target described more
 * fully and its due date moved, but not its weight changed — a weight that moved mid-cycle would
 * silently change what every assessment already recorded against it counts for.
 */
export const updateGoalHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<UpdateGoalCommand, GoalIdentified> => ({
  commandName: 'performance.update-goal',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goals.byId(transaction, command.goalId);

      if (held === undefined) return notFound<GoalIdentified>('performance_goal');
      if (held.status === 'achieved' || held.status === 'missed' || held.status === 'cancelled') {
        return refuseWith<GoalIdentified>('goal-already-closed');
      }
      if (command.weightBasisPoints !== undefined && held.status === 'active') {
        return refuseWith<GoalIdentified>('goal-weight-frozen-while-active');
      }

      const evidence = await confirmEvidence(dependencies, command.evidenceDocumentId);

      if (evidence !== undefined) return refuseWith<GoalIdentified>(evidence);

      // Rebuilt through the aggregate so every invariant is re-checked against the amended shape
      // rather than only against the original.
      const rebuilt = createGoal({
        ...held,
        ...definedOnly(command),
        goalId: held.goalId,
      });

      if (!rebuilt.ok) return refusedBy<GoalIdentified>(rebuilt.error);

      await dependencies.stores.goals.update(
        transaction,
        { ...rebuilt.value, status: held.status, version: held.version },
        command.expectedVersion,
      );
      return success({ goalId: held.goalId });
    }),
});

/**
 * The fields the command actually set.
 *
 * An absent key must not overwrite a held value with `undefined`: under
 * `exactOptionalPropertyTypes` those are different things, and spreading the command wholesale
 * would clear every field the caller did not mention.
 */
type GoalAmendment = Partial<
  Pick<
    CreateGoalRequest,
    | 'title'
    | 'description'
    | 'targetDescription'
    | 'weightBasisPoints'
    | 'dueDate'
    | 'evidenceDocumentId'
  >
>;

const definedOnly = (command: UpdateGoalCommand): GoalAmendment => ({
  ...(command.title === undefined ? {} : { title: command.title }),
  ...(command.description === undefined ? {} : { description: command.description }),
  ...(command.targetDescription === undefined
    ? {}
    : { targetDescription: command.targetDescription }),
  ...(command.weightBasisPoints === undefined
    ? {}
    : { weightBasisPoints: command.weightBasisPoints }),
  ...(command.dueDate === undefined ? {} : { dueDate: command.dueDate }),
  ...(command.evidenceDocumentId === undefined
    ? {}
    : { evidenceDocumentId: command.evidenceDocumentId }),
});

export interface ApproveGoalCommand extends Command {
  readonly commandName: 'performance.approve-goal';
  readonly goalId: string;
  readonly expectedVersion: number;
}

export const approveGoalHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<ApproveGoalCommand, GoalIdentified> => ({
  commandName: 'performance.approve-goal',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goals.byId(transaction, command.goalId);

      if (held === undefined) return notFound<GoalIdentified>('performance_goal');

      const approved = approveGoal(held, currentActor(), dependencies.clock.now());

      if (!approved.ok) return refusedBy<GoalIdentified>(approved.error);

      await dependencies.stores.goals.update(
        transaction,
        { ...approved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ goalId: held.goalId });
    }),
});

export interface MoveGoalCommand extends Command {
  readonly commandName: 'performance.move-goal';
  readonly goalId: string;
  readonly expectedVersion: number;
  readonly status: GoalStatus;
}

export const moveGoalHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<MoveGoalCommand, GoalIdentified> => ({
  commandName: 'performance.move-goal',
  permission: PerformancePermissions.goalManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.goals.byId(transaction, command.goalId);

      if (held === undefined) return notFound<GoalIdentified>('performance_goal');
      // Closure carries an outcome, a score and an actor. Routing it through the generic move would
      // let a goal reach `achieved` with none of them.
      if (command.status !== 'active') return refuseWith<GoalIdentified>('goal-use-close-command');

      const moved = moveGoal(held, command.status);

      if (!moved.ok) return refusedBy<GoalIdentified>(moved.error);

      await dependencies.stores.goals.update(
        transaction,
        { ...moved.value, version: held.version },
        command.expectedVersion,
      );
      return success({ goalId: held.goalId });
    }),
});
