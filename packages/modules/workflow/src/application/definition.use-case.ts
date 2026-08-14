import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  addStep,
  archiveVersion,
  createDefinition,
  draftVersion,
  publishVersion,
  retireDefinition,
} from '../domain/definition.js';
import type { LocalizedName } from '../domain/workflow-vocabulary.js';
import { conflicted, currentActor, notFound, refusedBy } from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * The configuration a tenant writes: a process, its versions, and the steps along one.
 *
 * **Six named commands and no `changeStatus`.** Publishing a version and archiving one are different
 * acts with different consequences, and a generic status mutation would let a caller assign either
 * by sending a string — including states the domain has no transition into.
 *
 * **Every rule here is the domain's.** These handlers read, call, and write; they re-derive nothing.
 * The one thing they add is what the domain cannot see: the *set* facts. A definition's code is
 * unique per tenant and a version's number is unique per definition, and both are arbitrated by a
 * partial unique index rather than by a read-then-write check two administrators would both pass.
 * Where the store reports the collision, the handler maps it to a conflict.
 *
 * **`system:auto-approval` cannot reach any of this.** Configuration is not an approval, so there is
 * nothing here to refuse it on — the refusal lives on the decision, where the act is.
 */

export interface CreateDefinitionCommand extends Command {
  readonly commandName: 'workflow.create-definition';
  readonly code: string;
  readonly name: LocalizedName;
  readonly subjectType: string;
  readonly description?: string;
}

export interface DefinitionCreated {
  readonly definitionId: string;
}

export const createDefinitionHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<CreateDefinitionCommand, DefinitionCreated> => ({
  commandName: 'workflow.create-definition',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const made = createDefinition({
        definitionId: uuidV7(),
        code: command.code,
        name: command.name,
        subjectType: command.subjectType,
        ...(command.description === undefined ? {} : { description: command.description }),
      });

      if (!made.ok) return refusedBy(made.error);

      const taken = await dependencies.stores.definitions.byCode(transaction, command.code);

      if (taken !== undefined) return conflicted('workflow_definition_code_taken');

      await dependencies.stores.definitions.insert(transaction, made.value);
      return success({ definitionId: made.value.definitionId });
    }),
});

export interface RetireDefinitionCommand extends Command {
  readonly commandName: 'workflow.retire-definition';
  readonly definitionId: string;
  readonly expectedVersion: number;
}

/**
 * Retiring a definition.
 *
 * Terminal, and it stops nothing already running: an instance carries its own copy of the steps, so
 * there is nothing for retirement to pull out from under a half-finished approval (AD-003).
 */
export const retireDefinitionHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<RetireDefinitionCommand, { readonly retired: true }> => ({
  commandName: 'workflow.retire-definition',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.definitions.byId(transaction, command.definitionId);

      if (held === undefined) return notFound('workflow-definition');

      const retired = retireDefinition(held, dependencies.clock.now(), currentActor());

      if (!retired.ok) return refusedBy(retired.error);

      await dependencies.stores.definitions.update(
        transaction,
        retired.value,
        command.expectedVersion,
      );
      return success({ retired: true as const });
    }),
});

export interface DraftVersionCommand extends Command {
  readonly commandName: 'workflow.draft-version';
  readonly definitionId: string;
}

export interface VersionDrafted {
  readonly workflowVersionId: string;
  readonly versionNumber: number;
}

/**
 * A new draft against a definition.
 *
 * The number is the store's answer rather than the caller's: a caller-supplied version number would
 * let two administrators pick the same one, and the uniqueness that settles it is an index, so the
 * losing writer would get a conflict on a value they never chose.
 */
export const draftVersionHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<DraftVersionCommand, VersionDrafted> => ({
  commandName: 'workflow.draft-version',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const definition = await dependencies.stores.definitions.byId(
        transaction,
        command.definitionId,
      );

      if (definition === undefined) return notFound('workflow-definition');

      const number = await dependencies.stores.versions.nextNumberFor(
        transaction,
        command.definitionId,
      );
      const drafted = draftVersion(definition, {
        workflowVersionId: uuidV7(),
        versionNumber: number,
      });

      if (!drafted.ok) return refusedBy(drafted.error);

      await dependencies.stores.versions.insert(transaction, drafted.value);
      return success({
        workflowVersionId: drafted.value.workflowVersionId,
        versionNumber: drafted.value.versionNumber,
      });
    }),
});

export interface AddStepCommand extends Command {
  readonly commandName: 'workflow.add-step';
  readonly workflowVersionId: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly approverMembershipId: string;
}

/**
 * Adding a step to a draft.
 *
 * **`approverKind` is not a command field.** One kind exists in Phase 16A and the handler states it,
 * so a caller cannot name `role` or `group` and get a refusal that reads like a typo rather than a
 * capability this product does not have (D-3, D-4).
 *
 * Ordinal uniqueness within a version is the index's; the store reports the collision and this maps
 * it to a conflict rather than pre-checking a fact two administrators could pass at once.
 */
export const addStepHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<AddStepCommand, { readonly stepTemplateId: string }> => ({
  commandName: 'workflow.add-step',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const version = await dependencies.stores.versions.byId(
        transaction,
        command.workflowVersionId,
      );

      if (version === undefined) return notFound('workflow-version');

      const added = addStep(version, {
        stepTemplateId: uuidV7(),
        ordinal: command.ordinal,
        name: command.name,
        approverKind: 'membership',
        approverMembershipId: command.approverMembershipId,
      });

      if (!added.ok) return refusedBy(added.error);

      const existing = await dependencies.stores.versions.templatesFor(
        transaction,
        command.workflowVersionId,
      );

      if (existing.some((template) => template.ordinal === command.ordinal)) {
        return conflicted('workflow_step_template_ordinal_taken');
      }

      await dependencies.stores.versions.insertTemplate(transaction, added.value);
      return success({ stepTemplateId: added.value.stepTemplateId });
    }),
});

export interface PublishVersionCommand extends Command {
  readonly commandName: 'workflow.publish-version';
  readonly workflowVersionId: string;
  readonly expectedVersion: number;
}

/**
 * Publishing: the moment a version stops being editable and starts being followed.
 *
 * The steps are read and handed to the domain, which refuses an empty version and an order that is
 * not contiguous from one. Neither check is repeated here — the handler's only job is to fetch the
 * set the domain cannot see for itself.
 */
export const publishVersionHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<PublishVersionCommand, { readonly published: true }> => ({
  commandName: 'workflow.publish-version',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.versions.byId(transaction, command.workflowVersionId);

      if (held === undefined) return notFound('workflow-version');

      const templates = await dependencies.stores.versions.templatesFor(
        transaction,
        command.workflowVersionId,
      );
      const published = publishVersion(held, templates, dependencies.clock.now(), currentActor());

      if (!published.ok) return refusedBy(published.error);

      await dependencies.stores.versions.update(
        transaction,
        published.value,
        command.expectedVersion,
      );
      return success({ published: true as const });
    }),
});

export interface ArchiveVersionCommand extends Command {
  readonly commandName: 'workflow.archive-version';
  readonly workflowVersionId: string;
  readonly expectedVersion: number;
}

/** Archiving. New approvals stop choosing it; the ones already running are untouched (AD-003). */
export const archiveVersionHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<ArchiveVersionCommand, { readonly archived: true }> => ({
  commandName: 'workflow.archive-version',
  permission: WorkflowPermissions.definitionManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.versions.byId(transaction, command.workflowVersionId);

      if (held === undefined) return notFound('workflow-version');

      const archived = archiveVersion(held);

      if (!archived.ok) return refusedBy(archived.error);

      await dependencies.stores.versions.update(
        transaction,
        archived.value,
        command.expectedVersion,
      );
      return success({ archived: true as const });
    }),
});
