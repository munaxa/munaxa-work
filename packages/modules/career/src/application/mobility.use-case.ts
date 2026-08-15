import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { decideMove, recommendMove } from '../domain/mobility.js';
import type { MobilityKind, StoredMobilityStatus } from '../domain/career-vocabulary.js';
import { civilDateOf, currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Internal mobility recommendations: a suggestion, and nothing that moves anybody.
 *
 * **`accepted` means a named person, on a named day, agreed the move is a good idea** (ADR-0072).
 * No employment changes. No assignment is written. No salary moves. No letter is issued. Nobody is
 * told. Whether the move then happens is Employment's, through a process somebody runs by hand — and
 * there is no port in this module through which any of that could be triggered, which is why the
 * guarantee is structural rather than a rule somebody has to remember.
 *
 * **`promotion` is a recommendation kind and never an act.** The specification uses the word, so the
 * vocabulary keeps it; a tenant recommending a promotion has recorded an opinion. Nothing in this
 * file, or reachable from it, promotes anybody.
 *
 * **Expiry is derived, never stored** (D-13). The row carries `validUntil`; whether it has passed is
 * a function of that day and the day somebody asked. `expired` is refused as a stored status by a
 * check constraint, so nothing can quietly start writing it — because nothing could then maintain
 * it: `JobPort` has no adapter, and **scheduled expiry is `NOT VERIFIED`**. This is Learning's
 * certificate-validity construction (ADR-0070).
 *
 * A recommendation reading as expired is still `proposed` in the row, so it can still be decided.
 * Refusing a stale acceptance would be a business rule, and none was specified.
 */

export interface RecommendMoveCommand extends Command {
  readonly commandName: 'career.recommend-move';
  readonly employmentId: string;
  readonly kind: MobilityKind;
  readonly targetPositionId?: string;
  readonly targetUnitId?: string;
  readonly rationale?: string;
  readonly validUntil?: string;
}

export interface RecommendationIdentified {
  readonly mobilityRecommendationId: string;
}

/**
 * Making a recommendation.
 *
 * A destination is not required: "this person is ready to move somewhere broader" is a real thing to
 * record before anybody knows where. Where one *is* named, it is confirmed to exist through
 * Organization's published contract — a suggestion pointing at a position that does not exist is one
 * nobody can weigh.
 *
 * The recommender and the day come from the authenticated context and the clock, never the command.
 */
export const recommendMoveHandler = (
  dependencies: CareerDependencies,
): CommandHandler<RecommendMoveCommand, RecommendationIdentified> => ({
  commandName: 'career.recommend-move',
  permission: CareerPermissions.mobilityRecommend,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.factsFor(command.employmentId);

      if (employment === undefined)
        return refuseWith<RecommendationIdentified>('employment-not-found');

      const destination = await confirmDestination(dependencies, command);

      if (destination !== undefined) return destination;

      const recommended = recommendMove({
        mobilityRecommendationId: uuidV7(),
        employmentId: command.employmentId,
        kind: command.kind,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
        ...(command.targetPositionId === undefined
          ? {}
          : { targetPositionId: command.targetPositionId }),
        ...(command.targetUnitId === undefined ? {} : { targetUnitId: command.targetUnitId }),
        ...(command.rationale === undefined ? {} : { rationale: command.rationale }),
        ...(command.validUntil === undefined ? {} : { validUntil: command.validUntil }),
      });

      if (!recommended.ok) return refusedBy<RecommendationIdentified>(recommended.error);

      await dependencies.stores.mobility.insert(transaction, recommended.value);
      return success({ mobilityRecommendationId: recommended.value.mobilityRecommendationId });
    }),
});

/** Confirms the destination through Organization, where one was named. Both reads, never a write. */
const confirmDestination = async (
  dependencies: CareerDependencies,
  command: RecommendMoveCommand,
): Promise<ReturnType<typeof refuseWith<RecommendationIdentified>> | undefined> => {
  if (
    command.targetPositionId !== undefined &&
    !(await dependencies.organization.positionExists(command.targetPositionId))
  ) {
    return refuseWith<RecommendationIdentified>('position-not-found');
  }
  if (
    command.targetUnitId !== undefined &&
    !(await dependencies.organization.unitExists(command.targetUnitId))
  ) {
    return refuseWith<RecommendationIdentified>('unit-not-found');
  }
  return undefined;
};

export interface DecideMoveCommand extends Command {
  readonly commandName: 'career.decide-move';
  readonly mobilityRecommendationId: string;
  readonly to: StoredMobilityStatus;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * Accepting or declining.
 *
 * **Accepting changes nothing outside this row.** It is the one state in this module a reader could
 * mistake for an action, and the handler does exactly one thing: it writes the decision, the day and
 * the person onto the recommendation. There is no branch here that touches an employment, and no
 * dependency in scope that could.
 *
 * `system:auto-approval` is refused by the domain and again by a check constraint: an agreement
 * nobody made is not an agreement.
 */
export const decideMoveHandler = (
  dependencies: CareerDependencies,
): CommandHandler<DecideMoveCommand, RecommendationIdentified> => ({
  commandName: 'career.decide-move',
  permission: CareerPermissions.mobilityDecide,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.mobility.byId(
        transaction,
        command.mobilityRecommendationId,
      );

      if (held === undefined) {
        return notFound<RecommendationIdentified>('career_mobility_recommendation');
      }

      const decided = decideMove(held, {
        to: command.to,
        on: civilDateOf(dependencies.clock.now()),
        by: currentActor(),
        ...(command.note === undefined ? {} : { note: command.note }),
      });

      if (!decided.ok) return refusedBy<RecommendationIdentified>(decided.error);

      await dependencies.stores.mobility.update(
        transaction,
        decided.value,
        command.expectedVersion,
      );
      return success({ mobilityRecommendationId: held.mobilityRecommendationId });
    }),
});
