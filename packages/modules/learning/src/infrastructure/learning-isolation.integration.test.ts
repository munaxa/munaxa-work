import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  LEARNING_TABLES,
  TENANT_A,
  TENANT_B,
  openLearningFixture,
  requireDatabaseInCi,
  type LearningFixture,
} from './learning-database.fixture.js';
import {
  EMPLOYMENT,
  aCertification,
  aCourse,
  aCourseVersion,
  aPath,
  aRule,
  anAssignment,
  anEnrolment,
} from './learning-fixtures.js';

/**
 * Tenant isolation, through the repositories, as an unprivileged role, in both directions.
 *
 * **The role owns nothing and holds no `BYPASSRLS`.** That is the only configuration under which any
 * of this means anything: a superuser bypasses every policy, so a suite run as one would pass
 * whether or not isolation worked — and here that would mean reporting that one tenant cannot read
 * another's training records without ever having checked.
 *
 * **Both directions, and the counts too.** A policy that isolates A from B and not B from A is a
 * policy somebody wrote once and tested once. And a `count(*)` that included another tenant's rows
 * would leak their existence through a total even while hiding every row — "your competitor has
 * 4,000 people on safety training" is information.
 *
 * **What this does not prove**, stated rather than left to be assumed: row-level security isolates
 * *tenants*. "Employee A must not read employee B's assessment result" is not a tenant property — a
 * policy would have to know which employment the caller is, and this product has no
 * principal-to-employment resolution (ADR-0032). That guarantee is the application's, is asserted
 * through the repository's own bound predicate, and is stated as such rather than implied by a green
 * RLS test.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning isolation suite');

suite('learning isolation', () => {
  let fixture: LearningFixture;

  beforeAll(async () => {
    fixture = await openLearningFixture('learning_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** One of everything, written by tenant A through the repositories. */
  const seedTenantA = async (): Promise<{ courseId: string; certificationId: string }> => {
    const course = aCourse();
    const version = aCourseVersion(course.courseId);
    const certification = aCertification({ validUntil: '2029-01-15' });

    await fixture.inTenant(TENANT_A, async (transaction) => {
      await fixture.stores.courses.insert(transaction, course);
      await fixture.stores.versions.insert(transaction, version);
      await fixture.stores.paths.insert(transaction, aPath());
      await fixture.stores.rules.insert(transaction, aRule(course.courseId));
      await fixture.stores.assignments.insertIfAbsent(transaction, anAssignment(course.courseId));
      await fixture.stores.enrolments.insertIfAbsent(
        transaction,
        anEnrolment(course.courseId, version.courseVersionId),
      );
      await fixture.stores.certifications.insertIfAbsent(transaction, certification);
    });

    return { courseId: course.courseId, certificationId: certification.certificationId };
  };

  describe('the policies themselves', () => {
    it('is enabled and forced on all twelve tables, with no broad bypass on the role', async () => {
      const protection = await fixture.admin.query<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
      }>(
        `select relname, relrowsecurity, relforcerowsecurity from pg_class
          where relname = any($1::text[])`,
        [LEARNING_TABLES],
      );

      expect(protection.rows).toHaveLength(LEARNING_TABLES.length);
      for (const row of protection.rows) {
        // Enabled without forced leaves the owning role exempt, which is the half of this that is
        // easy to get wrong and impossible to notice.
        expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([
          row.relname,
          true,
          true,
        ]);
      }

      const role = await fixture.admin.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        `select rolsuper, rolbypassrls from pg_roles where rolname = 'learning_isolation_role'`,
      );

      // If this role could bypass, every assertion below would pass for the wrong reason.
      expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
    });

    it('scopes every policy by the ambient tenant, on read and on write alike', async () => {
      const policies = await fixture.admin.query<{
        tablename: string;
        qual: string;
        with_check: string | null;
      }>(`select tablename, qual, with_check from pg_policies where tablename = any($1::text[])`, [
        LEARNING_TABLES,
      ]);

      expect(policies.rows).toHaveLength(LEARNING_TABLES.length);
      for (const policy of policies.rows) {
        // `app_current_tenant()` reads `app.tenant_id`, which `PostgresUnitOfWork` sets
        // transaction-locally. A policy comparing against anything else — a literal, a session
        // variable, a column — would be a policy that survives a pooled connection changing hands.
        expect([policy.tablename, policy.qual, policy.with_check]).toEqual([
          policy.tablename,
          '(tenant_id = app_current_tenant())',
          '(tenant_id = app_current_tenant())',
        ]);
      }
    });

    it('resolves the tenant from a transaction-local setting, which a pooled reuse cannot inherit', async () => {
      const source = await fixture.admin.query<{ prosrc: string }>(
        `select prosrc from pg_proc where proname = 'app_current_tenant'`,
      );

      // `current_setting(..., true)` rather than a hard failure, and `::uuid` rather than text: a
      // policy comparing a uuid column to a string would compare nothing at all.
      expect(source.rows[0]?.prosrc).toContain(`current_setting('app.tenant_id', true)`);
      expect(source.rows[0]?.prosrc).toContain('::uuid');
    });
  });

  describe('tenant A and tenant B', () => {
    it('lets A read and write its own rows', async () => {
      const { courseId } = await seedTenantA();

      await fixture.inTenant(TENANT_A, async (transaction) => {
        const course = await fixture.stores.courses.byId(transaction, courseId);

        expect(course).toBeDefined();

        await fixture.stores.courses.update(
          transaction,
          { ...aCourse({ courseId }), status: 'archived' },
          1,
        );
        expect((await fixture.stores.courses.byId(transaction, courseId))?.status).toBe('archived');
      });
    });

    it('shows B nothing of A’s rows, on every store', async () => {
      await seedTenantA();

      await fixture.inTenant(TENANT_B, async (transaction) => {
        const paged = { limit: 100, offset: 0 };

        expect((await fixture.stores.courses.search(transaction, {}, paged)).items).toHaveLength(0);
        expect((await fixture.stores.paths.all(transaction, paged)).items).toHaveLength(0);
        expect((await fixture.stores.rules.all(transaction, false, paged)).items).toHaveLength(0);
        expect(
          (await fixture.stores.assignments.search(transaction, {}, paged)).items,
        ).toHaveLength(0);
        expect((await fixture.stores.enrolments.search(transaction, {}, paged)).items).toHaveLength(
          0,
        );
        expect(
          (await fixture.stores.certifications.search(transaction, {}, paged)).items,
        ).toHaveLength(0);
      });
    });

    it('leaks nothing through a total, which would disclose existence while hiding rows', async () => {
      await seedTenantA();

      await fixture.inTenant(TENANT_B, async (transaction) => {
        const paged = { limit: 100, offset: 0 };

        expect((await fixture.stores.courses.search(transaction, {}, paged)).total).toBe(0);
        expect((await fixture.stores.assignments.search(transaction, {}, paged)).total).toBe(0);
        expect((await fixture.stores.certifications.search(transaction, {}, paged)).total).toBe(0);
      });

      // And a raw count on every table, in case a repository ever grows one that is not paged.
      for (const table of LEARNING_TABLES) {
        const counted = await fixture.asTenant(TENANT_B, (client) =>
          client.query<{ total: string }>(`select count(*)::text as total from ${table}`),
        );

        expect([table, counted.rows[0]?.total]).toEqual([table, '0']);
      }
    });

    it('answers "not found" rather than "forbidden" for A’s identifier read by B', async () => {
      const { courseId, certificationId } = await seedTenantA();

      await fixture.inTenant(TENANT_B, async (transaction) => {
        // Not an error, and not a different message: an identifier from another tenant is simply
        // nothing here, which is the only answer that discloses nothing.
        expect(await fixture.stores.courses.byId(transaction, courseId)).toBeUndefined();
        expect(
          await fixture.stores.certifications.byId(transaction, certificationId),
        ).toBeUndefined();
        expect(
          await fixture.stores.assignments.openFor(transaction, EMPLOYMENT, courseId),
        ).toBeUndefined();
      });
    });

    it('cannot modify A’s rows from B, and reports the miss as a version conflict', async () => {
      const { courseId } = await seedTenantA();

      await fixture.inTenant(TENANT_B, async (transaction) => {
        // The update's `where` carries B's tenant, so it matches nothing. The base class then reads
        // the row to report the version it holds — and sees nothing there either.
        await expect(
          fixture.stores.courses.update(transaction, aCourse({ courseId }), 1),
        ).rejects.toThrow(/learning_course/);
      });

      await fixture.inTenant(TENANT_A, async (transaction) => {
        // A's row is untouched, at the version A left it.
        expect((await fixture.stores.courses.byId(transaction, courseId))?.version).toBe(1);
      });
    });

    it('lets B read its own rows while A’s remain invisible, in the other direction', async () => {
      await seedTenantA();

      const theirs = aCourse({ code: 'their-course' });

      await fixture.inTenant(TENANT_B, async (transaction) => {
        await fixture.stores.courses.insert(transaction, theirs);

        const found = await fixture.stores.courses.search(
          transaction,
          {},
          { limit: 10, offset: 0 },
        );

        expect(found.total).toBe(1);
        expect(found.items[0]?.courseId).toBe(theirs.courseId);
      });

      await fixture.inTenant(TENANT_A, async (transaction) => {
        const found = await fixture.stores.courses.search(
          transaction,
          {},
          { limit: 10, offset: 0 },
        );

        expect(found.total).toBe(1);
        expect(found.items[0]?.courseId).not.toBe(theirs.courseId);
      });
    });

    it('refuses a write that names another tenant rather than silently writing it', async () => {
      await expect(
        fixture.asTenant(TENANT_B, (client) =>
          client.query(
            `insert into learning_course
               (id, tenant_id, code, name, delivery, status, metadata,
                created_at, created_by, updated_at, updated_by, version)
             values (app_uuid_v7(), $1, 'smuggled', '{"en":"x","ar":"x"}'::jsonb, 'virtual',
                     'draft', '{}'::jsonb, now(), 'u', now(), 'u', 1)`,
            [TENANT_A],
          ),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('the cross-module boundary', () => {
    it('accepts an employment identifier no foreign key checks, and isolates it anyway', async () => {
      // `employment_id` carries no foreign key: a cross-module key does not enforce tenant
      // isolation (ADR-0042), and Learning does not query Employment's tables. The identifier is
      // confirmed by the application through Employment's published contract before it gets here.
      const course = aCourse();

      await fixture.inTenant(TENANT_A, async (transaction) => {
        await fixture.stores.courses.insert(transaction, course);
        await fixture.stores.assignments.insertIfAbsent(
          transaction,
          anAssignment(course.courseId, { employmentId: EMPLOYMENT }),
        );
      });

      // The same employment identifier, read by the other tenant, finds nothing — because the row
      // is isolated by tenant, not by anything the identifier itself asserts.
      await fixture.inTenant(TENANT_B, async (transaction) => {
        const found = await fixture.stores.assignments.search(
          transaction,
          { employmentId: EMPLOYMENT },
          { limit: 10, offset: 0 },
        );

        expect(found.total).toBe(0);
      });
    });

    it('holds no foreign key from Learning to any other module’s table', async () => {
      const foreign = await fixture.admin.query<{ table_name: string; foreign_table: string }>(
        `select tc.table_name, ccu.table_name as foreign_table
           from information_schema.table_constraints tc
           join information_schema.constraint_column_usage ccu
             on ccu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY' and tc.table_name like 'learning\\_%'`,
      );

      // Every foreign key Learning holds points at a Learning table. A key reaching into People,
      // Employment, Organization, Documents or Performance would be a cross-module coupling the
      // architecture forbids — and would not enforce tenant isolation anyway.
      for (const row of foreign.rows) {
        expect([row.table_name, row.foreign_table.startsWith('learning_')]).toEqual([
          row.table_name,
          true,
        ]);
      }
      expect(foreign.rows.length).toBeGreaterThan(0);
    });
  });
});
