import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  createTemplate,
  draftTemplateVersion,
  editable,
  moveTemplateVersionTo,
  type LocalizedBody,
} from '../domain/letter-template.js';
import type { TemplateStatus } from '../domain/letters-vocabulary.js';
import { conflicted, notFound, refusedBy } from './letters-context.js';
import { LettersPermissions } from './letters-permissions.js';
import type { LettersDependencies } from './letters-dependencies.js';

/**
 * Authoring the letters a tenant may issue.
 *
 * **Nothing is hardcoded.** An employment certificate, a salary certificate, an experience letter
 * and an embassy letter are all rows a tenant or a country pack writes. There is no endpoint per
 * letter type and no letter type anywhere in this module's code (5.1 AD-001).
 *
 * **A version that has issued a letter is frozen**, and editing is refused three times over: by the
 * domain, by this handler and by a database trigger. The reason is the whole point of a letter
 * register — editing what a historical letter claims to have been generated from is the one thing
 * it exists to prevent. A change is a *new* version.
 */

export interface DefineTemplateCommand extends Command {
  readonly commandName: 'letters.define-template';
  readonly code: string;
  readonly name: LocalizedBody;
  readonly category: string;
  readonly requiresApproval: boolean;
  readonly employeeRequestable: boolean;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}

export interface TemplateDefined {
  readonly letterTemplateId: string;
}

export const defineTemplateHandler = (
  dependencies: LettersDependencies,
): CommandHandler<DefineTemplateCommand, TemplateDefined> => ({
  commandName: 'letters.define-template',
  permission: LettersPermissions.templateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.templates.byCode(transaction, command.code);

      // Checked before the insert for a readable refusal; the unique index is what actually
      // settles two administrators defining `salary-certificate` at the same moment.
      if (existing !== undefined) return conflicted<TemplateDefined>('template_code_taken');

      const created = createTemplate({ letterTemplateId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<TemplateDefined>(created.error);

      await dependencies.stores.templates.insert(transaction, created.value);
      return success({ letterTemplateId: created.value.letterTemplateId });
    }),
});

export interface DraftVersionCommand extends Command {
  readonly commandName: 'letters.draft-version';
  readonly letterTemplateId: string;
  readonly body: LocalizedBody;
  readonly variables: readonly string[];
  readonly exposedFields: readonly string[];
  readonly letterheadReference?: string;
  readonly requiresSignature?: boolean;
}

export interface VersionDrafted {
  readonly letterTemplateVersionId: string;
  readonly versionNumber: number;
}

/**
 * A new draft version, numbered from the highest already written inside this transaction.
 *
 * Both languages are required by the domain, so a template authored only in English — a letter an
 * Arabic speaker could not be issued — never reaches the database.
 */
export const draftVersionHandler = (
  dependencies: LettersDependencies,
): CommandHandler<DraftVersionCommand, VersionDrafted> => ({
  commandName: 'letters.draft-version',
  permission: LettersPermissions.templateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const template = await dependencies.stores.templates.byId(
        transaction,
        command.letterTemplateId,
      );

      if (template === undefined) return notFound<VersionDrafted>('letter_template');

      const highest = await dependencies.stores.templateVersions.highestVersionNumber(
        transaction,
        template.letterTemplateId,
      );
      const drafted = draftTemplateVersion({
        letterTemplateVersionId: uuidV7(),
        letterTemplateId: template.letterTemplateId,
        versionNumber: highest + 1,
        body: command.body,
        variables: command.variables,
        exposedFields: command.exposedFields,
        ...(command.letterheadReference === undefined
          ? {}
          : { letterheadReference: command.letterheadReference }),
        ...(command.requiresSignature === undefined
          ? {}
          : { requiresSignature: command.requiresSignature }),
      });

      if (!drafted.ok) return refusedBy<VersionDrafted>(drafted.error);

      await dependencies.stores.templateVersions.insert(transaction, drafted.value);
      return success({
        letterTemplateVersionId: drafted.value.letterTemplateVersionId,
        versionNumber: drafted.value.versionNumber,
      });
    }),
});

export interface MoveVersionCommand extends Command {
  readonly commandName: 'letters.move-version';
  readonly letterTemplateVersionId: string;
  readonly status: string;
  readonly expectedVersion: number;
}

export interface VersionMoved {
  readonly letterTemplateVersionId: string;
  readonly status: string;
}

/**
 * Publishing and retiring a version.
 *
 * Publishing makes it the template's current version; retiring leaves letters already issued from
 * it exactly as they are. A retired version cannot generate anything new, which is the difference
 * between withdrawing a letter type and rewriting history.
 */
export const moveVersionHandler = (
  dependencies: LettersDependencies,
): CommandHandler<MoveVersionCommand, VersionMoved> => ({
  commandName: 'letters.move-version',
  permission: LettersPermissions.templateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.templateVersions.byId(
        transaction,
        command.letterTemplateVersionId,
      );

      if (held === undefined) return notFound<VersionMoved>('letter_template_version');

      const moved = moveTemplateVersionTo(held, command.status as TemplateStatus);

      if (!moved.ok) return refusedBy<VersionMoved>(moved.error);

      await dependencies.stores.templateVersions.update(
        transaction,
        moved.value,
        command.expectedVersion,
      );
      if (moved.value.status === 'published') {
        await publish(dependencies, transaction, moved.value.letterTemplateId, moved.value);
      }
      return success({
        letterTemplateVersionId: held.letterTemplateVersionId,
        status: moved.value.status,
      });
    }),
});

/** Points the template at its newly published version, in the same transaction that published it. */
const publish = async (
  dependencies: LettersDependencies,
  transaction: Parameters<typeof dependencies.stores.templates.byId>[0],
  templateId: string,
  version: { readonly letterTemplateVersionId: string },
): Promise<void> => {
  const template = await dependencies.stores.templates.byId(transaction, templateId);

  if (template === undefined) return;
  await dependencies.stores.templates.update(
    transaction,
    { ...template, currentVersionId: version.letterTemplateVersionId },
    template.version,
  );
};

export interface AmendVersionCommand extends Command {
  readonly commandName: 'letters.amend-version';
  readonly letterTemplateVersionId: string;
  readonly expectedVersion: number;
  readonly body: LocalizedBody;
  readonly variables: readonly string[];
  readonly exposedFields: readonly string[];
  readonly letterheadReference?: string;
  readonly requiresSignature?: boolean;
}

/**
 * Editing a draft version that has issued nothing.
 *
 * The refusal here is the interesting half: once a version has issued a letter, `editable` says no
 * and it never says yes again. A published version that has issued nothing is still editable,
 * because nothing depends on it — the freeze is caused by *issuance*, not by publication.
 */
export const amendVersionHandler = (
  dependencies: LettersDependencies,
): CommandHandler<AmendVersionCommand, VersionDrafted> => ({
  commandName: 'letters.amend-version',
  permission: LettersPermissions.templateManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.templateVersions.byId(
        transaction,
        command.letterTemplateVersionId,
      );

      if (held === undefined) return notFound<VersionDrafted>('letter_template_version');

      const permitted = editable(held);

      if (!permitted.ok) return refusedBy<VersionDrafted>(permitted.error);

      // Rebuilt through the aggregate's own constructor so every invariant — both languages, every
      // placeholder declared, every exposed field known — is re-checked against the amended shape.
      const amended = draftTemplateVersion({
        letterTemplateVersionId: held.letterTemplateVersionId,
        letterTemplateId: held.letterTemplateId,
        versionNumber: held.versionNumber,
        body: command.body,
        variables: command.variables,
        exposedFields: command.exposedFields,
        ...(command.letterheadReference === undefined
          ? {}
          : { letterheadReference: command.letterheadReference }),
        ...(command.requiresSignature === undefined
          ? {}
          : { requiresSignature: command.requiresSignature }),
      });

      if (!amended.ok) return refusedBy<VersionDrafted>(amended.error);

      await dependencies.stores.templateVersions.update(
        transaction,
        { ...amended.value, status: held.status, version: held.version },
        command.expectedVersion,
      );
      return success({
        letterTemplateVersionId: held.letterTemplateVersionId,
        versionNumber: held.versionNumber,
      });
    }),
});
