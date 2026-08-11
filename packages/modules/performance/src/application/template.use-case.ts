import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { defineTemplate, retireTemplate } from '../domain/review-template.js';
import { conflicted, notFound, refuseWith, refusedBy } from './performance-context.js';
import { PerformancePermissions } from './performance-permissions.js';
import type { LocalizedNameInput } from './localized.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * The review template: which scale, which framework, what is required, and what the components
 * weigh.
 *
 * **This is where the first approved scoring decision is refused for the first of three times.**
 * The component weights are integer basis points and must total exactly 10,000. No check constraint
 * can see across rows, so the rule is enforced here when a template is defined, again by the
 * scoring engine before a review is scored, and reported a third time by the reconciliation query.
 * A rule enforced in only one of those places is a rule that some later bulk path will bypass.
 *
 * **A template is defined whole and retired, never amended.** A cycle running against it enrolled
 * its participants under its rules; changing the component weights underneath them would change
 * what those reviews are measured by, halfway through measuring them. A different shape is a new
 * template.
 *
 * The scale and the framework are confirmed to exist here rather than being taken on trust: a
 * template pointing at a rating scale nobody defined is a cycle that fails at the moment somebody
 * tries to score it, which is the worst possible moment to find out.
 */

export interface DefineTemplateCommand extends Command {
  readonly commandName: 'performance.define-template';
  readonly code: string;
  readonly name: LocalizedNameInput;
  readonly description?: LocalizedNameInput;
  readonly ratingScaleId: string;
  readonly competencyFrameworkId?: string;
  readonly requiresSelfAssessment: boolean;
  readonly requiresPeerAssessment: boolean;
  readonly requiresCalibration: boolean;
  readonly goalWeightTotalBasisPoints: number;
  readonly minimumPeerResponses?: number;
  readonly components: readonly {
    readonly component: string;
    readonly weightBasisPoints: number;
  }[];
}

export interface TemplateDefined {
  readonly templateId: string;
}

export const defineTemplateHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<DefineTemplateCommand, TemplateDefined> => ({
  commandName: 'performance.define-template',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.templates.byCode(transaction, command.code);

      if (existing !== undefined) return conflicted<TemplateDefined>('template_code_taken');

      const scale = await dependencies.stores.ratingScales.byId(transaction, command.ratingScaleId);

      if (scale === undefined) return notFound<TemplateDefined>('performance_rating_scale');
      if (!scale.active) return refuseWith<TemplateDefined>('review-template-scale-retired');

      const framework = await frameworkFor(dependencies, transaction, command);

      if (framework === 'missing') {
        return notFound<TemplateDefined>('performance_competency_framework');
      }
      if (framework === 'retired') {
        return refuseWith<TemplateDefined>('review-template-framework-retired');
      }

      const templateId = uuidV7();
      const defined = defineTemplate({
        templateId,
        ...command,
        components: command.components.map((component) => ({
          templateComponentId: uuidV7(),
          ...component,
        })),
      });

      if (!defined.ok) return refusedBy<TemplateDefined>(defined.error);

      await dependencies.stores.templates.insert(
        transaction,
        defined.value.template,
        defined.value.components,
      );
      return success({ templateId });
    }),
});

/**
 * Whether the framework a template names exists and is still current.
 *
 * Returns a small verdict rather than the framework itself: the caller needs to distinguish "not
 * there" from "there but retired" — one is a 404 and the other a refusal — and nothing downstream
 * needs the row.
 */
const frameworkFor = async (
  dependencies: PerformanceDependencies,
  transaction: Transaction,
  command: DefineTemplateCommand,
): Promise<'absent' | 'missing' | 'retired' | 'present'> => {
  if (command.competencyFrameworkId === undefined) return 'absent';

  const framework = await dependencies.stores.frameworks.byId(
    transaction,
    command.competencyFrameworkId,
  );

  if (framework === undefined) return 'missing';
  return framework.active ? 'present' : 'retired';
};

export interface RetireTemplateCommand extends Command {
  readonly commandName: 'performance.retire-template';
  readonly templateId: string;
  readonly expectedVersion: number;
}

export const retireTemplateHandler = (
  dependencies: PerformanceDependencies,
): CommandHandler<RetireTemplateCommand, TemplateDefined> => ({
  commandName: 'performance.retire-template',
  permission: PerformancePermissions.configure,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.templates.byId(transaction, command.templateId);

      if (held === undefined) return notFound<TemplateDefined>('performance_review_template');

      const retired = retireTemplate(held);

      if (!retired.ok) return refusedBy<TemplateDefined>(retired.error);

      await dependencies.stores.templates.update(
        transaction,
        { ...retired.value, version: held.version },
        command.expectedVersion,
      );
      return success({ templateId: held.templateId });
    }),
});
