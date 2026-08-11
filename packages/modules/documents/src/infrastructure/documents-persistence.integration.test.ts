import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordAccess } from '../domain/access-event.js';
import { recordVerification } from '../domain/verification.js';
import { versionAdded } from '../domain/document.js';
import {
  CONNECTION,
  TENANT_A,
  openDocumentsFixture,
  requireDatabaseInCi,
  type DocumentsFixture,
} from './documents-database.fixture.js';
import { CONTENT_HASH, aDocument, aDocumentType, aVersion } from './documents-fixtures.js';

/**
 * What the repositories do against real SQL.
 *
 * The in-memory suites already prove the behaviour; these prove it survives a driver round trip, a
 * real column list and real constraints. The things that can only fail here are the interesting
 * ones: a `bigint` above 2^53, a civil date read on a server west of UTC, and a check constraint
 * that refuses a state the domain would also refuse.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Documents persistence suite');

suite('documents persistence', () => {
  let fixture: DocumentsFixture;
  let ownerId: string;

  beforeAll(async () => {
    fixture = await openDocumentsFixture('documents_persistence_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    ownerId = await fixture.seedPerson(TENANT_A);
  });

  it('round-trips a document type, its array columns included', async () => {
    const type = aDocumentType();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.types.insert(transaction, type),
    );

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.types.byId(transaction, type.documentTypeId),
    );

    expect(read?.ownerTypes).toEqual(['person']);
    expect(read?.noticeDays).toEqual([90, 30]);
    expect(read?.name).toEqual({ en: 'Passport', ar: 'جواز سفر' });
  });

  it('round-trips a file size above what a double represents exactly', async () => {
    const { document, version } = await seeded(fixture, ownerId);

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.byId(transaction, version.documentVersionId),
    );

    expect(read?.sizeInBytes).toBe(9_007_199_254_740_993n);
    expect(read?.documentId).toBe(document.documentId);
  });

  it('reads a civil date as the day that was stored', async () => {
    const type = aDocumentType();
    const document = aDocument(type, ownerId, { expiryDate: '2027-01-01' });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.types.insert(transaction, type);
      await fixture.stores.documents.insert(transaction, document);
    });

    const read = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.byId(transaction, document.documentId),
    );

    // Not the previous day: `to_char` rather than a `date` column the driver would localize.
    expect(read?.expiryDate).toBe('2027-01-01');
  });

  it('allocates version numbers from the highest already written', async () => {
    const { document, version } = await seeded(fixture, ownerId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.insert(transaction, aVersion(document.documentId, 2, 'd'.repeat(64))),
    );

    const highest = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.highestVersionNumber(transaction, document.documentId),
    );

    expect(highest).toBe(2);
    expect(version.versionNumber).toBe(1);
  });

  it('refuses a second version with the same number', async () => {
    const { document } = await seeded(fixture, ownerId);

    // The unique index, not a check in TypeScript: this is what settles two administrators
    // replacing the same file at the same moment.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.versions.insert(
          transaction,
          aVersion(document.documentId, 1, 'e'.repeat(64)),
        ),
      ),
    ).rejects.toThrow();
  });

  it('finds duplicate content across the tenant, and permits it', async () => {
    const { document } = await seeded(fixture, ownerId);
    const other = aDocumentType({ code: 'contract' });
    const second = aDocument(other, ownerId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.types.insert(transaction, other);
      await fixture.stores.documents.insert(transaction, second);
      // The same bytes under a different document: two employees legitimately hold the same blank
      // form, so this is permitted and surfaced rather than refused (D-5).
      await fixture.stores.versions.insert(transaction, aVersion(second.documentId));
    });

    const found = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.byContentHash(transaction, CONTENT_HASH, 20),
    );

    expect(found.map((one) => one.documentId).sort()).toEqual(
      [document.documentId, second.documentId].sort(),
    );
  });

  it('refuses a document that both points at a People identifier and carries its own expiry', async () => {
    const type = aDocumentType();

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.types.insert(transaction, type),
    );

    // The half of D-1a a check constraint can express. The domain refuses it too; this proves the
    // database would refuse it even from SQL nobody wrote in TypeScript.
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into document
             (id, tenant_id, document_type_id, owner_type, owner_id, person_identifier_id,
              title, status, confidentiality, expiry_date, verification_state, version_count,
              source, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, 'person', $4, $5, '{}'::jsonb, 'draft', 'normal', '2027-01-01'::date,
                   'unverified', 0, 'direct', now(), 'test', now(), 'test', 1)`,
          [uuidV7(), TENANT_A, type.documentTypeId, ownerId, uuidV7()],
        ),
      ),
    ).rejects.toThrow();
  });

  it('records a verification decision and the access that produced it', async () => {
    const { document, version } = await seeded(fixture, ownerId);
    const decision = recordVerification({
      verificationId: uuidV7(),
      documentId: document.documentId,
      documentVersionId: version.documentVersionId,
      decision: 'verified',
      decidedBy: 'user:verifier',
      decidedAt: new Date('2026-08-11T10:00:00Z'),
    });

    if (!decision.ok) throw new Error('the fixture built an invalid decision');

    const access = recordAccess({
      accessEventId: uuidV7(),
      documentId: document.documentId,
      documentVersionId: version.documentVersionId,
      action: 'verified',
      actor: 'user:verifier',
      occurredAt: new Date('2026-08-11T10:00:00Z'),
      correlationId: uuidV7(),
      outcome: 'permitted',
    });

    if (!access.ok) throw new Error('the fixture built an invalid access event');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.verifications.insert(transaction, decision.value);
      await fixture.stores.documents.update(
        transaction,
        versionAdded(document, version.documentVersionId, true),
        document.version,
      );
      await fixture.stores.access.insert(transaction, access.value);
    });

    const trail = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.access.forDocument(transaction, document.documentId, {
        limit: 50,
        offset: 0,
      }),
    );

    expect(trail.total).toBe(1);
    expect(trail.items[0]?.actor).toBe('user:verifier');
    expect(trail.items[0]?.correlationId).toBeDefined();
  });

  it('excludes confidential documents from a search that may not see them', async () => {
    const ordinary = aDocumentType({ code: 'passport' });
    const secret = aDocumentType({
      code: 'medical-certificate',
      confidentiality: 'confidential',
      requiresVerification: false,
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.types.insert(transaction, ordinary);
      await fixture.stores.types.insert(transaction, secret);
      await fixture.stores.documents.insert(transaction, aDocument(ordinary, ownerId));
      await fixture.stores.documents.insert(transaction, aDocument(secret, ownerId));
    });

    const withheld = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.search(
        transaction,
        { includeConfidential: false },
        { limit: 50, offset: 0 },
      ),
    );

    // The predicate is in the SQL, so the row never leaves the database — and the total agrees
    // with the rows rather than counting what was withheld.
    expect(withheld.items).toHaveLength(1);
    expect(withheld.total).toBe(1);

    const all = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.search(
        transaction,
        { includeConfidential: true },
        { limit: 50, offset: 0 },
      ),
    );

    expect(all.total).toBe(2);
  });

  it('finds the expiry queue by an indexed comparison', async () => {
    const type = aDocumentType();

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.types.insert(transaction, type);
      await fixture.stores.documents.insert(
        transaction,
        aDocument(type, ownerId, { expiryDate: '2026-09-01' }),
      );
      await fixture.stores.documents.insert(
        transaction,
        aDocument(type, ownerId, { expiryDate: '2030-09-01' }),
      );
    });

    const soon = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.documents.search(
        transaction,
        { includeConfidential: true, expiringOnOrBefore: '2026-12-31' },
        { limit: 50, offset: 0 },
      ),
    );

    expect(soon.total).toBe(1);
    expect(soon.items[0]?.expiryDate).toBe('2026-09-01');
  });
});

/** A type, a document and one version, all inserted. */
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
