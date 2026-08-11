import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordVerification } from '../domain/verification.js';
import {
  CONNECTION,
  TENANT_A,
  openDocumentsFixture,
  requireDatabaseInCi,
  type DocumentsFixture,
} from './documents-database.fixture.js';
import { aDocument, aDocumentType, aVersion } from './documents-fixtures.js';

/**
 * Two administrators, at the same moment.
 *
 * Every assertion here starts **two real transactions on two real connections** and lets them race.
 * A suite that awaited one and then the other would prove only that sequential writes work, which
 * nobody doubted; the interesting behaviour is what the database does when both are in flight, and
 * that cannot be simulated in memory.
 *
 * Three races matter in this module. Two people replacing the same file must produce one version 2
 * and one refusal, never two rows both calling themselves version 2. Two verifiers deciding on the
 * same version must produce one decision and one refusal. And two people editing the same document
 * must produce one write and one `ConcurrencyException`, because the loser's change was made against
 * a document that no longer exists in that shape.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Documents concurrency suite');

suite('documents concurrency', () => {
  let fixture: DocumentsFixture;
  let ownerId: string;

  beforeAll(async () => {
    fixture = await openDocumentsFixture('documents_concurrency_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    ownerId = await fixture.seedPerson(TENANT_A);
  });

  it('lets one of two simultaneous version-2 writes win, and refuses the other', async () => {
    const { document } = await seeded(fixture, ownerId);

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.versions.insert(
          transaction,
          aVersion(document.documentId, 2, 'a'.repeat(64)),
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.versions.insert(
          transaction,
          aVersion(document.documentId, 2, 'b'.repeat(64)),
        ),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);

    // And the register holds one version 2, not two.
    const versions = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.forDocument(transaction, document.documentId),
    );

    expect(versions.filter((one) => one.versionNumber === 2)).toHaveLength(1);
  });

  it('lets one of two simultaneous verifications win, and refuses the other', async () => {
    const { document, version } = await seeded(fixture, ownerId);
    const decide = (decidedBy: string): Promise<void> => {
      const decision = recordVerification({
        verificationId: uuidV7(),
        documentId: document.documentId,
        documentVersionId: version.documentVersionId,
        decision: 'verified',
        decidedBy,
        decidedAt: new Date('2026-08-11T10:00:00Z'),
      });

      if (!decision.ok) throw new Error('the fixture built an invalid decision');
      return fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.verifications.insert(transaction, decision.value),
      );
    };

    const outcomes = await Promise.allSettled([
      decide('user:verifier-one'),
      decide('user:verifier-two'),
    ]);

    // The unique index on the version, doing the work no application check could do reliably.
    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);

    const decisions = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.verifications.forDocument(transaction, document.documentId),
    );

    expect(decisions).toHaveLength(1);
  });

  it('refuses the second of two edits made against the same document version', async () => {
    const { document } = await seeded(fixture, ownerId);

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.documents.update(
          transaction,
          { ...document, status: 'active' },
          document.version,
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.documents.update(
          transaction,
          { ...document, status: 'archived', archivedAt: new Date() },
          document.version,
        ),
      ),
    ]);

    // Both read version 1; only one may write. The loser's change was made against a document that
    // no longer exists in that shape, and silently applying it is how one administrator's archive
    // erases another's activation.
    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);
  });

  it('lets two simultaneous type definitions with the same code produce one row', async () => {
    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.types.insert(transaction, aDocumentType({ code: 'passport' })),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.types.insert(transaction, aDocumentType({ code: 'passport' })),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);

    const types = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.types.all(transaction),
    );

    expect(types).toHaveLength(1);
  });

  it('lets two simultaneous supersessions produce one stamp', async () => {
    const { version } = await seeded(fixture, ownerId);

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.versions.supersede(
          transaction,
          version.documentVersionId,
          new Date('2026-08-11T11:00:00Z'),
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.versions.supersede(
          transaction,
          version.documentVersionId,
          new Date('2026-08-11T12:00:00Z'),
        ),
      ),
    ]);

    // One stamps and one finds nothing to stamp. Neither produces a second `superseded_at`, and
    // the trigger would refuse one anyway.
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(0);

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.byId(transaction, version.documentVersionId),
    );

    expect(read?.supersededAt?.toISOString()).toBe('2026-08-11T11:00:00.000Z');
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
