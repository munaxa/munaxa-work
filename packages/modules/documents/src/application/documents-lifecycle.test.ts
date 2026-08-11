import { describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  ADMINISTRATOR,
  VERIFIER,
  ask,
  attempt,
  harnessFor,
  send,
} from './documents-test-harness.js';
import {
  CONTENT_HASH,
  OTHER_HASH,
  addVersion,
  createDocumentFor,
  defineType,
  filedDocument,
} from './documents-scenarios.js';
import type { DocumentDetail } from './documents-queries.js';
import type { DocumentTypeView } from '../contracts/views.js';

/**
 * The document lifecycle, through the real dispatcher.
 *
 * These suites exercise **behaviour**, not persistence: the stores are in memory and enforce the
 * same two unique indexes production does. The integration suites then prove the same behaviour
 * survives real SQL, real constraints and real row-level security.
 */

describe('document types', () => {
  it('refuses a second type with the same code', async () => {
    const harness = harnessFor();

    await defineType(harness, { code: 'passport' });

    const again = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.define-type',
        code: 'passport',
        name: { en: 'Passport', ar: 'جواز' },
        ownerTypes: ['person'],
        expires: true,
        requiresVerification: true,
        confidentiality: 'normal',
        employeeVisible: true,
        managerVisible: true,
      }),
    );

    expect(again.ok).toBe(false);
  });

  it('re-checks every invariant when a type is amended', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness, { expires: true, noticeDays: [30] });

    // A type that expires must keep at least one notice threshold. Amending the thresholds away
    // is refused by the aggregate's own constructor, not by a special-case check.
    const emptied = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.amend-type',
        documentTypeId,
        expectedVersion: 1,
        noticeDays: [],
      }),
    );

    expect(emptied.ok).toBe(false);
  });

  it('carries the code and owner types through an amendment unchanged', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness, { code: 'work-permit' });

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.amend-type',
        documentTypeId,
        expectedVersion: 1,
        name: { en: 'Work permit', ar: 'تصريح عمل' },
      }),
    );

    const listed = await harness.as(ADMINISTRATOR, () =>
      ask<{ readonly items: readonly DocumentTypeView[] }>(harness, {
        queryName: 'documents.types',
      }),
    );

    expect(listed.items[0]?.code).toBe('work-permit');
    expect(listed.items[0]?.name.en).toBe('Work permit');
    expect(listed.items[0]?.ownerTypes).toEqual(['person']);
  });
});

describe('creating a document', () => {
  it('refuses an owner the owning module does not know', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: uuidV7(),
        title: { en: 'Scan', ar: 'صورة' },
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses `dependent` as an owner type', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness);

    // Reserved and unmodelled: nothing in this repository is a dependent, and accepting the word
    // would invite a second person registry inside Documents (D-1).
    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'dependent',
        ownerId: uuidV7(),
        title: { en: 'Scan', ar: 'صورة' },
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('refuses an identifier reference People cannot confirm', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness);
    const ownerId = uuidV7();

    harness.owners.add('person', ownerId);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId,
        personIdentifierId: uuidV7(),
        title: { en: 'Scan', ar: 'صورة' },
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('reports People as the owner of the expiry, and People as the source of the date', async () => {
    const harness = harnessFor();
    const documentTypeId = await defineType(harness);
    const ownerId = uuidV7();
    const personIdentifierId = uuidV7();

    harness.identifiers.set(ownerId, {
      personIdentifierId,
      identifierType: 'passport',
      expiresOn: '2029-05-04',
    });

    const { documentId } = await createDocumentFor(harness, {
      documentTypeId,
      ownerId,
      personIdentifierId,
    });
    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<DocumentDetail>(harness, { queryName: 'documents.read-document', documentId }),
    );

    // The D-1a boundary: Documents stored no expiry of its own, and the view reports People's.
    expect(detail.document.expiryOwnedByPeople).toBe(true);
    expect(detail.document.expiryDate?.gregorian).toBe('2029-05-04');
  });
});

describe('versions', () => {
  it('numbers versions from the highest already written and never overwrites one', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);
    const second = await addVersion(harness, documentId, OTHER_HASH);

    expect(second.versionNumber).toBe(2);
    expect(second.documentVersionId).not.toBe(documentVersionId);

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<DocumentDetail>(harness, { queryName: 'documents.read-document', documentId }),
    );

    expect(detail.versions).toHaveLength(2);
    expect(detail.versions[0]?.supersededAt).toBeInstanceOf(Date);
    expect(detail.versions[1]?.supersededAt).toBeUndefined();
  });

  it('surfaces duplicate content rather than refusing it', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);
    const same = await addVersion(harness, documentId, CONTENT_HASH);

    // Two employees legitimately hold the same blank form. The duplicate is reported, not blocked.
    expect(same.duplicateOfVersionIds).toHaveLength(1);
  });

  it('returns a verified document to pending when the file is replaced', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      send(harness, {
        commandName: 'documents.verify',
        documentId,
        documentVersionId,
        decision: 'verified',
      }),
    );
    await addVersion(harness, documentId, OTHER_HASH);

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<DocumentDetail>(harness, { queryName: 'documents.read-document', documentId }),
    );

    // Nobody has looked at the new bytes, so the earlier verdict does not carry over.
    expect(detail.document.verificationState).toBe('pending_verification');
  });

  it('refuses a version on a document under legal hold', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.legal-hold',
        documentId,
        expectedVersion: 2,
        hold: true,
        reason: 'Litigation hold 2026-114',
      }),
    );

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.add-version',
        documentId,
        storageReference: `documents/${documentId}/late`,
        originalFileName: 'late.pdf',
        declaredMediaType: 'application/pdf',
        sizeInBytes: '10',
        contentHash: OTHER_HASH,
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('verification', () => {
  it('records the authenticated actor, never one the command supplied', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);

    await harness.as(VERIFIER, () =>
      send(harness, {
        commandName: 'documents.verify',
        documentId,
        documentVersionId,
        decision: 'verified',
        decidedBy: 'user:somebody-else',
      }),
    );

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<DocumentDetail>(harness, { queryName: 'documents.read-document', documentId }),
    );

    expect(detail.verifications[0]?.decidedBy).toBe(VERIFIER);
  });

  it('refuses a second decision on a version already decided', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);
    const decide = (decision: string): Promise<Awaited<ReturnType<typeof attempt>>> =>
      harness.as(VERIFIER, () =>
        attempt(harness, {
          commandName: 'documents.verify',
          documentId,
          documentVersionId,
          decision,
        }),
      );

    expect((await decide('verified')).ok).toBe(true);
    // Refused by the document's own transition table before the unique index is reached. Both
    // rules exist: the index is what settles two verifiers racing, and it is asserted against real
    // SQL in the integration suite.
    expect((await decide('rejected')).ok).toBe(false);
  });

  it('refuses a decision on a superseded version', async () => {
    const harness = harnessFor();
    const { documentId, documentVersionId } = await filedDocument(harness);

    await addVersion(harness, documentId, OTHER_HASH);

    const refused = await harness.as(VERIFIER, () =>
      attempt(harness, {
        commandName: 'documents.verify',
        documentId,
        documentVersionId,
        decision: 'verified',
      }),
    );

    expect(refused.ok).toBe(false);
  });
});

describe('archiving', () => {
  it('archives and restores, and refuses archiving under legal hold', async () => {
    const harness = harnessFor();
    const { documentId } = await filedDocument(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.legal-hold',
        documentId,
        expectedVersion: 2,
        hold: true,
        reason: 'Litigation hold 2026-114',
      }),
    );

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.move-document',
        documentId,
        status: 'archived',
        expectedVersion: 3,
      }),
    );

    expect(refused.ok).toBe(false);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.legal-hold',
        documentId,
        expectedVersion: 3,
        hold: false,
      }),
    );
    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'documents.move-document',
        documentId,
        status: 'archived',
        expectedVersion: 4,
      }),
    );

    const detail = await harness.as(ADMINISTRATOR, () =>
      ask<DocumentDetail>(harness, { queryName: 'documents.read-document', documentId }),
    );

    expect(detail.document.status).toBe('archived');
    expect(detail.document.archivedAt).toBeInstanceOf(Date);
  });
});

describe('a version belonging to another document', () => {
  it('cannot be decided through the document that does not own it', async () => {
    const harness = harnessFor();
    const first = await filedDocument(harness, { code: 'passport' });
    const second = await filedDocument(harness, { code: 'contract' });

    const refused = await harness.as(VERIFIER, () =>
      attempt(harness, {
        commandName: 'documents.verify',
        documentId: first.documentId,
        documentVersionId: second.documentVersionId,
        decision: 'verified',
      }),
    );

    expect(refused.ok).toBe(false);
  });
});
