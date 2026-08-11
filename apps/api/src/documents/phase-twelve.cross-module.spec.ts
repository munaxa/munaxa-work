import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  EMPLOYMENT_ID,
  IDENTIFIER_ID,
  PERSON_ID,
  VERIFIER,
  ask,
  attempt,
  harnessFor,
  send,
  type Harness,
} from './phase-twelve-harness.js';

/**
 * Documents and Letters against the rest of the product, through the **real adapters**.
 *
 * Every cross-module call here goes through `DocumentsOwnerDirectory`,
 * `DocumentsPersonIdentifiers` or one of the four letter sources — the production classes — and
 * through a real bounded service grant onto a real dispatcher. What is faked is only the *other
 * side*: People, Employment, Organization and Compensation answer as query handlers declaring the
 * permissions their real handlers declare, so an adapter naming the wrong permission is refused
 * here exactly as it would be in production.
 *
 * Letters' half of the same wiring is in `phase-twelve-letters.cross-module.spec.ts`.
 */

interface Identified {
  readonly documentTypeId: string;
}

const documentType = async (harness: Harness, code = 'passport'): Promise<string> => {
  const defined = await harness.as(ADMINISTRATOR, () =>
    send<Identified>(harness, {
      commandName: 'documents.define-type',
      code,
      name: { en: 'Passport', ar: 'جواز سفر' },
      ownerTypes: ['person'],
      expires: true,
      requiresVerification: true,
      confidentiality: 'normal',
      employeeVisible: true,
      managerVisible: true,
      noticeDays: [90, 30],
    }),
  );

  return defined.documentTypeId;
};

describe('documents against People and Employment', () => {
  it('confirms an owner through the published contract before the row exists', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    const created = await harness.as(ADMINISTRATOR, () =>
      send<{ documentId: string }>(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(created.documentId).toBeDefined();
  });

  it('refuses an owner People does not know', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: '01900000-0000-7000-8000-00000000ffff',
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(refused.ok).toBe(false);
  });

  it('confirms an employment owner through Employment', async () => {
    const harness = harnessFor();
    const defined = await harness.as(ADMINISTRATOR, () =>
      send<Identified>(harness, {
        commandName: 'documents.define-type',
        code: 'contract',
        name: { en: 'Contract', ar: 'عقد' },
        ownerTypes: ['employment'],
        expires: false,
        requiresVerification: false,
        confidentiality: 'normal',
        employeeVisible: true,
        managerVisible: true,
      }),
    );

    const created = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId: defined.documentTypeId,
        ownerType: 'employment',
        ownerId: EMPLOYMENT_ID,
        title: { en: 'Signed contract', ar: 'عقد موقّع' },
      }),
    );

    expect(created.ok).toBe(true);
  });

  it('reads the expiry from People and follows it when People changes it', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);
    const created = await harness.as(ADMINISTRATOR, () =>
      send<{ documentId: string }>(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        personIdentifierId: IDENTIFIER_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );
    const expiryOf = async (): Promise<string | undefined> => {
      const detail = await harness.as(VERIFIER, () =>
        ask<{ document: { expiryDate?: { gregorian: string }; expiryOwnedByPeople: boolean } }>(
          harness,
          { queryName: 'documents.read-document', documentId: created.documentId },
        ),
      );

      expect(detail.document.expiryOwnedByPeople).toBe(true);
      return detail.document.expiryDate?.gregorian;
    };

    expect(await expiryOf()).toBe('2029-05-04');

    // The passport is renewed. Documents stored no copy, so the view moves with People — which is
    // the whole of D-1a, visible from the outside.
    harness.facts.identifierExpiresOn = '2034-05-04';

    expect(await expiryOf()).toBe('2034-05-04');
  });

  it('refuses an identifier reference People cannot confirm', async () => {
    const harness = harnessFor();
    const documentTypeId = await documentType(harness);

    harness.facts.identifierPresent = false;

    const refused = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'documents.create-document',
        documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        personIdentifierId: IDENTIFIER_ID,
        title: { en: 'Passport scan', ar: 'صورة جواز' },
      }),
    );

    expect(refused.ok).toBe(false);
  });
});
