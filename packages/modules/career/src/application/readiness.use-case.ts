import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import {
  deactivateReadinessLevel,
  defineReadinessLevel,
  recordReadiness,
} from '../domain/readiness.js';
import { isCode } from '../domain/career-vocabulary.js';
import type { LocalizedName } from '../domain/career-rejection.js';
import { conflicted, currentActor, notFound, refuseWith, refusedBy } from './career-context.js';
import { CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Readiness: a tenant's levels, and one person's statement that somebody is at one of them.
 *
 * **Readiness is stated by a person. Nothing computes it** (ADR-0074, D-10).
 *
 * The inputs a derivation would use are all sitting there: Performance publishes a potential band,
 * Learning publishes completions and certifications, Employment publishes tenure. Something like
 * *potential band 3 plus the leadership path completed equals Ready Now* would be ten lines and
 * indistinguishable in its output from a specified rule.
 *
 * It is refused because a readiness level decides who is put forward for a director's post; it is
 * read by people who will act on it, and the person it describes is not in the room. So there is no
 * score in the command, no weighting in the handler, no derived level in the result and **no port
 * that reads any of those inputs** — the Performance port does not exist at all.
 *
 * **A level is configuration; an assessment is a historical fact.** Retiring a level deactivates it
 * rather than deleting it, because assessments recorded at that level are statements somebody made
 * and removing the level would make them unreadable.
 *
 * **An assessment is append-only** (D-14). There is no amend command in this file and no update
 * method on the store; the database refuses it again with a trigger. A correction is a *new*
 * assessment, so the trail shows what was thought and when it changed.
 */

export interface DefineReadinessLevelCommand extends Command {
  readonly commandName: 'career.define-readiness-level';
  readonly code: string;
  readonly name: LocalizedName;
  readonly ordinal: number;
}

export interface ReadinessLevelIdentified {
  readonly readinessLevelId: string;
}

/**
 * Configuring a level on the tenant's own ladder.
 *
 * `ordinal` orders the levels least to most ready so a screen can sort them and a consumer can
 * compare by index. **It is not published as a scale** — the construction Organization uses for
 * `POSITION_CRITICALITIES`, and for the same reason: publishing a number means promising it stays
 * stable and means something, and neither is true of a vocabulary the tenant wrote.
 *
 * Two levels cannot share an ordinal, because a ladder with two rungs at the same height does not
 * order anything.
 */
export const defineReadinessLevelHandler = (
  dependencies: CareerDependencies,
): CommandHandler<DefineReadinessLevelCommand, ReadinessLevelIdentified> => ({
  commandName: 'career.define-readiness-level',
  permission: CareerPermissions.readinessRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      if (!isCode(command.code)) {
        return refuseWith<ReadinessLevelIdentified>('readiness-level-code-invalid');
      }

      const byCode = await dependencies.stores.readinessLevels.byCode(transaction, command.code);

      if (byCode !== undefined) {
        return conflicted<ReadinessLevelIdentified>('career_readiness_level_code_taken');
      }

      const byOrdinal = await dependencies.stores.readinessLevels.byOrdinal(
        transaction,
        command.ordinal,
      );

      if (byOrdinal !== undefined) {
        return conflicted<ReadinessLevelIdentified>('career_readiness_level_ordinal_taken');
      }

      const defined = defineReadinessLevel({ readinessLevelId: uuidV7(), ...command });

      if (!defined.ok) return refusedBy<ReadinessLevelIdentified>(defined.error);

      await dependencies.stores.readinessLevels.insert(transaction, defined.value);
      return success({ readinessLevelId: defined.value.readinessLevelId });
    }),
});

export interface DeactivateReadinessLevelCommand extends Command {
  readonly commandName: 'career.deactivate-readiness-level';
  readonly readinessLevelId: string;
  readonly expectedVersion: number;
}

/** Retiring a level. Deactivation, not deletion — the assessments recorded at it must stay readable. */
export const deactivateReadinessLevelHandler = (
  dependencies: CareerDependencies,
): CommandHandler<DeactivateReadinessLevelCommand, ReadinessLevelIdentified> => ({
  commandName: 'career.deactivate-readiness-level',
  permission: CareerPermissions.readinessRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const level = await dependencies.stores.readinessLevels.byId(
        transaction,
        command.readinessLevelId,
      );

      if (level === undefined) return notFound<ReadinessLevelIdentified>('career_readiness_level');

      const deactivated = deactivateReadinessLevel(level);

      if (!deactivated.ok) return refusedBy<ReadinessLevelIdentified>(deactivated.error);

      await dependencies.stores.readinessLevels.update(
        transaction,
        deactivated.value,
        command.expectedVersion,
      );
      return success({ readinessLevelId: level.readinessLevelId });
    }),
});

export interface RecordReadinessCommand extends Command {
  readonly commandName: 'career.record-readiness';
  readonly employmentId: string;
  readonly readinessLevelId: string;
  readonly positionId?: string;
  readonly successionPlanId?: string;
  readonly assessedOn: string;
  readonly rationale?: string;
}

export interface ReadinessAssessmentIdentified {
  readonly readinessAssessmentId: string;
}

/**
 * Recording one assessor's statement.
 *
 * The assessment must be *about* something — a position or a succession plan. "This person is ready"
 * with no answer to "ready for what" is not a statement anybody can act on or challenge.
 *
 * The assessor is the authenticated actor and never a command field, and `system:auto-approval` is
 * refused by the domain and again by a check constraint: a readiness level with no human behind it
 * is precisely the derived score this module exists not to produce.
 *
 * `assessedOn` is the caller's civil day, because an assessment is often written up after the
 * conversation it records. `recordedAt` is the clock's instant, and it is what breaks a tie between
 * two assessments made on the same day — the later one is the correction.
 *
 * **There is no evidence-document field, and its absence is deliberate.** The plan listed
 * `documents.read-document` as an available dependency, but Checkpoint 3's
 * `career_readiness_assessment` carries no evidence column and the domain state carries no such
 * field. A command that accepted a document identifier, confirmed it existed and then stored nothing
 * would be validation theatre — the caller would reasonably believe the citation was kept. Adding a
 * column is a schema change this checkpoint may not make, so the capability is `NOT VERIFIED` and
 * the field does not exist. `StoragePort` has no adapter in any case, so upload and download were
 * never buildable.
 */
export const recordReadinessHandler = (
  dependencies: CareerDependencies,
): CommandHandler<RecordReadinessCommand, ReadinessAssessmentIdentified> => ({
  commandName: 'career.record-readiness',
  permission: CareerPermissions.readinessRecord,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const refusal = await confirmSubject(dependencies, transaction, command);

      if (refusal !== undefined) return refusal;

      const recorded = recordReadiness({
        readinessAssessmentId: uuidV7(),
        employmentId: command.employmentId,
        readinessLevelId: command.readinessLevelId,
        assessedOn: command.assessedOn,
        assessedBy: currentActor(),
        at: dependencies.clock.now(),
        ...(command.positionId === undefined ? {} : { positionId: command.positionId }),
        ...(command.successionPlanId === undefined
          ? {}
          : { successionPlanId: command.successionPlanId }),
        ...(command.rationale === undefined ? {} : { rationale: command.rationale }),
      });

      if (!recorded.ok) return refusedBy<ReadinessAssessmentIdentified>(recorded.error);

      await dependencies.stores.assessments.insert(transaction, recorded.value);
      return success({ readinessAssessmentId: recorded.value.readinessAssessmentId });
    }),
});

/**
 * Confirms everything the assessment points at, before a word of it is written.
 *
 * Split out because the handler's own budget is for the act, not for four lookups — and because
 * every one of these is a *reference to somebody else's fact*, which is the thing this module is
 * most at risk of getting wrong.
 */
const confirmSubject = async (
  dependencies: CareerDependencies,
  transaction: Transaction,
  command: RecordReadinessCommand,
): Promise<ReturnType<typeof refuseWith<ReadinessAssessmentIdentified>> | undefined> => {
  const employment = await dependencies.employment.factsFor(command.employmentId);

  if (employment === undefined) {
    return refuseWith<ReadinessAssessmentIdentified>('employment-not-found');
  }

  const level = await dependencies.stores.readinessLevels.byId(
    transaction,
    command.readinessLevelId,
  );

  if (level === undefined || !level.active) {
    return refuseWith<ReadinessAssessmentIdentified>('readiness-level-not-found');
  }
  if (
    command.positionId !== undefined &&
    !(await dependencies.organization.positionExists(command.positionId))
  ) {
    return refuseWith<ReadinessAssessmentIdentified>('position-not-found');
  }
  if (
    command.successionPlanId !== undefined &&
    (await dependencies.stores.successionPlans.byId(transaction, command.successionPlanId)) ===
      undefined
  ) {
    return refuseWith<ReadinessAssessmentIdentified>('succession-plan-not-found');
  }
  return undefined;
};
