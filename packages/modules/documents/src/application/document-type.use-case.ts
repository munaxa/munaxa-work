import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import {
  createDocumentType,
  type DefineDocumentTypeRequest,
  type DocumentTypeState,
  type LocalizedName,
} from '../domain/document-type.js';
import { conflicted, notFound, refusedBy } from './documents-context.js';
import { DocumentsPermissions } from './documents-permissions.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Defining and amending what a tenant calls a kind of document.
 *
 * **Nothing statutory is created here or anywhere.** A passport type, a residency-permit type and a
 * work-permit type are all rows a customer or a country pack writes; this module ships the shape
 * and none of the content (00B, AD-002).
 *
 * Amendment is deliberately narrow. A type's `code` and its `ownerTypes` are not editable: existing
 * documents were filed against both, and changing either would retroactively make some of them
 * invalid or reclassify them. Visibility, notice thresholds and the retention code may change,
 * because those govern what happens next rather than what already happened.
 */

export interface DefineDocumentTypeCommand extends Command {
  readonly commandName: 'documents.define-type';
  readonly code: string;
  readonly name: LocalizedName;
  readonly ownerTypes: readonly string[];
  readonly expires: boolean;
  readonly requiresVerification: boolean;
  readonly confidentiality: string;
  readonly employeeVisible: boolean;
  readonly managerVisible: boolean;
  readonly retentionPolicyCode?: string;
  readonly noticeDays?: readonly number[];
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
}

export interface DocumentTypeDefined {
  readonly documentTypeId: string;
}

export const defineDocumentTypeHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<DefineDocumentTypeCommand, DocumentTypeDefined> => ({
  commandName: 'documents.define-type',
  permission: DocumentsPermissions.typeManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.types.byCode(transaction, command.code);

      // Checked before the insert for a readable refusal; the unique index is what actually
      // settles two administrators defining `passport` at the same moment.
      if (existing !== undefined) return conflicted<DocumentTypeDefined>('type_code_taken');

      const created = createDocumentType({ documentTypeId: uuidV7(), ...command });

      if (!created.ok) return refusedBy<DocumentTypeDefined>(created.error);

      await dependencies.stores.types.insert(transaction, created.value);
      return success({ documentTypeId: created.value.documentTypeId });
    }),
});

export interface AmendDocumentTypeCommand extends Command {
  readonly commandName: 'documents.amend-type';
  readonly documentTypeId: string;
  readonly expectedVersion: number;
  readonly name?: LocalizedName;
  readonly employeeVisible?: boolean;
  readonly managerVisible?: boolean;
  readonly noticeDays?: readonly number[];
  readonly retentionPolicyCode?: string;
  readonly active?: boolean;
}

export const amendDocumentTypeHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<AmendDocumentTypeCommand, DocumentTypeDefined> => ({
  commandName: 'documents.amend-type',
  permission: DocumentsPermissions.typeManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const held = await dependencies.stores.types.byId(transaction, command.documentTypeId);

      if (held === undefined) return notFound<DocumentTypeDefined>('document_type');

      const amended = createDocumentType(amendedShape(held, command));

      if (!amended.ok) return refusedBy<DocumentTypeDefined>(amended.error);

      await dependencies.stores.types.update(
        transaction,
        // `version` is not written by the caller: the repository appends `version = version + 1`,
        // and supplying it here would assign the column twice in one statement.
        { ...amended.value, active: command.active ?? held.active, version: held.version },
        command.expectedVersion,
      );
      return success({ documentTypeId: held.documentTypeId });
    }),
});

/**
 * The amended type, rebuilt through the aggregate's own constructor.
 *
 * Rebuilt rather than field-assigned so every invariant — the notice-threshold rule, the
 * confidential/manager-visible rule — is re-checked against the amended shape instead of only
 * against the original. `code` and `ownerTypes` are carried over unchanged: existing documents were
 * filed against both, and changing either would retroactively reclassify them.
 */
const amendedShape = (
  held: DocumentTypeState,
  command: AmendDocumentTypeCommand,
): DefineDocumentTypeRequest => {
  const retention = command.retentionPolicyCode ?? held.retentionPolicyCode;

  return {
    documentTypeId: held.documentTypeId,
    code: held.code,
    ownerTypes: held.ownerTypes,
    expires: held.expires,
    requiresVerification: held.requiresVerification,
    confidentiality: held.confidentiality,
    name: command.name ?? held.name,
    employeeVisible: command.employeeVisible ?? held.employeeVisible,
    managerVisible: command.managerVisible ?? held.managerVisible,
    noticeDays: command.noticeDays ?? held.noticeDays,
    ...(retention === undefined ? {} : { retentionPolicyCode: retention }),
    ...(held.countryPackId === undefined ? {} : { countryPackId: held.countryPackId }),
    ...(held.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: held.countryPackVersion }),
  };
};
