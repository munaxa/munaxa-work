import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { confirmSuccessor, nominate, withdrawSuccessor } from '../domain/succession.js';
import {
  civilDateOf,
  conflicted,
  currentActor,
  notFound,
  refuseWith,
  refusedBy,
} from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * The people put forward against a succession plan.
 *
 * Split from the plan's own lifecycle along the seam the aggregate already has: a plan is a
 * commitment to *keep* a bench for a position, and a nomination is a statement about a *person*.
 * They carry different permissions for that reason, and the two files make the split visible.
 *
 * **A nomination is not a promotion, and a confirmation is not one either** (ADR-0072, AD-005).
 * Confirming a successor records that an organization has committed to a name for a contingency. No
 * employment changes, no assignment is written, no letter is issued, nothing is scheduled and nobody
 * is told — and there is no port in this module through which any of that could happen.
 *
 * **`successor.confirm` is not implied by `successor.nominate`**, and `system:auto-approval` is
 * refused by the domain and again by a check constraint. Confirmation is a named human act with its
 * own permission — the position Phase 13 took with `calibrate` and Phase 14A with `waive` (D-8).
 *
 * **Nothing here shows a nine-box band.** That needs a filtered, paged placement read Performance
 * does not publish (D-5), and consuming the unpaged `talent-matrix` per nomination would be an
 * unbounded read at 100,000 employments.
 */
export interface NominateSuccessorCommand extends Command {
  readonly commandName: 'career.nominate-successor';
  readonly successionPlanId: string;
  readonly employmentId: string;
  readonly readinessLevelId?: string;
  readonly rank?: number;
}

export interface SuccessorNominated {
  readonly successorId: string;
  /** `false` where an open nomination already existed. Convergence, not an error. */
  readonly created: boolean;
}

/**
 * Putting somebody forward.
 *
 * The nominee's employment is confirmed to exist and to be active: nominating somebody who has left
 * produces a bench a review would read as covered when it is not.
 *
 * **Duplicate nominations are the database's** (§15). This is the specification's "Duplicate
 * Successor Assignments" validation, arbitrated by a partial unique index rather than by a check two
 * managers submitting at the same instant would both pass. A retry converges on the nomination that
 * already exists.
 *
 * `readinessLevelId` names a level somebody configured, and it is **stated** (ADR-0074). `rank` is
 * an order a human put the bench in — not a score, and nothing computes it.
 */
export const nominateSuccessorHandler = (
  dependencies: CareerDependencies,
): CommandHandler<NominateSuccessorCommand, SuccessorNominated> => ({
  commandName: 'career.nominate-successor',
  permission: CareerPermissions.successorNominate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const plan = await dependencies.stores.successionPlans.byId(
        transaction,
        command.successionPlanId,
      );

      if (plan === undefined) return notFound<SuccessorNominated>('career_succession_plan');

      const refusal = await confirmNominee(dependencies, transaction, command);

      if (refusal !== undefined) return refusal;

      const level = command.readinessLevelId;
      const nominated = nominate(plan, {
        successorId: uuidV7(),
        employmentId: command.employmentId,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
        ...(level === undefined ? {} : { readinessLevelId: level }),
        ...(command.rank === undefined ? {} : { rank: command.rank }),
      });

      if (!nominated.ok) return refusedBy<SuccessorNominated>(nominated.error);

      const written = await dependencies.stores.successors.insertIfAbsent(
        transaction,
        nominated.value,
      );

      if (written) return success({ successorId: nominated.value.successorId, created: true });

      const held = await dependencies.stores.successors.openFor(
        transaction,
        plan.successionPlanId,
        command.employmentId,
      );

      if (held === undefined) return conflicted<SuccessorNominated>('career_successor_open');
      return success({ successorId: held.successorId, created: false });
    }),
});

/**
 * Confirms the nominee and the level, before a nomination is written.
 *
 * Split out because both are *references to somebody else's fact* — the employment is Employment's
 * and the readiness level is the tenant's configuration — and a nomination that named either
 * wrongly would put an unactionable name on a bench a review reads as covered.
 */
const confirmNominee = async (
  dependencies: CareerDependencies,
  transaction: Transaction,
  command: NominateSuccessorCommand,
): Promise<ReturnType<typeof refuseWith<SuccessorNominated>> | undefined> => {
  const employment = await dependencies.employment.factsFor(command.employmentId);

  if (employment === undefined) return refuseWith<SuccessorNominated>('employment-not-found');
  if (!employment.active) return refuseWith<SuccessorNominated>('employment-not-active');

  const level = command.readinessLevelId;

  if (
    level !== undefined &&
    (await dependencies.stores.readinessLevels.byId(transaction, level)) === undefined
  ) {
    return refuseWith<SuccessorNominated>('readiness-level-not-found');
  }
  return undefined;
};

export interface ConfirmSuccessorCommand extends Command {
  readonly commandName: 'career.confirm-successor';
  readonly successorId: string;
  readonly expectedVersion: number;
}

export interface SuccessorIdentified {
  readonly successorId: string;
}

/**
 * Confirming a nomination.
 *
 * The one act in this module a reader could mistake for a decision with consequences. It **is** a
 * decision — an organization committing to a name — and it has none: no employment changes, nothing
 * is scheduled, nobody is told.
 *
 * The actor and the day come from the authenticated context and the clock, never from the command.
 * A caller who could supply either could record a confirmation under a colleague's name or backdate
 * one, and this is the row an auditor asks about a year later.
 */
export const confirmSuccessorHandler = (
  dependencies: CareerDependencies,
): CommandHandler<ConfirmSuccessorCommand, SuccessorIdentified> => ({
  commandName: 'career.confirm-successor',
  permission: CareerPermissions.successorConfirm,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.successors.byId(transaction, command.successorId);

      if (held === undefined) return notFound<SuccessorIdentified>('career_successor');

      const confirmed = confirmSuccessor(held, {
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
      });

      if (!confirmed.ok) return refusedBy<SuccessorIdentified>(confirmed.error);

      await dependencies.stores.successors.update(
        transaction,
        confirmed.value,
        command.expectedVersion,
      );
      return success({ successorId: held.successorId });
    }),
});

export interface WithdrawSuccessorCommand extends Command {
  readonly commandName: 'career.withdraw-successor';
  readonly successorId: string;
  readonly reason: string;
  readonly expectedVersion: number;
}

/**
 * Taking somebody off a bench.
 *
 * **A state, never a delete.** "We put this person forward and later took them off" is exactly the
 * history a succession review needs. A reason is required, for the reason a waiver requires one in
 * Learning: this is the act somebody asks about later.
 */
export const withdrawSuccessorHandler = (
  dependencies: CareerDependencies,
): CommandHandler<WithdrawSuccessorCommand, SuccessorIdentified> => ({
  commandName: 'career.withdraw-successor',
  permission: CareerPermissions.successorNominate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.successors.byId(transaction, command.successorId);

      if (held === undefined) return notFound<SuccessorIdentified>('career_successor');

      const withdrawn = withdrawSuccessor(held, {
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
        reason: command.reason,
      });

      if (!withdrawn.ok) return refusedBy<SuccessorIdentified>(withdrawn.error);

      await dependencies.stores.successors.update(
        transaction,
        withdrawn.value,
        command.expectedVersion,
      );
      return success({ successorId: held.successorId });
    }),
});
