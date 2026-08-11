import { uuidV7 } from '@work/kernel';

import { createDocument } from '../domain/document.js';
import { createDocumentType } from '../domain/document-type.js';
import { createVersion } from '../domain/document-version.js';
import type { DocumentState } from '../domain/document.js';
import type { DocumentTypeState } from '../domain/document-type.js';
import type { DocumentVersionState } from '../domain/document-version.js';

/**
 * States built through the aggregates' own constructors, for the integration suites.
 *
 * Constructed rather than hand-written so a fixture cannot describe a document the domain would
 * refuse — which is the only way a fixture stays honest as the rules change. The suites here are
 * about what the *database* does with a valid state, so the state has to actually be one.
 */

export const CONTENT_HASH = 'c'.repeat(64);

/** The domain refuses nothing here; a throw would mean the fixture itself is wrong. */
const built = <TState>(result: { ok: boolean } & Record<string, unknown>): TState => {
  if (!result.ok) throw new Error(`documents fixture: ${JSON.stringify(result['error'])}`);
  return result['value'] as TState;
};

export const aDocumentType = (
  overrides: Partial<{
    code: string;
    expires: boolean;
    confidentiality: string;
    requiresVerification: boolean;
  }> = {},
): DocumentTypeState =>
  built<DocumentTypeState>(
    createDocumentType({
      documentTypeId: uuidV7(),
      code: overrides.code ?? 'passport',
      name: { en: 'Passport', ar: 'جواز سفر' },
      ownerTypes: ['person'],
      expires: overrides.expires ?? true,
      requiresVerification: overrides.requiresVerification ?? true,
      confidentiality: overrides.confidentiality ?? 'normal',
      employeeVisible: true,
      managerVisible: overrides.confidentiality !== 'confidential',
      noticeDays: [90, 30],
    }),
  );

export const aDocument = (
  type: DocumentTypeState,
  ownerId: string,
  overrides: Partial<{ expiryDate: string; personIdentifierId: string }> = {},
): DocumentState =>
  built<DocumentState>(
    createDocument({
      documentId: uuidV7(),
      type,
      ownerType: 'person',
      ownerId,
      title: { en: 'Passport scan', ar: 'صورة جواز السفر' },
      source: 'direct',
      ...(overrides.expiryDate === undefined ? {} : { expiryDate: overrides.expiryDate }),
      ...(overrides.personIdentifierId === undefined
        ? {}
        : { personIdentifierId: overrides.personIdentifierId }),
    }),
  );

export const aVersion = (
  documentId: string,
  versionNumber = 1,
  contentHash: string = CONTENT_HASH,
): DocumentVersionState =>
  built<DocumentVersionState>(
    createVersion({
      documentVersionId: uuidV7(),
      documentId,
      versionNumber,
      storageReference: `documents/${documentId}/v${String(versionNumber)}`,
      originalFileName: 'passport.pdf',
      declaredMediaType: 'application/pdf',
      // Deliberately above 2^53: a size that rounded through a double would make a later
      // byte-for-byte comparison meaningless.
      sizeInBytes: 9_007_199_254_740_993n,
      contentHash,
      source: 'direct',
    }),
  );
