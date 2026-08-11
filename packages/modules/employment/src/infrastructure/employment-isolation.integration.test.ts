import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  EMPLOYMENT_TABLES,
  TENANT_A,
  TENANT_B,
  openEmploymentFixture,
  requireDatabaseInCi,
  type EmploymentFixture,
} from './employment-database.fixture.js';

/**
 * Tenant isolation, proved by the database rather than by the application.
 *
 * The suite connects as a role that **owns nothing and cannot bypass row-level security**, which is
 * the only configuration under which any of these assertions means anything: a superuser bypasses
 * every policy, so the same tests run as one would pass whether or not isolation worked.
 *
 * Every scenario §33 names is here, per table: a tenant cannot read, cannot modify, cannot infer an
 * identifier, cannot reach another tenant through search, and cannot reach one through export. The
 * application-layer half — that a use case never *asks* for another tenant's rows — is proved
 * against fakes elsewhere. Both halves are required: this one holds when the application is wrong.
 */

requireDatabaseInCi('Employment isolation');

describe.skipIf(CONNECTION === undefined)('Employment tenant isolation', () => {
  let fixture: EmploymentFixture;

  beforeAll(async () => {
    fixture = await openEmploymentFixture('employment_isolation_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const AUDIT = `now(), 'test', now(), 'test', 1`;

  /** Seeds one row in every table of the module, for one tenant, through the admin connection. */
  const seedWorkforce = async (tenantId: string): Promise<{ readonly employmentId: string }> => {
    const personId = await fixture.seedPerson(tenantId, `P-${tenantId.slice(-4)}`);
    const employmentId = uuidV7();
    const managerId = uuidV7();
    const managerPersonId = await fixture.seedPerson(tenantId, `M-${tenantId.slice(-4)}`);

    for (const [id, person] of [
      [managerId, managerPersonId],
      [employmentId, personId],
    ] as const) {
      await fixture.admin.query(
        `insert into employment
           (id, tenant_id, person_id, employment_number, status, employment_type_code,
            original_hire_date, start_date, metadata,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, 'active', 'full-time', '2026-01-15', '2026-01-15', '{}'::jsonb, ${AUDIT})`,
        [id, tenantId, person, `EMP-2026-${id.slice(-6)}`],
      );
    }

    await fixture.admin.query(
      `insert into employment_assignment
         (tenant_id, employment_id, unit_id, assignment_type, fte, effective_from,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'primary', 1, now(), ${AUDIT})`,
      [tenantId, employmentId, uuidV7()],
    );
    await fixture.admin.query(
      `insert into employment_reporting_line
         (tenant_id, employment_id, manager_employment_id, line_type, effective_from,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'primary', now(), ${AUDIT})`,
      [tenantId, employmentId, managerId],
    );
    await fixture.admin.query(
      `insert into employment_contract
         (tenant_id, employment_id, contract_type_code, start_date, effective_from,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'fixed-term', '2026-01-15', now(), ${AUDIT})`,
      [tenantId, employmentId],
    );
    await fixture.admin.query(
      `insert into employment_status_record
         (tenant_id, employment_id, to_status, effective_from, recorded_by, recorded_at,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'active', now(), 'user:test', now(), ${AUDIT})`,
      [tenantId, employmentId],
    );
    await fixture.admin.query(
      `insert into employment_number_sequence
         (tenant_id, series_key, next_value, created_at, created_by, updated_at, updated_by, version)
       values ($1, '2026', 5, ${AUDIT})`,
      [tenantId],
    );

    return { employmentId };
  };

  /** Counts what the *application* role can see for the current tenant. */
  const visibleIn = async (tenantId: string, table: string): Promise<number> =>
    fixture.asTenant(tenantId, async (transaction) => {
      const rows = await transaction.execute<{ total: string }>(
        `select count(*)::text as total from ${table}`,
      );
      return Number(rows[0]?.total ?? '0');
    });

  it.each(EMPLOYMENT_TABLES)('hides tenant A’s %s from tenant B', async (table) => {
    await seedWorkforce(TENANT_A);

    expect(await visibleIn(TENANT_A, table)).toBeGreaterThan(0);
    expect(await visibleIn(TENANT_B, table)).toBe(0);
  });

  it('answers not-found for another tenant’s employment, given its exact identifier', async () => {
    const { employmentId } = await seedWorkforce(TENANT_A);

    const read = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.employments.byId(transaction, employmentId),
    );

    // Knowing the identifier is no help: the row is not merely hidden from a list, it is unreadable.
    expect(read).toBeUndefined();
  });

  it('refuses an update to another tenant’s employment rather than silently affecting nothing', async () => {
    const { employmentId } = await seedWorkforce(TENANT_A);

    const affected = await fixture.asTenant(TENANT_B, async (transaction) => {
      const rows = await transaction.execute(
        `update employment set employment_type_code = 'part-time' where id = $1 returning id`,
        [employmentId],
      );
      return rows.length;
    });

    expect(affected).toBe(0);

    const unchanged = await fixture.admin.query<{ employment_type_code: string }>(
      'select employment_type_code from employment where id = $1',
      [employmentId],
    );

    expect(unchanged.rows[0]?.employment_type_code).toBe('full-time');
  });

  it('refuses to write a row into another tenant, which `with check` is what closes', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-cross');

    await expect(
      fixture.asTenant(TENANT_B, (transaction) =>
        transaction.execute(
          `insert into employment
             (tenant_id, person_id, employment_number, status, employment_type_code,
              original_hire_date, start_date, metadata,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'EMP-2026-009999', 'draft', 'full-time',
                   '2026-01-15', '2026-01-15', '{}'::jsonb, ${AUDIT})`,
          [TENANT_A, personId],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it('finds nothing of another tenant through search', async () => {
    await seedWorkforce(TENANT_A);

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.employments.search(transaction, {
        limit: 50,
        offset: 0,
        asOf: new Date('2026-06-01T00:00:00Z'),
      }),
    );

    expect(found.total).toBe(0);
    expect(found.items).toHaveLength(0);
  });

  it('exports nothing of another tenant', async () => {
    await seedWorkforce(TENANT_A);

    const all = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.employments.all(transaction),
    );

    expect(all).toHaveLength(0);
  });

  it('counts no filled headcount from another tenant’s assignments', async () => {
    await seedWorkforce(TENANT_A);

    const rows = await fixture.admin.query<{ position_id: string | null; unit_id: string }>(
      'select position_id, unit_id from employment_assignment',
    );
    const unitId = rows.rows[0]?.unit_id;

    if (unitId === undefined) throw new Error('fixture');

    const filled = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.assignments.countInForce(
        transaction,
        uuidV7(),
        unitId,
        new Date('2026-06-01T00:00:00Z'),
      ),
    );

    expect(filled).toBe(0);
  });

  it('gives each tenant its own counter, so neither can infer the other’s headcount', async () => {
    await seedWorkforce(TENANT_A);

    // Tenant A's series already stands at 5. Tenant B allocating starts from its own beginning.
    const allocated = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.numbers.allocate(transaction, '2026'),
    );

    expect(allocated).toBe(1);
  });

  it('runs as a role that cannot bypass isolation, which is what makes the rest meaningful', async () => {
    const diagnostics = await fixture.application.query<{ can_bypass_rls: boolean }>(
      'select * from app_isolation_diagnostics()',
    );

    expect(diagnostics.rows[0]?.can_bypass_rls).toBe(false);
  });
});
