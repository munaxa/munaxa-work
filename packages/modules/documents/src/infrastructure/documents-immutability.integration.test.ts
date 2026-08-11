import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordAccess } from '../domain/access-event.js';
import {
  CONNECTION,
  TENANT_A,
  openDocumentsFixture,
  requireDatabaseInCi,
  type DocumentsFixture,
} from './documents-database.fixture.js';
import { aDocument, aDocumentType, aVersion } from './documents-fixtures.js';

/**
 * What cannot be rewritten, checked at every layer that could rewrite it.
 *
 * A document somebody disputes is explained by two kinds of row: the versions, which say what the
 * file was, and the access trail, which says who reached it. Both are evidence, and evidence that
 * can be edited is not evidence.
 *
 * Four layers are asserted here, deliberately in order of how far they are from the developer:
 *
 * 1. **The port offers no method.** `VersionStore` and `AccessEventStore` have no `update` and no
 *    `remove`, so the mistake is not expressible in TypeScript.
 * 2. **The repository implements none.** Neither extends `Repository`, so neither inherits
 *    `updateRow` or `softDeleteRow`.
 * 3. **The trigger refuses raw SQL.** This is the layer that matters, because it holds for a
 *    migration, a psql session and a future handler nobody has written yet (ADR-0066).
 * 4. **The one permitted stamp still works.** `superseded_at` is the single column the version
 *    trigger allows, and a rule that refused it too would make replacing a file impossible.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Documents immutability suite');

suite('documents immutability', () => {
  let fixture: DocumentsFixture;
  let ownerId: string;

  beforeAll(async () => {
    fixture = await openDocumentsFixture('documents_immutability_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    ownerId = await fixture.seedPerson(TENANT_A);
  });

  it('offers no way to rewrite a version or an access event, in the port itself', async () => {
    const stores = fixture.stores;

    // Layer 1 and 2, asserted as a shape rather than as a comment: a method that does not exist
    // cannot be called by a handler somebody writes next year.
    expect(Object.keys(stores.versions)).not.toContain('update');
    expect(Object.keys(stores.versions)).not.toContain('remove');
    expect(Object.keys(stores.access)).not.toContain('update');
    expect(Object.keys(stores.access)).not.toContain('remove');
    expect(await Promise.resolve(true)).toBe(true);
  });

  it('refuses an update of a version’s content from raw SQL', async () => {
    const { version } = await seeded(fixture, ownerId);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document_version set content_hash = $1 where id = $2`, [
          'f'.repeat(64),
          version.documentVersionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('refuses a delete of a version from raw SQL', async () => {
    const { version } = await seeded(fixture, ownerId);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from document_version where id = $1`, [
          version.documentVersionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('refuses a soft delete of a version, which is an update', async () => {
    const { version } = await seeded(fixture, ownerId);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document_version set deleted_at = now() where id = $1`, [
          version.documentVersionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('permits the one stamp the trigger allows, and nothing beside it', async () => {
    const { version } = await seeded(fixture, ownerId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.supersede(
        transaction,
        version.documentVersionId,
        new Date('2026-08-11T11:00:00Z'),
      ),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.byId(transaction, version.documentVersionId),
    );

    expect(read?.supersededAt).toBeInstanceOf(Date);
    // The content is untouched: the stamp says the version is no longer current, not that it
    // changed.
    expect(read?.contentHash).toBe(version.contentHash);
  });

  it('refuses a stamp that smuggles a content change alongside it', async () => {
    const { version } = await seeded(fixture, ownerId);

    // The door the stamp opens is exactly one column wide. Everything else must be byte-for-byte
    // identical, so "supersede it and quietly rewrite the hash" is not reachable through it.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `update document_version set superseded_at = now(), content_hash = $1 where id = $2`,
          ['f'.repeat(64), version.documentVersionId],
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses a second supersession, and refuses clearing the first', async () => {
    const { version } = await seeded(fixture, ownerId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.supersede(
        transaction,
        version.documentVersionId,
        new Date('2026-08-11T11:00:00Z'),
      ),
    );

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document_version set superseded_at = now() where id = $1`, [
          version.documentVersionId,
        ]),
      ),
    ).rejects.toThrow();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document_version set superseded_at = null where id = $1`, [
          version.documentVersionId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('refuses every change to an access event, including its own audit columns', async () => {
    const { document } = await seeded(fixture, ownerId);
    const access = recordAccess({
      accessEventId: uuidV7(),
      documentId: document.documentId,
      action: 'metadata_read',
      actor: 'user:reader',
      occurredAt: new Date('2026-08-11T10:00:00Z'),
      outcome: 'permitted',
    });

    if (!access.ok) throw new Error('the fixture built an invalid access event');

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.access.insert(transaction, access.value),
    );

    // "Who has looked at this employee's file" is the question the trail exists to answer, and an
    // actor somebody could edit afterwards is no answer at all.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document_access_event set actor = $1 where id = $2`, [
          'user:somebody-else',
          access.value.accessEventId,
        ]),
      ),
    ).rejects.toThrow();

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`delete from document_access_event where id = $1`, [
          access.value.accessEventId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('leaves the document itself editable, because it is a record rather than evidence', async () => {
    const { document } = await seeded(fixture, ownerId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.update(
        transaction,
        { ...document, status: 'active' },
        document.version,
      ),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.byId(transaction, document.documentId),
    );

    expect(read?.status).toBe('active');
    expect(read?.version).toBe(document.version + 1);
  });
});

const seeded = async (
  fixture: DocumentsFixture,
  ownerId: string,
): Promise<{
  readonly document: ReturnType<typeof aDocument>;
  readonly version: ReturnType<typeof aVersion>;
}> => {
  const type = aDocumentType();
  const document = aDocument(type, ownerId);
  const version = aVersion(document.documentId);

  await fixture.asTenant(TENANT_A, async (transaction) => {
    await fixture.stores.types.insert(transaction, type);
    await fixture.stores.documents.insert(transaction, document);
    await fixture.stores.versions.insert(transaction, version);
  });

  return { document, version };
};
