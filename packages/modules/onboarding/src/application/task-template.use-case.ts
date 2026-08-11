import { success, type Command, type CommandHandler } from '@work/kernel';

import { taskTemplate } from '../domain/plan-version.js';
import type { DueAnchor, OwnerKind, TaskKind } from '../domain/onboarding-vocabulary.js';
import type { Metadata } from '../domain/onboarding-aggregate.js';

import { conflicted, currentTenant, notFound, refusedBy } from './onboarding-context.js';
import { OnboardingPermissions } from './onboarding-permissions.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * Adding a task to a draft plan version, and taking one off.
 *
 * Both refuse unless the version is a draft, and that single check is what the whole plan model
 * rests on: a published version is what onboardings were generated from and what an auditor reads,
 * so it never changes (ADR-0048). There is deliberately no "edit a published template" command, and
 * there will not be one — the way to change next quarter's checklist is to draft the next version.
 *
 * Removal is soft. "Who took the safety briefing off the field-engineer plan" is a question a hard
 * delete makes unanswerable.
 */

export interface DefineTaskTemplateCommand extends Command {
  readonly commandName: 'onboarding.define-task-template';
  readonly planVersionId: string;
  readonly code: string;
  readonly sequence: number;
  readonly title: Readonly<Record<string, string>>;
  readonly description?: Readonly<Record<string, string>>;
  readonly kind: TaskKind;
  readonly ownerKind: OwnerKind;
  readonly ownerRef?: string;
  readonly ownerRole?: string;
  readonly required?: boolean;
  readonly dueAnchor?: DueAnchor;
  readonly dueOffsetDays?: number;
  readonly dependsOnTemplateCode?: string;
  readonly documentTypeCode?: string;
  readonly metadata?: Metadata;
}

export interface TemplateAffected {
  readonly planVersionId: string;
  readonly templateId: string;
  readonly code: string;
}

export const defineTaskTemplateHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<DefineTaskTemplateCommand, TemplateAffected> => ({
  commandName: 'onboarding.define-task-template',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const version = await dependencies.stores.planVersions.byId(
        transaction,
        command.planVersionId,
      );

      if (version === undefined) return notFound<TemplateAffected>('plan version');
      // The rule the whole plan model rests on: a published version never changes.
      if (version.status !== 'draft') return conflicted('plan_version_not_draft');

      const existing = await dependencies.stores.templates.byCode(
        transaction,
        command.planVersionId,
        command.code,
      );

      if (existing !== undefined) return conflicted('task_template_code_taken');

      const template = taskTemplate(
        { tenantId: currentTenant(), ...command },
        dependencies.clock.now(),
      );

      if (!template.ok) return refusedBy(template.error);

      await dependencies.stores.templates.insert(transaction, template.value);
      return success({
        planVersionId: command.planVersionId,
        templateId: template.value.id,
        code: template.value.code,
      });
    }),
});

export interface RemoveTaskTemplateCommand extends Command {
  readonly commandName: 'onboarding.remove-task-template';
  readonly planVersionId: string;
  readonly code: string;
}

export const removeTaskTemplateHandler = (
  dependencies: OnboardingDependencies,
): CommandHandler<RemoveTaskTemplateCommand, TemplateAffected> => ({
  commandName: 'onboarding.remove-task-template',
  permission: OnboardingPermissions.planManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const version = await dependencies.stores.planVersions.byId(
        transaction,
        command.planVersionId,
      );

      if (version === undefined) return notFound<TemplateAffected>('plan version');
      if (version.status !== 'draft') return conflicted('plan_version_not_draft');

      const template = await dependencies.stores.templates.byCode(
        transaction,
        command.planVersionId,
        command.code,
      );

      if (template === undefined) return notFound<TemplateAffected>('task template');

      await dependencies.stores.templates.remove(transaction, template.id, template.version);
      return success({
        planVersionId: command.planVersionId,
        templateId: template.id,
        code: template.code,
      });
    }),
});
