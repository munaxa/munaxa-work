import { uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FinancialCenter } from '../domain/financial-center.js';
import { LegalEntity } from '../domain/legal-entity.js';
import { OrganizationCalendar } from '../domain/organization-calendar.js';
import { Position } from '../domain/position.js';
import { Establishment } from '../domain/establishment.js';
import { UnitPlacement } from '../domain/unit-placement.js';
import { TenantSettings } from '../domain/tenant-settings.js';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openOrganizationFixture,
  requireDatabaseInCi,
  type OrganizationFixture,
} from './organization-database.fixture.js';

/**
 * Tenant isolation, per entity, against a real PostgreSQL (ADR-0030).
 *
 * The strongest form of the property, not the weakest: not "a list comes back filtered", but
 * "a caller who already knows the primary key still cannot read the row". That is the shape the
 * failure would take — a bug that leaks an identifier, followed by a fetch — and it is the one
 * row-level security has to survive.
 *
 * The suite connects as an unprivileged role that cannot bypass row-level security. Run as a
 * superuser it would pass whether or not isolation worked, which is the trap this fixture exists
 * to avoid.
 */

requireDatabaseInCi('Organization isolation tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const origin = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');
const bilingual = { en: 'Name', ar: 'اسم' };

describeWithDatabase('Organization tenant isolation', () => {
  let fixture: OrganizationFixture;

  beforeAll(async () => {
    fixture = await openOrganizationFixture('work_org_isolation_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it("hides another tenant's unit type and unit, by their exact identifiers", async () => {
    const type = await fixture.seedUnitType(TENANT_A, 'department');
    const unit = await fixture.seedUnit(TENANT_A, type, 'HR');

    const foundType = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.unitTypes.byId(transaction, type),
    );
    const foundUnit = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.units.byId(transaction, unit),
    );

    expect(foundType).toBeUndefined();
    expect(foundUnit).toBeUndefined();
  });

  it('hides every dependent entity from another tenant, by exact identifier', async () => {
    const type = await fixture.seedUnitType(TENANT_A, 'legal-entity', true);
    const unit = await fixture.seedUnit(TENANT_A, type, 'CO');
    const ids = await fixture.asTenant(TENANT_A, async (transaction) => {
      const placement = UnitPlacement.open(
        { tenantId: TENANT_A, unitId: unit, effectiveFrom: january },
        origin,
        now,
      );
      const entity = LegalEntity.register(
        {
          tenantId: TENANT_A,
          unitId: unit,
          countryCode: 'SA',
          registeredName: bilingual,
          registrationNumber: '1010',
          currencyCode: 'SAR',
          effectiveFrom: january,
        },
        origin,
        now,
      );
      const center = FinancialCenter.open(
        { tenantId: TENANT_A, kind: 'cost', code: 'CC-1', name: bilingual, effectiveFrom: january },
        origin,
        now,
      );
      const position = Position.define(
        { tenantId: TENANT_A, code: 'HR-MGR', title: bilingual, effectiveFrom: january },
        origin,
        now,
      );

      if (!entity.ok || !center.ok || !position.ok) throw new Error('setup');

      const line = Establishment.set(
        {
          tenantId: TENANT_A,
          positionId: position.value.id,
          unitId: unit,
          budgetedHeadcount: 3,
          effectiveFrom: january,
        },
        origin,
        now,
      );
      const calendar = OrganizationCalendar.define(
        {
          tenantId: TENANT_A,
          code: 'CORP',
          name: bilingual,
          timeZone: 'Asia/Riyadh',
          workingDays: [1, 2, 3, 4, 7],
          effectiveFrom: january,
        },
        origin,
        now,
      );

      if (!line.ok || !calendar.ok) throw new Error('setup');

      await fixture.stores.placements.insert(transaction, placement.snapshot());
      await fixture.stores.legalEntities.insert(transaction, entity.value.snapshot());
      await fixture.stores.centers.insert(transaction, center.value.snapshot());
      await fixture.stores.positions.insert(transaction, position.value.snapshot());
      await fixture.stores.establishments.insert(transaction, line.value.snapshot());
      await fixture.stores.calendars.insert(transaction, calendar.value.snapshot());
      await fixture.stores.calendars.upsertDay(transaction, {
        id: uuidV7(),
        tenantId: TENANT_A,
        calendarId: calendar.value.id,
        onDate: '2027-03-20',
        kind: 'holiday',
        name: bilingual,
        version: 0,
      });

      return {
        placement: placement.id,
        legalEntity: entity.value.id,
        center: center.value.id,
        position: position.value.id,
        establishment: line.value.id,
        calendar: calendar.value.id,
      };
    });

    await fixture.asTenant(TENANT_B, async (transaction) => {
      expect(await fixture.stores.placements.byId(transaction, ids.placement)).toBeUndefined();
      expect(await fixture.stores.legalEntities.byId(transaction, ids.legalEntity)).toBeUndefined();
      expect(await fixture.stores.centers.byId(transaction, ids.center)).toBeUndefined();
      expect(await fixture.stores.positions.byId(transaction, ids.position)).toBeUndefined();
      expect(
        await fixture.stores.establishments.byId(transaction, ids.establishment),
      ).toBeUndefined();
      expect(await fixture.stores.calendars.byId(transaction, ids.calendar)).toBeUndefined();
      expect(
        await fixture.stores.calendars.dayOn(transaction, ids.calendar, '2027-03-20'),
      ).toBeUndefined();
      // The one that would leak a whole organization if it were wrong: the ancestor walk reads
      // every placement in the tenant, and a policy that missed this table would hand another
      // customer's entire structure to a single query.
      expect(await fixture.stores.placements.all(transaction)).toEqual([]);
      expect(await fixture.stores.units.all(transaction)).toEqual([]);
    });
  });

  it('refuses an insert into another tenant, rather than accepting it invisibly', async () => {
    const type = await fixture.seedUnitType(TENANT_B, 'department');

    await expect(
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.units.insert(transaction, {
          id: uuidV7(),
          tenantId: TENANT_B,
          unitTypeId: type,
          code: 'SMUGGLED',
          name: bilingual,
          status: 'active',
          metadata: {},
          effectiveFrom: january,
          version: 0,
        }),
      ),
    ).rejects.toThrow(/policy/i);
  });

  it('fails closed with no tenant set, returning nothing rather than everything', async () => {
    const type = await fixture.seedUnitType(TENANT_A, 'department');

    await fixture.seedUnit(TENANT_A, type, 'HR');

    const rows = await fixture.application.query<{ total: number }>(
      'select count(*)::int as total from organization_unit',
    );

    // No `app.tenant_id` on this connection at all. The policy resolves to no rows, which is the
    // direction a failure has to take.
    expect(rows.rows[0]?.total).toBe(0);
  });

  it("hides another tenant's settings, which is what makes per-tenant settings safe", async () => {
    await fixture.asTenant(TENANT_A, async (transaction) => {
      const settings = TenantSettings.configure(
        {
          tenantId: TENANT_A,
          language: 'ar',
          calendar: 'hijri',
          timeZone: 'Asia/Riyadh',
          numerals: 'arabic-indic',
          invitationValidityDays: 14,
          defaultPortals: ['employee'],
        },
        origin,
        now,
      );

      if (!settings.ok) throw new Error('setup');
      await fixture.stores.tenantSettings.insert(transaction, settings.value.snapshot());
    });

    const leaked = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.tenantSettings.forTenant(transaction, TENANT_A),
    );

    expect(leaked).toBeUndefined();
  });
});
