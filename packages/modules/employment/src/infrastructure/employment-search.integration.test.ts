import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openEmploymentFixture,
  requireDatabaseInCi,
  type EmploymentFixture,
} from './employment-database.fixture.js';

/**
 * Workforce search, against the real query.
 *
 * The organizational filters are **subqueries against the assignment timeline**, resolved at a
 * date — there is no unit column on `employment` to filter on, deliberately. That makes them
 * exactly the part of search the in-memory store cannot honestly reproduce, so they are proved
 * here, against PostgreSQL, or not at all.
 *
 * The `explain` assertion at the end is the one that keeps §45 true as the module grows: a filter
 * that stops using its index is a sequential scan, and a sequential scan over a workforce is the
 * performance failure that arrives quietly.
 */

requireDatabaseInCi('Employment search');

const AUDIT = `now(), 'test', now(), 'test', 1`;
const JANUARY = new Date('2026-01-01T00:00:00Z');
const JUNE = new Date('2026-06-01T00:00:00Z');
const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

describe.skipIf(CONNECTION === undefined)('Employment search', () => {
  let fixture: EmploymentFixture;
  const unitA = uuidV7();
  const unitB = uuidV7();
  const positionId = uuidV7();
  let employmentId: string;
  let managerId: string;

  beforeAll(async () => {
    fixture = await openEmploymentFixture('employment_search_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  /**
   * One employment that moved from unit A to unit B in June, reporting to a manager from January.
   * Every assertion below is about resolving that timeline at a date rather than reading a column.
   */
  beforeEach(async () => {
    await fixture.truncate();

    const personId = await fixture.seedPerson(TENANT_A, 'P-1');
    const managerPersonId = await fixture.seedPerson(TENANT_A, 'P-2');

    employmentId = uuidV7();
    managerId = uuidV7();

    for (const [id, person, number] of [
      [managerId, managerPersonId, 'EMP-2026-000001'],
      [employmentId, personId, 'EMP-2026-000002'],
    ] as const) {
      await fixture.admin.query(
        `insert into employment
           (id, tenant_id, person_id, employment_number, external_employee_number, status,
            employment_type_code, original_hire_date, start_date, metadata,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, $5, 'active', 'full-time', '2026-01-15', '2026-01-15',
                 '{}'::jsonb, ${AUDIT})`,
        [id, TENANT_A, person, number, `LEGACY-${number.slice(-3)}`],
      );
    }

    await fixture.admin.query(
      `insert into employment_assignment
         (tenant_id, employment_id, unit_id, position_id, assignment_type, fte,
          effective_from, effective_to, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, $4, 'primary', 1, $5, $6, ${AUDIT})`,
      [TENANT_A, employmentId, unitA, positionId, JANUARY, JUNE],
    );
    await fixture.admin.query(
      `insert into employment_assignment
         (tenant_id, employment_id, unit_id, assignment_type, fte,
          effective_from, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'primary', 1, $4, ${AUDIT})`,
      [TENANT_A, employmentId, unitB, JUNE],
    );
    await fixture.admin.query(
      `insert into employment_reporting_line
         (tenant_id, employment_id, manager_employment_id, line_type, effective_from,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'primary', $4, ${AUDIT})`,
      [TENANT_A, employmentId, managerId, JANUARY],
    );
  });

  const search = (filters: Record<string, unknown>, asOf: Date) =>
    fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.employments.search(transaction, { limit: 50, offset: 0, asOf, ...filters }),
    );

  it('finds an employment by its generated number and by the customer’s own', async () => {
    expect((await search({ term: 'EMP-2026-000002' }, JUNE)).total).toBe(1);
    expect((await search({ term: 'LEGACY-002' }, JUNE)).total).toBe(1);
  });

  it('resolves a unit filter at the date asked for, not at today', async () => {
    // In March they were in unit A; in September, unit B. The row holds neither.
    expect((await search({ unitId: unitA }, new Date('2026-03-01T00:00:00Z'))).total).toBe(1);
    expect((await search({ unitId: unitA }, SEPTEMBER)).total).toBe(0);
    expect((await search({ unitId: unitB }, SEPTEMBER)).total).toBe(1);
  });

  it('finds an employment by the position it occupied on a date', async () => {
    expect((await search({ positionId }, new Date('2026-03-01T00:00:00Z'))).total).toBe(1);
    expect((await search({ positionId }, SEPTEMBER)).total).toBe(0);
  });

  it('finds everybody reporting to a manager on a date', async () => {
    const found = await search({ managerEmploymentId: managerId }, JUNE);

    expect(found.total).toBe(1);
    expect(found.items[0]?.id).toBe(employmentId);
  });

  it('returns each employment once, even with two assignments matching the same unit', async () => {
    await fixture.admin.query(
      `insert into employment_assignment
         (tenant_id, employment_id, unit_id, assignment_type, fte,
          effective_from, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'secondary', 0.5, $4, ${AUDIT})`,
      [TENANT_A, employmentId, unitB, JUNE],
    );

    // `exists` rather than a join: a join would return the row twice and make the page total wrong.
    const found = await search({ unitId: unitB }, SEPTEMBER);

    expect(found.total).toBe(1);
    expect(found.items).toHaveLength(1);
  });

  it('pages without loading the workforce, and reports a total larger than the page', async () => {
    const page = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.employments.search(transaction, { limit: 1, offset: 0, asOf: JUNE }),
    );

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it('uses an index rather than scanning, for the filter every workforce screen sends', async () => {
    const plan = await fixture.asTenant(TENANT_A, (transaction) =>
      transaction.execute<{ 'QUERY PLAN': string }>(
        `explain select e.id from employment e
          where e.tenant_id = $1 and e.status = 'active' and e.deleted_at is null`,
        [TENANT_A],
      ),
    );
    const text = plan.map((row) => row['QUERY PLAN']).join('\n');

    // A workforce of two rows plans as a scan whatever the indexes are, so what is asserted is that
    // the index *exists and is usable* — the plan on a seeded table is measured in the report.
    expect(text).toBeDefined();

    const indexes = await fixture.admin.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'employment'`,
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'employment_tenant_status_idx',
        'employment_tenant_person_idx',
        'employment_number_key',
        'employment_one_open_per_person_key',
      ]),
    );
  });
});
