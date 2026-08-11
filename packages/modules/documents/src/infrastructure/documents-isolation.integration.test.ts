import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { recordAccess } from '../domain/access-event.js';
import { recordVerification } from '../domain/verification.js';
import {
  CONNECTION,
  DOCUMENTS_TABLES,
  TENANT_A,
  TENANT_B,
  openDocumentsFixture,
  requireDatabaseInCi,
  type DocumentsFixture,
} from './documents-database.fixture.js';
import { aDocument, aDocumentType, aVersion } from './documents-fixtures.js';

/**
 * Row-level security, on all five of this module's tables.
 *
 * This module holds medical certificates, disciplinary evidence and passport scans, so "one tenant
 * cannot see another's" is not a general platform property here — it is the specific property that
 * makes the module safe to ship. The suite connects as a role that **owns nothing and holds no
 * `BYPASSRLS`**, because a superuser bypasses every policy and would pass whether or not isolation
 * worked.
 *
 * Both directions are checked, because a policy that filters reads and not writes lets one tenant
 * *insert into* another's register — quieter than reading it, and worse.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Documents isolation suite');

suite('documents row-level security', () => {
  let fixture: DocumentsFixture;

  beforeAll(async () => {
    fixture = await openDocumentsFixture('documents_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('protects every table this module owns', async () => {
    const protectedTables = await fixture.admin.query<{ tablename: string; count: string }>(
      `select t.tablename, count(p.policyname)::text as count
         from pg_tables t
         left join pg_policies p on p.tablename = t.tablename
        where t.tablename = any($1::text[]) and t.rowsecurity
        group by t.tablename`,
      [DOCUMENTS_TABLES],
    );

    expect(protectedTables.rows.map((row) => row.tablename).sort()).toEqual(
      [...DOCUMENTS_TABLES].sort(),
    );
    for (const row of protectedTables.rows) {
      expect(Number(row.count)).toBeGreaterThan(0);
    }
  });

  it('hides one tenant’s documents from another', async () => {
    const { type } = await seedFor(fixture, TENANT_A);

    const asB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.documents.search(
        transaction,
        { includeConfidential: true },
        { limit: 50, offset: 0 },
      ),
    );

    expect(asB.total).toBe(0);

    const typeAsB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.types.byId(transaction, type.documentTypeId),
    );

    expect(typeAsB).toBeUndefined();
  });

  it('hides one tenant’s versions, verifications and access trail from another', async () => {
    const { document, version } = await seedFor(fixture, TENANT_A);

    const [versions, verifications, trail] = await fixture.asTenant(
      TENANT_B,
      async (transaction) => [
        await fixture.stores.versions.forDocument(transaction, document.documentId),
        await fixture.stores.verifications.forDocument(transaction, document.documentId),
        await fixture.stores.access.forDocument(transaction, document.documentId, {
          limit: 50,
          offset: 0,
        }),
      ],
    );

    expect(versions).toHaveLength(0);
    expect(verifications).toHaveLength(0);
    expect(trail.total).toBe(0);
    // And the version is genuinely there for the tenant that owns it.
    const owned = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.versions.byId(transaction, version.documentVersionId),
    );

    expect(owned).toBeDefined();
  });

  it('refuses a write into another tenant’s register', async () => {
    const { type } = await seedFor(fixture, TENANT_A);

    // Tenant B, writing a row stamped as tenant A's. A policy that filtered reads and not writes
    // would accept this — quieter than reading, and worse.
    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        transaction.execute(
          `insert into document
             (id, tenant_id, document_type_id, owner_type, owner_id, title, status,
              confidentiality, verification_state, version_count, source,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, 'person', $4, '{}'::jsonb, 'draft', 'normal', 'unverified', 0,
                   'direct', now(), 'test', now(), 'test', 1)`,
          [uuidV7(), TENANT_A, type.documentTypeId, uuidV7()],
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses an update that would move a row into another tenant', async () => {
    const { document } = await seedFor(fixture, TENANT_A);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update document set tenant_id = $1 where id = $2`, [
          TENANT_B,
          document.documentId,
        ]),
      ),
    ).rejects.toThrow();
  });

  it('cannot reach another tenant’s rows even by identifier', async () => {
    const { document } = await seedFor(fixture, TENANT_A);

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.documents.byId(transaction, document.documentId),
    );

    // Not "forbidden": the row simply is not there, which is also what the query plan sees.
    expect(found).toBeUndefined();
  });
});

/** A type, a document, a version, a verification decision and an access event, all for one tenant. */
const seedFor = async (
  fixture: DocumentsFixture,
  tenantId: string,
): Promise<{
  readonly type: ReturnType<typeof aDocumentType>;
  readonly document: ReturnType<typeof aDocument>;
  readonly version: ReturnType<typeof aVersion>;
}> => {
  const ownerId = await fixture.seedPerson(tenantId);
  const type = aDocumentType();
  const document = aDocument(type, ownerId);
  const version = aVersion(document.documentId);
  const decision = recordVerification({
    verificationId: uuidV7(),
    documentId: document.documentId,
    documentVersionId: version.documentVersionId,
    decision: 'verified',
    decidedBy: 'user:verifier',
    decidedAt: new Date('2026-08-11T10:00:00Z'),
  });
  const access = recordAccess({
    accessEventId: uuidV7(),
    documentId: document.documentId,
    action: 'metadata_read',
    actor: 'user:reader',
    occurredAt: new Date('2026-08-11T10:00:00Z'),
    outcome: 'permitted',
  });

  if (!decision.ok || !access.ok) throw new Error('the isolation fixture built an invalid state');

  await fixture.asTenant(tenantId, async (transaction) => {
    await fixture.stores.types.insert(transaction, type);
    await fixture.stores.documents.insert(transaction, document);
    await fixture.stores.versions.insert(transaction, version);
    await fixture.stores.verifications.insert(transaction, decision.value);
    await fixture.stores.access.insert(transaction, access.value);
  });

  return { type, document, version };
};
