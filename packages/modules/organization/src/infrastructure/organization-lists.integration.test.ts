import type { Pool } from 'pg';
import { runInContext, uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { exportStructureHandler } from '../application/export.use-case.js';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openOrganizationFixture,
  requireDatabaseInCi,
  type OrganizationFixture,
} from './organization-database.fixture.js';

/**
 * The unit, position and financial center lists against PostgreSQL (MW-070).
 *
 * `GET /organization/units`, `/organization/positions` and `/organization/export` answered 500 on
 * every call that left a filter unset: the statements passed a parameter for each filter but only
 * referenced the ones that were set, and the count reused the list's parameters without its limit
 * and offset. PostgreSQL refuses a parameter it cannot type ("could not determine data type of
 * parameter $2"). An in-memory store cannot see that; only the real database can.
 */

requireDatabaseInCi('Organization list tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const AUDIT = `now(), 'test', now(), 'test', 1`;
const PAGE = { limit: 50, offset: 0 } as const;

const seedPosition = async (
  admin: Pool,
  tenantId: string,
  code: string,
  family: string,
): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into job_position
       (id, tenant_id, code, title, family, criticality, status, metadata, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4::jsonb, $5, 'standard', 'active', '{}'::jsonb, now(), ${AUDIT})`,
    [id, tenantId, code, JSON.stringify({ en: `${code} title`, ar: code }), family],
  );
  return id;
};

const seedCenter = async (
  admin: Pool,
  tenantId: string,
  kind: 'cost' | 'profit',
  code: string,
  status: string,
): Promise<void> => {
  await admin.query(
    `insert into financial_center
       (id, tenant_id, kind, code, name, status, metadata, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, $5::jsonb, $6, '{}'::jsonb, now(), ${AUDIT})`,
    [uuidV7(), tenantId, kind, code, JSON.stringify({ en: code, ar: code }), status],
  );
};

describeWithDatabase('Organization lists', () => {
  let fixture: OrganizationFixture;
  let department: string;
  let division: string;

  beforeAll(async () => {
    fixture = await openOrganizationFixture('work_org_lists_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    department = await fixture.seedUnitType(TENANT_A, 'department');
    division = await fixture.seedUnitType(TENANT_A, 'division');
    await fixture.seedUnit(TENANT_A, department, 'HR');
    await fixture.seedUnit(TENANT_A, department, 'FIN');
    await fixture.seedUnit(TENANT_A, division, 'OPS');
    await fixture.seedUnit(TENANT_B, await fixture.seedUnitType(TENANT_B, 'department'), 'HR');
  });

  const units = (query: Record<string, string>) =>
    fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.units.list(transaction, { ...PAGE, ...query }),
    );

  const positions = (query: Record<string, string>) =>
    fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.positions.list(transaction, { ...PAGE, ...query }),
    );

  describe('units', () => {
    it('lists with no filter at all, which is what the admin asks first', async () => {
      const page = await units({});

      expect(page.items.map((unit) => unit.code)).toEqual(['FIN', 'HR', 'OPS']);
      expect(page.total).toBe(3);
    });

    it.each([
      ['the unit type', () => ({ unitTypeId: department }), ['FIN', 'HR']],
      ['the status', () => ({ status: 'active' }), ['FIN', 'HR', 'OPS']],
      ['free text', () => ({ term: 'o' }), ['OPS']],
      [
        'every filter together',
        () => ({ unitTypeId: division, status: 'active', term: 'p' }),
        ['OPS'],
      ],
    ])('filters by %s alone, counting what it lists', async (_, query, codes) => {
      const page = await units(query());

      expect(page.items.map((unit) => unit.code)).toEqual(codes);
      expect(page.total).toBe(codes.length);
    });

    it('counts the whole match, not the page', async () => {
      const page = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.units.list(transaction, { limit: 1, offset: 1 }),
      );

      expect(page.items.map((unit) => unit.code)).toEqual(['HR']);
      expect(page.total).toBe(3);
    });
  });

  describe('positions', () => {
    let analyst: string;

    beforeEach(async () => {
      analyst = await seedPosition(fixture.admin, TENANT_A, 'ANALYST', 'Finance');
      await seedPosition(fixture.admin, TENANT_A, 'ENGINEER', 'Engineering');
    });

    it('lists with no filter at all', async () => {
      const page = await positions({});

      expect(page.items.map((position) => position.code)).toEqual(['ANALYST', 'ENGINEER']);
      expect(page.total).toBe(2);
    });

    it.each([
      ['the status', () => ({ status: 'active' }), ['ANALYST', 'ENGINEER']],
      ['the family', () => ({ family: 'Engineering' }), ['ENGINEER']],
      ['free text', () => ({ term: 'analyst' }), ['ANALYST']],
      ['one exact identifier', () => ({ positionId: analyst }), ['ANALYST']],
    ])('filters by %s alone, counting what it lists', async (_, query, codes) => {
      const page = await positions(query());

      expect(page.items.map((position) => position.code)).toEqual(codes);
      expect(page.total).toBe(codes.length);
    });
  });

  describe('financial centers', () => {
    beforeEach(async () => {
      await seedCenter(fixture.admin, TENANT_A, 'cost', 'CC-1', 'active');
      await seedCenter(fixture.admin, TENANT_A, 'cost', 'CC-2', 'inactive');
      await seedCenter(fixture.admin, TENANT_A, 'profit', 'PC-1', 'active');
    });

    it('lists one kind with no status filter, and with one', async () => {
      const all = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.centers.list(transaction, { kind: 'cost', ...PAGE }),
      );
      const active = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.centers.list(transaction, { kind: 'cost', status: 'active', ...PAGE }),
      );

      expect(all.items.map((center) => center.code)).toEqual(['CC-1', 'CC-2']);
      expect(all.total).toBe(2);
      expect(active.items.map((center) => center.code)).toEqual(['CC-1']);
      expect(active.total).toBe(1);
    });
  });

  describe('export', () => {
    it("exports the tenant's whole structure, and only that tenant's", async () => {
      await seedPosition(fixture.admin, TENANT_A, 'ANALYST', 'Finance');
      await seedCenter(fixture.admin, TENANT_A, 'cost', 'CC-1', 'active');
      await seedCenter(fixture.admin, TENANT_A, 'profit', 'PC-1', 'active');
      const handler = exportStructureHandler({
        unitOfWork: fixture.unitOfWork,
        stores: fixture.stores,
        filled: { filledFor: () => Promise.resolve(0) },
        clock: { now: () => new Date('2026-11-23T09:00:00Z') },
      });

      // The handler opens its own transaction, as it does behind the route.
      const result = await runInContext(
        { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' },
        () => handler.handle({ queryName: 'organization.export-structure' }),
      );

      if (!result.ok) throw new Error(`export refused: ${JSON.stringify(result.error)}`);
      expect(result.value.units.map((unit) => unit.code).sort()).toEqual(['FIN', 'HR', 'OPS']);
      expect(result.value.positions.map((position) => position.code)).toEqual(['ANALYST']);
      expect(result.value.centers.map((center) => center.code).sort()).toEqual(['CC-1', 'PC-1']);
    });
  });
});
