import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { createDocument, moveDocumentTo, versionAdded } from '../domain/document.js';
import { createVersion, nextVersionNumber } from '../domain/document-version.js';
import {
  isOwnerType,
  type DocumentSource,
  type OwnerType,
} from '../domain/documents-vocabulary.js';
import type { LocalizedName } from '../domain/document-type.js';
import { recordAccessFor } from './access-recording.js';
import { conflicted, currentActor, notFound, refusedBy } from './documents-context.js';
import { DocumentsPermissions } from './documents-permissions.js';
import type { DocumentsDependencies } from './documents-dependencies.js';

/**
 * Creating a document and putting files under it.
 *
 * **The owner is confirmed before the row exists.** `owner_type` + `owner_id` carries no foreign key
 * — a polymorphic reference cannot, and Phase 11 established that a cross-module one would not
 * enforce tenant isolation anyway (ADR-0042) — so the check is a published contract read. An owner
 * nobody can confirm is a refusal rather than a row somebody has to explain in a year.
 *
 * **The D-1a boundary is enforced here as well as in the domain and the database.** When a document
 * evidences a People identifier, this asks People whether that identifier exists before accepting
 * the reference. Documents stores the id and nothing else about it; the number, the issuing country
 * and the expiry stay where People owns them.
 *
 * **Adding a version never overwrites one.** The version number is allocated from the highest one
 * already written, inside the same transaction, and the unique index is what settles two
 * administrators replacing the same file at the same moment — the loser is refused rather than
 * silently producing a second "version 2".
 */

export interface CreateDocumentCommand extends Command {
  readonly commandName: 'documents.create-document';
  readonly documentTypeId: string;
  readonly ownerType: string;
  readonly ownerId: string;
  readonly personIdentifierId?: string;
  readonly title: LocalizedName;
  readonly issueDate?: string;
  readonly expiryDate?: string;
  readonly source?: string;
  readonly sourceReference?: string;
}

export interface DocumentCreated {
  readonly documentId: string;
}

const SOURCES: readonly string[] = ['direct', 'recruitment', 'onboarding', 'letter', 'migration'];

export const createDocumentHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<CreateDocumentCommand, DocumentCreated> => ({
  commandName: 'documents.create-document',
  permission: DocumentsPermissions.manage,

  handle: async (command) => {
    if (!isOwnerType(command.ownerType)) {
      return conflicted<DocumentCreated>('owner_type_unknown');
    }
    if (command.source !== undefined && !SOURCES.includes(command.source)) {
      return conflicted<DocumentCreated>('document_source_unknown');
    }

    const confirmed = await confirmOwner(dependencies, command);

    if (confirmed !== undefined) return confirmed;

    return dependencies.unitOfWork.execute(async (transaction) => {
      const type = await dependencies.stores.types.byId(transaction, command.documentTypeId);

      if (type === undefined) return notFound<DocumentCreated>('document_type');
      if (!type.active) return conflicted<DocumentCreated>('document_type_inactive');

      const created = createDocument({
        documentId: uuidV7(),
        type,
        ownerType: command.ownerType as OwnerType,
        ownerId: command.ownerId,
        title: command.title,
        source: (command.source ?? 'direct') as DocumentSource,
        ...(command.personIdentifierId === undefined
          ? {}
          : { personIdentifierId: command.personIdentifierId }),
        ...(command.issueDate === undefined ? {} : { issueDate: command.issueDate }),
        ...(command.expiryDate === undefined ? {} : { expiryDate: command.expiryDate }),
        ...(command.sourceReference === undefined
          ? {}
          : { sourceReference: command.sourceReference }),
      });

      if (!created.ok) return refusedBy<DocumentCreated>(created.error);

      await dependencies.stores.documents.insert(transaction, created.value);
      return success({ documentId: created.value.documentId });
    });
  },
});

/**
 * The two cross-module confirmations, both through published contracts.
 *
 * Outside the transaction on purpose: they are reads of other modules, and holding a database
 * connection open across them would make one module's latency the other's lock duration.
 */
const confirmOwner = async (
  dependencies: DocumentsDependencies,
  command: CreateDocumentCommand,
): Promise<ReturnType<typeof conflicted<DocumentCreated>> | undefined> => {
  const exists = await dependencies.owners.exists(command.ownerType, command.ownerId);

  if (!exists) return conflicted<DocumentCreated>('owner_not_found');
  if (command.personIdentifierId === undefined) return undefined;
  if (command.ownerType !== 'person') {
    // An identifier belongs to a person. A document owned by an employment or a legal entity
    // cannot evidence one without saying whose.
    return conflicted<DocumentCreated>('identifier_requires_person_owner');
  }

  const facts = await dependencies.identifiers.factsFor(
    command.ownerId,
    command.personIdentifierId,
  );

  return facts === undefined
    ? conflicted<DocumentCreated>('person_identifier_not_found')
    : undefined;
};

export interface AddVersionCommand extends Command {
  readonly commandName: 'documents.add-version';
  readonly documentId: string;
  readonly storageReference: string;
  readonly originalFileName: string;
  readonly declaredMediaType: string;
  readonly sizeInBytes: string;
  readonly contentHash: string;
  readonly source?: string;
}

export interface VersionAdded {
  readonly documentId: string;
  readonly documentVersionId: string;
  readonly versionNumber: number;
  /** Other versions in this tenant holding the same bytes. Permitted, and surfaced (D-5). */
  readonly duplicateOfVersionIds: readonly string[];
}

export const addVersionHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<AddVersionCommand, VersionAdded> => ({
  commandName: 'documents.add-version',
  permission: DocumentsPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, command.documentId);

      if (document === undefined) return notFound<VersionAdded>('document');
      if (document.legalHold) return conflicted<VersionAdded>('document_under_legal_hold');
      if (document.status === 'archived' || document.status === 'superseded') {
        return conflicted<VersionAdded>('document_not_writable');
      }

      const type = await dependencies.stores.types.byId(transaction, document.documentTypeId);

      if (type === undefined) return notFound<VersionAdded>('document_type');

      const created = createVersion({
        documentVersionId: uuidV7(),
        documentId: document.documentId,
        versionNumber: nextVersionNumber(
          await dependencies.stores.versions.highestVersionNumber(transaction, document.documentId),
        ),
        storageReference: command.storageReference,
        originalFileName: command.originalFileName,
        declaredMediaType: command.declaredMediaType,
        sizeInBytes: BigInt(command.sizeInBytes),
        contentHash: command.contentHash,
        source: (command.source ?? 'direct') as DocumentSource,
      });

      if (!created.ok) return refusedBy<VersionAdded>(created.error);

      const duplicates = await dependencies.stores.versions.byContentHash(
        transaction,
        created.value.contentHash,
        DUPLICATE_SCAN_LIMIT,
      );

      await persistVersion(dependencies, transaction, document.currentVersionId, created.value);
      await dependencies.stores.documents.update(
        transaction,
        versionAdded(document, created.value.documentVersionId, type.requiresVerification),
        document.version,
      );
      await recordAccessFor(dependencies, transaction, {
        documentId: document.documentId,
        documentVersionId: created.value.documentVersionId,
        action: 'replaced',
      });

      return success({
        documentId: document.documentId,
        documentVersionId: created.value.documentVersionId,
        versionNumber: created.value.versionNumber,
        duplicateOfVersionIds: duplicates.map((one) => one.documentVersionId),
      });
    }),
});

/** Bounded: a tenant that uploaded the same file ten thousand times needs a count, not a list. */
const DUPLICATE_SCAN_LIMIT = 20;

const persistVersion = async (
  dependencies: DocumentsDependencies,
  transaction: Transaction,
  previousVersionId: string | undefined,
  version: Parameters<typeof dependencies.stores.versions.insert>[1],
): Promise<void> => {
  await dependencies.stores.versions.insert(transaction, version);
  if (previousVersionId !== undefined) {
    // A stamp on the row that is no longer current. The version's content is untouched — the
    // trigger permits this one column and refuses everything else.
    await dependencies.stores.versions.supersede(
      transaction,
      previousVersionId,
      dependencies.clock.now(),
    );
  }
};

export interface MoveDocumentCommand extends Command {
  readonly commandName: 'documents.move-document';
  readonly documentId: string;
  readonly status: string;
  readonly expectedVersion: number;
}

export interface DocumentMoved {
  readonly documentId: string;
  readonly status: string;
}

/** Archive and restore. There is no permanent deletion in this phase (D-10). */
export const moveDocumentHandler = (
  dependencies: DocumentsDependencies,
): CommandHandler<MoveDocumentCommand, DocumentMoved> => ({
  commandName: 'documents.move-document',
  permission: DocumentsPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const document = await dependencies.stores.documents.byId(transaction, command.documentId);

      if (document === undefined) return notFound<DocumentMoved>('document');

      const moved = moveDocumentTo(
        document,
        command.status as Parameters<typeof moveDocumentTo>[1],
        dependencies.clock.now(),
        currentActor(),
      );

      if (!moved.ok) return refusedBy<DocumentMoved>(moved.error);

      await dependencies.stores.documents.update(transaction, moved.value, command.expectedVersion);
      await recordAccessFor(dependencies, transaction, {
        documentId: document.documentId,
        action: command.status === 'archived' ? 'archived' : 'restored',
      });
      return success({ documentId: document.documentId, status: moved.value.status });
    }),
});
