import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  LETTERS_TABLES,
  TENANT_A,
  TENANT_B,
  openLettersFixture,
  requireDatabaseInCi,
  type LettersFixture,
} from './letters-database.fixture.js';
import { aRequest, aTemplate, aTemplateVersion, anIssuedLetter } from './letters-fixtures.js';

/**
 * Row-level security, on all six of this module's tables.
 *
 * A letter's frozen snapshot can contain a salary figure, and its verification token is the thing a
 * third party presents to confirm authenticity. Either leaking across a tenant boundary would be
 * serious in a different way: the first discloses pay, the second lets one customer verify — or
 * repudiate — another's letters.
 *
 * The suite connects as a role that **owns nothing and holds no `BYPASSRLS`**, and checks both
 * directions: a policy that filters reads and not writes lets one tenant *insert into* another's
 * register, which is quieter than reading it and worse.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Letters isolation suite');

suite('letters row-level security', () => {
  let fixture: LettersFixture;

  beforeAll(async () => {
    fixture = await openLettersFixture('letters_isolation_role');
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
      [LETTERS_TABLES],
    );

    expect(protectedTables.rows.map((row) => row.tablename).sort()).toEqual(
      [...LETTERS_TABLES].sort(),
    );
    for (const row of protectedTables.rows) {
      expect(Number(row.count)).toBeGreaterThan(0);
    }
  });

  it('hides one tenant’s templates and register from another', async () => {
    const { template, letter } = await seedFor(fixture, TENANT_A);

    const [templates, register] = await fixture.asTenant(TENANT_B, async (transaction) => [
      await fixture.stores.templates.all(transaction),
      await fixture.stores.issued.search(transaction, {}, { limit: 50, offset: 0 }),
    ]);

    expect(templates).toHaveLength(0);
    expect(register.total).toBe(0);

    const byId = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.templates.byId(transaction, template.letterTemplateId),
    );

    expect(byId).toBeUndefined();
    // And the letter is genuinely there for the tenant that owns it.
    const owned = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.issued.byId(transaction, letter.issuedLetterId),
    );

    expect(owned).toBeDefined();
  });

  it('will not verify another tenant’s letter by its token', async () => {
    const { letter } = await seedFor(fixture, TENANT_A);

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.issued.byVerificationToken(transaction, letter.verificationToken),
    );

    // A token that verified across tenants would let one customer confirm — or repudiate —
    // another's letters.
    expect(found).toBeUndefined();
  });

  it('keeps each tenant’s reference numbering separate', async () => {
    const forA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.numbers.allocate(transaction, 'letter'),
    );
    const forB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.numbers.allocate(transaction, 'letter'),
    );

    // Both start at 1. A shared counter would let one customer infer another's letter volume.
    expect(forA).toBe(1);
    expect(forB).toBe(1);
  });

  it('refuses a write into another tenant’s register', async () => {
    const { template } = await seedFor(fixture, TENANT_A);

    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        transaction.execute(
          `insert into letter_request
             (id, tenant_id, letter_template_id, letter_template_version_id, employment_id,
              person_id, locale, status, requested_by, requested_at,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, $4, $5, $6, 'en', 'requested', 'user:intruder', now(),
                   now(), 'test', now(), 'test', 1)`,
          [
            uuidV7(),
            TENANT_A,
            template.letterTemplateId,
            template.currentVersionId ?? uuidV7(),
            uuidV7(),
            uuidV7(),
          ],
        ),
      ),
    ).rejects.toThrow();
  });

  it('refuses an update that would move a row into another tenant', async () => {
    const { request } = await seedFor(fixture, TENANT_A);

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(`update letter_request set tenant_id = $1 where id = $2`, [
          TENANT_B,
          request.letterRequestId,
        ]),
      ),
    ).rejects.toThrow();
  });
});

/** A template, a published version, a request and one issued letter, all for one tenant. */
const seedFor = async (
  fixture: LettersFixture,
  tenantId: string,
): Promise<{
  readonly template: ReturnType<typeof aTemplate>;
  readonly request: ReturnType<typeof aRequest>;
  readonly letter: ReturnType<typeof anIssuedLetter>;
}> => {
  const drafted = aTemplate();
  const version = { ...aTemplateVersion(drafted.letterTemplateId), status: 'published' as const };
  const template = { ...drafted, currentVersionId: version.letterTemplateVersionId };
  const request = aRequest(template, version);
  const letter = anIssuedLetter(request, version);

  await fixture.asTenant(tenantId, async (transaction) => {
    await fixture.stores.templates.insert(transaction, template);
    await fixture.stores.templateVersions.insert(transaction, version);
    await fixture.stores.requests.insert(transaction, request);
    await fixture.stores.issued.insert(transaction, letter);
  });

  return { template, request, letter };
};
