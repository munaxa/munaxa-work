import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { addStage, archivePath, createPath, publishPath } from '../domain/path.js';
import { isCode, type CareerPathKind } from '../domain/career-vocabulary.js';
import type { LocalizedName } from '../domain/career-rejection.js';
import { conflicted, currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Career paths: the routes a tenant says somebody could follow, and the stages along them.
 *
 * **A path describes; it promises nobody anything.** Publishing a leadership path does not entitle
 * anyone to a leadership role, and no command here changes an employment or a position (ADR-0072).
 *
 * **`sequence` is an order, not a gate** (D-17). Nothing refuses a plan because an earlier stage is
 * unreached: prerequisites were never specified, and enforcing an unspecified one would block a real
 * career on a rule nobody wrote. Learning takes the same position on path steps.
 */

export interface CreateCareerPathCommand extends Command {
  readonly commandName: 'career.create-path';
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: CareerPathKind;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface PathIdentified {
  readonly pathId: string;
}

export const createPathHandler = (
  dependencies: CareerDependencies,
): CommandHandler<CreateCareerPathCommand, PathIdentified> => ({
  commandName: 'career.create-path',
  permission: CareerPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (!isCode(command.code)) return refuseWith<PathIdentified>('path-code-invalid');

      const taken = await dependencies.stores.paths.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted<PathIdentified>('career_path_code_taken');

      const created = createPath({ pathId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<PathIdentified>(created.error);

      await dependencies.stores.paths.insert(transaction, created.value);
      return success({ pathId: created.value.pathId });
    }),
});

export interface AddCareerStageCommand extends Command {
  readonly commandName: 'career.add-stage';
  readonly pathId: string;
  readonly sequence: number;
  readonly name: LocalizedName;
  readonly targetPositionId?: string;
}

export interface StageIdentified {
  readonly stageId: string;
}

/**
 * Putting a stage on a path, at a position.
 *
 * Where the tenant names a target position, it is **confirmed to exist through Organization's
 * published contract** before the identifier is stored — and nothing else about it is read. There is
 * no criticality here and there will not be one (AD-004): a copy would be the staler of two answers,
 * and the port that would return one does not exist.
 */
export const addStageHandler = (
  dependencies: CareerDependencies,
): CommandHandler<AddCareerStageCommand, StageIdentified> => ({
  commandName: 'career.add-stage',
  permission: CareerPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<StageIdentified>('career_path');

      const target = command.targetPositionId;

      if (target !== undefined && !(await dependencies.organization.positionExists(target))) {
        return refuseWith<StageIdentified>('position-not-found');
      }

      const held = await dependencies.stores.paths.stagesFor(transaction, path.pathId);

      if (held.some((stage) => stage.sequence === command.sequence)) {
        return conflicted<StageIdentified>('career_stage_sequence_taken');
      }

      const added = addStage(path, { stageId: uuidV7(), ...command });

      if (!added.ok) return refusedBy<StageIdentified>(added.error);

      await dependencies.stores.paths.insertStage(transaction, added.value);
      return success({ stageId: added.value.stageId });
    }),
});

export interface PublishCareerPathCommand extends Command {
  readonly commandName: 'career.publish-path';
  readonly pathId: string;
  readonly expectedVersion: number;
}

/** A path with nothing on it publishes nothing: it describes a route with no steps along it. */
export const publishPathHandler = (
  dependencies: CareerDependencies,
): CommandHandler<PublishCareerPathCommand, PathIdentified> => ({
  commandName: 'career.publish-path',
  permission: CareerPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathIdentified>('career_path');

      const stages = await dependencies.stores.paths.stageCountOf(transaction, path.pathId);
      const published = publishPath(path, stages);

      if (!published.ok) return refusedBy<PathIdentified>(published.error);

      await dependencies.stores.paths.update(transaction, published.value, command.expectedVersion);
      return success({ pathId: path.pathId });
    }),
});

export interface ArchiveCareerPathCommand extends Command {
  readonly commandName: 'career.archive-path';
  readonly pathId: string;
  readonly expectedVersion: number;
}

/**
 * Archiving a path.
 *
 * Terminal, and **not deletion**. A career plan written against this path in 2024 still names it,
 * and removing the path would make that plan unexplainable — the reasoning that keeps an archived
 * Learning course in the catalogue. Plans already naming it are left exactly as they are.
 */
export const archivePathHandler = (
  dependencies: CareerDependencies,
): CommandHandler<ArchiveCareerPathCommand, PathIdentified> => ({
  commandName: 'career.archive-path',
  permission: CareerPermissions.pathManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const path = await dependencies.stores.paths.byId(transaction, command.pathId);

      if (path === undefined) return notFound<PathIdentified>('career_path');

      const archived = archivePath(path, dependencies.clock.now(), currentActor());

      if (!archived.ok) return refusedBy<PathIdentified>(archived.error);

      await dependencies.stores.paths.update(transaction, archived.value, command.expectedVersion);
      return success({ pathId: path.pathId });
    }),
});
