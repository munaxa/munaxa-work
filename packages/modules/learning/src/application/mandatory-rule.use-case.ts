import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { defineRule, retireRule } from '../domain/mandatory-rule.js';
import type { LocalizedName } from '../domain/learning-rejection.js';
import type { AudienceKind, MandatoryKind } from '../domain/learning-vocabulary.js';
import { currentActor, notFound, refuseWith, refusedBy } from './learning-context.js';
import { LearningPermissions } from './learning-permissions.js';
import type { LearningDependencies } from './learning-dependencies.js';

/**
 * What a tenant made mandatory, of whom, and how often.
 *
 * **The rule fires nothing** (ADR-0071). It is configuration; `learning.reconcile-requirements` is
 * what turns it into assignments, and an administrator runs that. Nothing here schedules, nothing
 * here subscribes, and no field on the rule claims a robot is watching.
 *
 * **Every course is mandatory because a tenant said so** (AD-006). This product ships no rules, no
 * default compliance catalogue and no opinion about what training anybody needs.
 *
 * **The audience is validated where it is checkable and resolved when it is used.** A rule naming a
 * unit that does not exist would resolve to nobody, and a compliance rule silently covering nobody
 * is worse than no rule at all — so the unit is confirmed through Organization's published contract
 * at definition time, and the membership is read from Employment at reconciliation time so that a
 * person who transfers in tomorrow is covered without anybody editing anything.
 */

export interface DefineMandatoryRuleCommand extends Command {
  readonly commandName: 'learning.define-mandatory-rule';
  readonly courseId: string;
  readonly name: LocalizedName;
  readonly kind: MandatoryKind;
  readonly audience: AudienceKind;
  readonly organizationUnitId?: string;
  readonly positionId?: string;
  readonly effectiveFrom: string;
  readonly recurrenceMonths: number;
  readonly dueWithinDays: number;
}

export interface MandatoryRuleIdentified {
  readonly mandatoryRuleId: string;
}

export const defineMandatoryRuleHandler = (
  dependencies: LearningDependencies,
): CommandHandler<DefineMandatoryRuleCommand, MandatoryRuleIdentified> => ({
  commandName: 'learning.define-mandatory-rule',
  permission: LearningPermissions.mandatoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const course = await dependencies.stores.courses.byId(transaction, command.courseId);

      if (course === undefined) return notFound<MandatoryRuleIdentified>('learning_course');
      // A rule pointing at a course nobody can enrol into obliges people to do something
      // impossible, and they would carry an overdue item they had no way to clear.
      if (course.status !== 'published') {
        return refuseWith<MandatoryRuleIdentified>('rule-course-not-published');
      }

      const unknownUnit = await confirmUnit(dependencies, command.organizationUnitId);

      if (unknownUnit !== undefined) return refuseWith<MandatoryRuleIdentified>(unknownUnit);

      const defined = defineRule({ mandatoryRuleId: uuidV7(), ...command });

      if (!defined.ok) return refusedBy<MandatoryRuleIdentified>(defined.error);

      await dependencies.stores.rules.insert(transaction, defined.value);
      return success({ mandatoryRuleId: defined.value.mandatoryRuleId });
    }),
});

/**
 * That the unit exists, as Organization reports it.
 *
 * A read that could not be answered is refused rather than assumed: this module reads Organization
 * through a published contract under a bounded grant, and "the service did not answer" is not a
 * licence to record a compliance rule against a unit nobody confirmed.
 */
const confirmUnit = async (
  dependencies: LearningDependencies,
  organizationUnitId: string | undefined,
): Promise<string | undefined> => {
  if (organizationUnitId === undefined) return undefined;

  return (await dependencies.organization.unitExists(organizationUnitId))
    ? undefined
    : 'rule-organization-unit-unknown';
};

export interface RetireMandatoryRuleCommand extends Command {
  readonly commandName: 'learning.retire-mandatory-rule';
  readonly mandatoryRuleId: string;
  readonly expectedVersion: number;
}

/**
 * Retiring a rule stops it implying anything new and leaves what it already implied alone.
 *
 * Assignments already generated are historical facts about what somebody was asked to do. Deleting
 * them because the policy changed would destroy the compliance trail — "was this person asked to do
 * fire safety in 2024" has an answer, and it stays answered.
 */
export const retireMandatoryRuleHandler = (
  dependencies: LearningDependencies,
): CommandHandler<RetireMandatoryRuleCommand, MandatoryRuleIdentified> => ({
  commandName: 'learning.retire-mandatory-rule',
  permission: LearningPermissions.mandatoryManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.rules.byId(transaction, command.mandatoryRuleId);

      if (held === undefined) return notFound<MandatoryRuleIdentified>('learning_mandatory_rule');

      const retired = retireRule(held, dependencies.clock.now(), currentActor());

      if (!retired.ok) return refusedBy<MandatoryRuleIdentified>(retired.error);

      await dependencies.stores.rules.update(transaction, retired.value, command.expectedVersion);
      return success({ mandatoryRuleId: held.mandatoryRuleId });
    }),
});
