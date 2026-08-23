import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openRelationsFixture,
  requireDatabaseInCi,
  type RelationsFixture,
} from './relations-database.fixture.js';

/**
 * Row-level security over three tables that hold disciplinary allegations, against real PostgreSQL,
 * as an **unprivileged role**.
 *
 * The role holds no `BYPASSRLS` and owns nothing. That is the whole point: a suite run as a
 * superuser would report that one organisation cannot read another's disciplinary records without
 * having checked, which in this domain is the most dangerous false pass available.
 *
 * **Every isolation assertion confirms the other tenant's row exists.** A "0 rows" that came from a
 * row never written proves nothing; a "0 rows" over a row the admin connection can see is a policy
 * doing its job.
 */

requireDatabaseInCi('Relations isolation');

describe.skipIf(CONNECTION === undefined)('relations, across tenants', () => {
  let fixture: RelationsFixture;

  beforeAll(async () => {
    fixture = await openRelationsFixture('relations_isolation_fixture');
  });

  afterEach(async () => {
    await fixture.truncate();
  });

  afterAll(async () => {
    await fixture.close();
  });

  const givenCategory = (tenantId: string, code: string): Promise<string> =>
    fixture.asTenant(tenantId, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.categories.insert(transaction, {
        violationCategoryId: id,
        code,
        name: { en: 'Unauthorized absence', ar: 'غياب غير مصرح به' },
        severity: 'major',
        sequence: 10,
        repeatWindowDays: 180,
        source: 'tenant',
        active: true,
        version: 1,
      });
      return id;
    });

  const givenViolation = (tenantId: string, categoryId: string): Promise<string> =>
    fixture.asTenant(tenantId, async (transaction) => {
      const id = uuidV7();

      await fixture.stores.violations.insert(transaction, {
        violationId: id,
        employmentId: uuidV7(),
        violationCategoryId: categoryId,
        categoryCode: 'unauthorized-absence',
        severity: 'major',
        occurredOn: '2026-08-14',
        reportedBy: 'user:officer',
        description: 'Absent without notice.',
        state: 'reported',
        recordedAt: new Date('2026-08-22T09:00:00Z'),
        version: 1,
      });
      return id;
    });

  it("cannot read another tenant's catalogue, and the entry provably exists", async () => {
    await givenCategory(TENANT_B, 'b-only');

    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.categories.all(transaction, true),
    );
    const reallyThere = await fixture.admin.query<{ total: string }>(
      `select count(*)::text as total from relation_violation_category where tenant_id = $1`,
      [TENANT_B],
    );

    expect(seenByA).toHaveLength(0);
    expect(reallyThere.rows[0]?.total).toBe('1');
  });

  it("cannot read another tenant's violation by its identifier", async () => {
    const categoryId = await givenCategory(TENANT_B, 'b-only');
    const violationId = await givenViolation(TENANT_B, categoryId);

    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.violations.byId(transaction, violationId),
    );
    const seenByB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.violations.byId(transaction, violationId),
    );

    expect(seenByA).toBeUndefined();
    expect(seenByB?.violationId).toBe(violationId);
  });

  it("cannot list another tenant's violations for an employment it can name", async () => {
    const categoryId = await givenCategory(TENANT_B, 'b-only');

    await givenViolation(TENANT_B, categoryId);

    const employmentId = (
      await fixture.admin.query<{ employment_id: string }>(
        `select employment_id from relation_violation where tenant_id = $1`,
        [TENANT_B],
      )
    ).rows[0]?.employment_id;

    const seenByA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.violations.forEmployment(transaction, employmentId ?? uuidV7(), {
        limit: 50,
        offset: 0,
      }),
    );

    // Knowing the employment identifier is not enough. Tenancy is the filter, not obscurity.
    expect([seenByA.total, seenByA.items.length]).toStrictEqual([0, 0]);
  });

  /**
   * The write direction, which is the one an application defect actually reaches.
   *
   * A bug binding the wrong tenant would try to insert one tenant's row while the session is set to
   * another's. `app_protect_table`'s policy refuses it rather than silently filing a disciplinary
   * record into the wrong organisation.
   */
  it("cannot write a violation into another tenant's rows", async () => {
    const categoryId = await givenCategory(TENANT_A, 'a-only');

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into relation_violation
             (tenant_id, employment_id, violation_category_id, category_code, severity,
              occurred_on, reported_by, description, state, recorded_at, metadata,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, 'unauthorized-absence', 'major',
                   '2026-08-14', 'user:officer', 'Absent.', 'reported', now(), '{}'::jsonb,
                   now(), 'test', now(), 'test', 1)`,
          [TENANT_B, uuidV7(), categoryId],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("cannot write a catalogue entry into another tenant's rows", async () => {
    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into relation_violation_category
             (tenant_id, code, name, severity, sequence, repeat_window_days, source, active,
              metadata, created_at, created_by, updated_at, updated_by, version)
           values ($1, 'smuggled', '{"en":"X","ar":"س"}'::jsonb, 'major', 1, 30, 'tenant', true,
                   '{}'::jsonb, now(), 'test', now(), 'test', 1)`,
          [TENANT_B],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  /** Both tenants get the same treatment; isolation that worked one way only would be a bug. */
  it('isolates in both directions, with each tenant seeing exactly its own', async () => {
    await givenCategory(TENANT_A, 'shared-code');
    await givenCategory(TENANT_B, 'shared-code');

    const forA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.categories.all(transaction, true),
    );
    const forB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.categories.all(transaction, true),
    );

    expect([forA.length, forB.length]).toStrictEqual([1, 1]);
    expect(forA[0]?.violationCategoryId).not.toBe(forB[0]?.violationCategoryId);
  });

  /** RLS is enabled **and forced**, so even a table owner is subject to it (ADR-0030). */
  it.each(['relation_violation_category', 'relation_violation', 'relation_violation_access_event'])(
    'has row-level security enabled and forced on %s',
    async (table) => {
      const found = await fixture.admin.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(`select relrowsecurity, relforcerowsecurity from pg_class where relname = $1`, [table]);

      expect([found.rows[0]?.relrowsecurity, found.rows[0]?.relforcerowsecurity]).toStrictEqual([
        true,
        true,
      ]);
    },
  );
});
