import { uuidV7 } from '@work/kernel';

import { ADMINISTRATOR, send, type Harness } from './documents-test-harness.js';
import type { DocumentCreated, VersionAdded } from './document.use-case.js';
import type { DocumentTypeDefined } from './document-type.use-case.js';

/**
 * The setup every suite repeats, in one place.
 *
 * Written as sends through the dispatcher rather than as direct writes to the stores, so a scenario
 * cannot construct a state the handlers would refuse — which is the only way a fixture stays honest
 * as the rules change.
 */

export const CONTENT_HASH = 'a'.repeat(64);
export const OTHER_HASH = 'b'.repeat(64);

export interface TypeOptions {
  readonly code?: string;
  readonly expires?: boolean;
  readonly requiresVerification?: boolean;
  readonly confidentiality?: string;
  readonly noticeDays?: readonly number[];
  readonly ownerTypes?: readonly string[];
}

export const defineType = async (harness: Harness, options: TypeOptions = {}): Promise<string> => {
  const defined = await harness.as(ADMINISTRATOR, () =>
    send<DocumentTypeDefined>(harness, {
      commandName: 'documents.define-type',
      code: options.code ?? 'passport',
      name: { en: 'Passport', ar: 'جواز سفر' },
      ownerTypes: options.ownerTypes ?? ['person'],
      expires: options.expires ?? true,
      requiresVerification: options.requiresVerification ?? true,
      confidentiality: options.confidentiality ?? 'normal',
      employeeVisible: true,
      managerVisible: options.confidentiality !== 'confidential',
      noticeDays: options.noticeDays ?? [90, 30],
    }),
  );

  return defined.documentTypeId;
};

export interface DocumentOptions {
  readonly documentTypeId: string;
  readonly ownerType?: string;
  readonly ownerId?: string;
  readonly personIdentifierId?: string;
  readonly expiryDate?: string;
  readonly issueDate?: string;
}

/** A person the owner directory knows about, and a document filed against them. */
export const createDocumentFor = async (
  harness: Harness,
  options: DocumentOptions,
): Promise<{ readonly documentId: string; readonly ownerId: string }> => {
  const ownerType = options.ownerType ?? 'person';
  const ownerId = options.ownerId ?? uuidV7();

  harness.owners.add(ownerType, ownerId);

  const created = await harness.as(ADMINISTRATOR, () =>
    send<DocumentCreated>(harness, {
      commandName: 'documents.create-document',
      documentTypeId: options.documentTypeId,
      ownerType,
      ownerId,
      title: { en: 'Passport scan', ar: 'صورة جواز السفر' },
      ...(options.personIdentifierId === undefined
        ? {}
        : { personIdentifierId: options.personIdentifierId }),
      ...(options.issueDate === undefined ? {} : { issueDate: options.issueDate }),
      ...(options.expiryDate === undefined ? {} : { expiryDate: options.expiryDate }),
    }),
  );

  return { documentId: created.documentId, ownerId };
};

export const addVersion = (
  harness: Harness,
  documentId: string,
  contentHash: string = CONTENT_HASH,
): Promise<VersionAdded> =>
  harness.as(ADMINISTRATOR, () =>
    send<VersionAdded>(harness, {
      commandName: 'documents.add-version',
      documentId,
      storageReference: `documents/${documentId}/${contentHash.slice(0, 8)}`,
      originalFileName: 'passport.pdf',
      declaredMediaType: 'application/pdf',
      sizeInBytes: '2048',
      contentHash,
    }),
  );

/** A type, a document and one version — the state most assertions start from. */
export const filedDocument = async (
  harness: Harness,
  options: TypeOptions = {},
): Promise<{
  readonly documentTypeId: string;
  readonly documentId: string;
  readonly ownerId: string;
  readonly documentVersionId: string;
}> => {
  const documentTypeId = await defineType(harness, options);
  const { documentId, ownerId } = await createDocumentFor(harness, {
    documentTypeId,
    expiryDate: '2027-01-01',
  });
  const version = await addVersion(harness, documentId);

  return {
    documentTypeId,
    documentId,
    ownerId,
    documentVersionId: version.documentVersionId,
  };
};
