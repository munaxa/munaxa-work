import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { amendDisciplinaryRule, defineDisciplinaryRule } from '../domain/disciplinary-ladder.js';
import { conflicted, notFound, refusedBy } from './relations-context.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Configuring the ladder — what a tenant decides a repeat attracts.
 *
 * **Configuration, and nothing else happens here.** Writing a rule issues nothing, disciplines
 * nobody and re-evaluates no existing case. It is the same separation the catalogue already has:
 * defining a violation type does not record a violation.
 *
 * **No rule is invented.** A tenant that configures nothing gets no prescription — the evaluation
 * returns an absent action rather than a default, because an undocumented default is a disciplinary
 * policy this product would be choosing on a customer's behalf (D-5.2-20).
 *
 * **Deactivation, not deletion.** A rule that prescribed an action somebody was issued must stay
 * readable, so it leaves service by going inactive. The issued action keeps its own frozen copy of
 * what the rule said in any case, so history survives both ways.
 */

export interface DefineDisciplinaryRuleCommand extends Command {
  readonly commandName: 'relations.define-disciplinary-rule';
  readonly violationCategoryId: string;
  /** The occurrence at or above which the rule applies. A threshold, never a counter. */
  readonly minOccurrence: number;
  readonly action: string;
  readonly sequence: number;
}

export interface DisciplinaryRuleDefined {
  readonly disciplinaryRuleId: string;
}

export const defineDisciplinaryRuleHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<DefineDisciplinaryRuleCommand, DisciplinaryRuleDefined> => ({
  commandName: 'relations.define-disciplinary-rule',
  permission: RelationsPermissions.ladderManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const category = await dependencies.stores.categories.byId(
        transaction,
        command.violationCategoryId,
      );

      // A ladder rung must hang on a real category — the catalogue is the source of category
      // identity and severity, and this references it rather than restating either.
      if (category === undefined) return notFound<DisciplinaryRuleDefined>('violation_category');

      const defined = defineDisciplinaryRule({
        disciplinaryRuleId: uuidV7(),
        violationCategoryId: command.violationCategoryId,
        minOccurrence: command.minOccurrence,
        action: command.action,
        sequence: command.sequence,
      });

      if (!defined.ok) return refusedBy<DisciplinaryRuleDefined>(defined.error);

      const existing = await dependencies.stores.disciplinaryRules.forCategory(
        transaction,
        command.violationCategoryId,
        false,
      );

      // The readable refusal for the ordinary case. `relation_disciplinary_rule_threshold_idx` is
      // what actually settles two administrators configuring the same rung at the same moment; this
      // read settles nothing under concurrency (ADR-0071).
      if (existing.some((rule) => rule.minOccurrence === command.minOccurrence)) {
        return conflicted<DisciplinaryRuleDefined>('rule_threshold_taken');
      }

      await dependencies.stores.disciplinaryRules.insert(transaction, defined.value);
      return success({ disciplinaryRuleId: defined.value.disciplinaryRuleId });
    }),
});

export interface AmendDisciplinaryRuleCommand extends Command {
  readonly commandName: 'relations.amend-disciplinary-rule';
  readonly disciplinaryRuleId: string;
  readonly expectedVersion: number;
  readonly action?: string;
  readonly sequence?: number;
  readonly active?: boolean;
}

export const amendDisciplinaryRuleHandler = (
  dependencies: RelationsDependencies,
): CommandHandler<AmendDisciplinaryRuleCommand, DisciplinaryRuleDefined> => ({
  commandName: 'relations.amend-disciplinary-rule',
  permission: RelationsPermissions.ladderManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.disciplinaryRules.byId(
        transaction,
        command.disciplinaryRuleId,
      );

      if (held === undefined) return notFound<DisciplinaryRuleDefined>('disciplinary_rule');

      const amended = amendDisciplinaryRule({
        rule: held,
        ...(command.action === undefined ? {} : { action: command.action }),
        ...(command.sequence === undefined ? {} : { sequence: command.sequence }),
        ...(command.active === undefined ? {} : { active: command.active }),
      });

      if (!amended.ok) return refusedBy<DisciplinaryRuleDefined>(amended.error);

      // `expectedVersion` is the caller's, so two administrators editing one rule do not silently
      // overwrite each other; the repository appends `version = version + 1`.
      await dependencies.stores.disciplinaryRules.update(
        transaction,
        amended.value,
        command.expectedVersion,
      );
      return success({ disciplinaryRuleId: held.disciplinaryRuleId });
    }),
});
