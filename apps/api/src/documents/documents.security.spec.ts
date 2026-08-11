import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import {
  ALL,
  ADMINISTRATOR,
  VERIFIER,
  applicationWith,
  http,
  permitting,
  type DocumentItem,
  type DownloadBody,
  type PageBody,
} from './documents-api-harness.js';
import { PERSON_ID } from './phase-twelve-upstream.js';

/**
 * What each permission reaches, and — more importantly — what it does not.
 *
 * Three separations this module is built around, asserted at the HTTP edge because that is where a
 * customer meets them:
 *
 * **Seeing that a document exists is not seeing a confidential one.** `document.read` does not
 * reach a confidential document, and the refusal is **404 rather than 403**: "forbidden" on a
 * document identifier confirms that a document of that kind exists for that employee, and in this
 * module that confirmation is the disclosure.
 *
 * **Reading metadata is not downloading.** `document.download` is separate, and a caller who may
 * read the register may have no business obtaining the bytes.
 *
 * **Reading the trail is its own permission.** "Who has looked at this employee's file" is itself a
 * sensitive read.
 */

const type = {
  code: 'medical-certificate',
  name: { en: 'Medical certificate', ar: 'تقرير طبي' },
  ownerTypes: ['person'],
  expires: false,
  requiresVerification: false,
  confidentiality: 'confidential',
  employeeVisible: true,
  managerVisible: false,
};

const ordinary = {
  ...type,
  code: 'passport',
  confidentiality: 'normal',
  managerVisible: true,
  expires: true,
  noticeDays: [90],
};

interface Created {
  readonly documentId: string;
}

interface TypeCreated {
  readonly documentTypeId: string;
}

describe('documents API security', () => {
  let application: INestApplication;

  afterEach(async () => {
    await application.close();
  });

  const fileA = async (body: Record<string, unknown>, expiryDate?: string): Promise<string> => {
    const defined = await http(application).post('/api/v1/documents/types').send(body).expect(201);
    const created = await http(application)
      .post('/api/v1/documents')
      .send({
        documentTypeId: (defined.body as TypeCreated).documentTypeId,
        ownerType: 'person',
        ownerId: PERSON_ID,
        title: { en: 'Scan', ar: 'صورة' },
        ...(expiryDate === undefined ? {} : { expiryDate }),
      })
      .expect(201);

    return (created.body as Created).documentId;
  };

  describe('with every permission', () => {
    beforeEach(async () => {
      application = await applicationWith(permitting(...ALL));
    });

    it('resolves the literal type route rather than treating `types` as an identifier', async () => {
      const listed = await http(application).get('/api/v1/documents/types').expect(200);

      // Route ordering, asserted rather than trusted to a comment.
      expect(listed.body).toEqual({ items: [] });
    });

    it('reports the download capability as unavailable rather than inventing a URL', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');

      await http(application)
        .post(`/api/v1/documents/${documentId}/versions`)
        .send({
          storageReference: 'documents/2026/08/8f1c2a',
          originalFileName: 'passport.pdf',
          declaredMediaType: 'application/pdf',
          sizeInBytes: '2048',
          contentHash: 'a'.repeat(64),
        })
        .expect(201);

      const authorized = await http(application)
        .post(`/api/v1/documents/${documentId}/download`)
        .send({})
        .expect(201);
      const body = authorized.body as DownloadBody;

      expect(body.available).toBe(false);
      expect(body.url).toBeUndefined();
    });

    it('refuses a storage reference that is a URL', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');

      // The reference expression three modules share permits `:` and `/`, so it also permits a
      // URL. Documents adds the refusal on its own side (D-25) and it lands here as a 400: nothing
      // may infer a storage provider from a reference, and a value carrying a scheme is one
      // somebody could try to resolve directly rather than through an authorized download.
      await http(application)
        .post(`/api/v1/documents/${documentId}/versions`)
        .send({
          storageReference: 'https://example.invalid/passport.pdf',
          originalFileName: 'passport.pdf',
          declaredMediaType: 'application/pdf',
          sizeInBytes: '2048',
          contentHash: 'a'.repeat(64),
        })
        .expect(400);
    });

    it('refuses a size that arrived as a JSON number', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');

      await http(application)
        .post(`/api/v1/documents/${documentId}/versions`)
        .send({
          storageReference: 'documents/2026/08/8f1c2a',
          originalFileName: 'passport.pdf',
          declaredMediaType: 'application/pdf',
          sizeInBytes: 2048,
          contentHash: 'a'.repeat(64),
        })
        .expect(400);
    });

    it('refuses a manager-visible confidential type, at the edge', async () => {
      await http(application)
        .post('/api/v1/documents/types')
        .send({ ...type, code: 'leaky', managerVisible: true })
        .expect(422);
    });
  });

  describe('with document.read but not document.read-sensitive', () => {
    beforeEach(async () => {
      application = await applicationWith(
        permitting('document.read', 'document.manage', 'document.type.manage'),
      );
    });

    it('does not receive a confidential document, and does not learn one was withheld', async () => {
      await fileA(type);

      const found = await http(application).get('/api/v1/documents').expect(200);
      const page = found.body as PageBody<DocumentItem>;

      expect(page.items).toHaveLength(0);
      // Not a short page: the count agrees with the rows, because a count is itself a disclosure.
      expect(page.total).toBe(0);
    });

    it('is told a confidential document does not exist, rather than that it is forbidden', async () => {
      const documentId = await fileA(type);
      const permitted = await applicationWith(permitting(...ALL));

      await permitted.close();
      await http(application).get(`/api/v1/documents/${documentId}`).expect(404);
    });

    it('still sees an ordinary document', async () => {
      await fileA(ordinary, '2027-01-01');

      const found = await http(application).get('/api/v1/documents').expect(200);

      expect((found.body as PageBody<DocumentItem>).total).toBe(1);
    });
  });

  describe('with document.read but not document.download', () => {
    beforeEach(async () => {
      application = await applicationWith(
        permitting('document.read', 'document.manage', 'document.type.manage'),
      );
    });

    it('is refused the download authorization', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');

      // Reading that a passport scan exists is not obtaining it.
      await http(application).post(`/api/v1/documents/${documentId}/download`).send({}).expect(403);
    });
  });

  describe('with document.read but not document.audit', () => {
    beforeEach(async () => {
      application = await applicationWith(
        permitting('document.read', 'document.manage', 'document.type.manage'),
      );
    });

    it('is refused the access trail', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');

      await http(application).get(`/api/v1/documents/${documentId}/audit`).expect(403);
    });
  });

  describe('with no authenticated context at all', () => {
    beforeEach(async () => {
      application = await applicationWith(permitting(...ALL), { actor: undefined });
    });

    it('reaches no route in this module', async () => {
      await http(application).get('/api/v1/documents').expect(401);
      await http(application).get('/api/v1/documents/types').expect(401);
      await http(application)
        .post('/api/v1/documents')
        .send({ documentTypeId: PERSON_ID, ownerType: 'person', ownerId: PERSON_ID })
        .expect(401);
    });
  });

  describe('the verifier', () => {
    beforeEach(async () => {
      application = await applicationWith(permitting(...ALL), { actor: VERIFIER });
    });

    it('is recorded as the decider, and the body may not name one', async () => {
      const documentId = await fileA(ordinary, '2027-01-01');
      const version = await http(application)
        .post(`/api/v1/documents/${documentId}/versions`)
        .send({
          storageReference: 'documents/2026/08/8f1c2a',
          originalFileName: 'passport.pdf',
          declaredMediaType: 'application/pdf',
          sizeInBytes: '2048',
          contentHash: 'a'.repeat(64),
        })
        .expect(201);

      const documentVersionId = (version.body as { documentVersionId: string }).documentVersionId;

      // `decidedBy` is not a field of the request, and the edge refuses the whole body for
      // carrying it. A caller who could supply it could sign off their own upload in somebody
      // else's name.
      await http(application)
        .post(`/api/v1/documents/${documentId}/verification`)
        .send({ documentVersionId, decision: 'verified', decidedBy: ADMINISTRATOR })
        .expect(400);

      await http(application)
        .post(`/api/v1/documents/${documentId}/verification`)
        .send({ documentVersionId, decision: 'verified' })
        .expect(201);

      const detail = await http(application).get(`/api/v1/documents/${documentId}`).expect(200);
      const verifications = (detail.body as { verifications: readonly { decidedBy: string }[] })
        .verifications;

      expect(verifications[0]?.decidedBy).toBe(VERIFIER);
    });
  });
});
