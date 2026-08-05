import { uuidV7 } from '@work/kernel';
import { ConcurrencyException } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { OrganizationCalendar } from '../domain/organization-calendar.js';
import { UnitPlacement } from '../domain/unit-placement.js';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openOrganizationFixture,
  requireDatabaseInCi,
  type OrganizationFixture,
} from './organization-database.fixture.js';
import { StoredTenantSettings } from './stored-tenant-settings.js';

/**
 * What the database enforces rather than the application.
 *
 * Each of these is a rule the application also checks, and each is here because the application
 * check is one deployment, one script and one data fix away from being bypassed. A constraint is
 * what makes the rule true of the data rather than true of the code path somebody happened to
 * use.
 */

requireDatabaseInCi('Organization persistence tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const origin = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');
const june = new Date('2026-06-01T00:00:00Z');

const RIYADH = {
  language: 'ar',
  calendar: 'hijri',
  timeZone: 'Asia/Riyadh',
  numerals: 'arabic-indic',
  invitationValidityDays: 14,
  defaultPortals: ['employee'],
};

const AMMAN = {
  language: 'en',
  calendar: 'gregorian',
  timeZone: 'Asia/Amman',
  numerals: 'western',
  invitationValidityDays: 30,
  defaultPortals: ['employee', 'manager'],
};

const DEPLOYMENT_DEFAULTS = {
  language: 'en',
  calendar: 'gregorian' as const,
  timeZone: 'UTC',
  numerals: 'western' as const,
  invitationValidityDays: 7,
  defaultPortals: ['employee'] as const,
};

describeWithDatabase('Organization persistence', () => {
  let fixture: OrganizationFixture;

  beforeAll(async () => {
    fixture = await openOrganizationFixture('work_org_persistence_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  describe('constraints the database keeps rather than the application', () => {
    it('refuses a unit whose name is missing a first-class language', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into organization_unit
               (id, tenant_id, unit_type_id, code, name, status, metadata, effective_from,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, 'HALF', '{"en":"Half"}'::jsonb, 'active', '{}'::jsonb, now(),
                     now(), 'test', now(), 'test', 1)`,
            [uuidV7(), TENANT_A, type],
          ),
        ),
      ).rejects.toThrow(/bilingual/);
    });

    it('refuses two open placement periods for one unit', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');
      const unit = await fixture.seedUnit(TENANT_A, type, 'HR');
      const open = (): UnitPlacement =>
        UnitPlacement.open(
          { tenantId: TENANT_A, unitId: unit, effectiveFrom: january },
          origin,
          now,
        );

      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.placements.insert(transaction, open().snapshot()),
      );

      // Two open periods is two answers to "where is this unit now", and the org chart would
      // show whichever the planner returned first.
      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.placements.insert(transaction, open().snapshot()),
        ),
      ).rejects.toThrow(/organization_unit_placement_one_open_key/);
    });

    it('refuses a placement period that ends before it begins', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');
      const unit = await fixture.seedUnit(TENANT_A, type, 'HR');

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.placements.insert(transaction, {
            id: uuidV7(),
            tenantId: TENANT_A,
            unitId: unit,
            effectiveFrom: june,
            effectiveTo: january,
            version: 0,
          }),
        ),
      ).rejects.toThrow(/period_check/);
    });

    it('refuses the same unit code twice in a tenant, case-insensitively', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');

      await fixture.seedUnit(TENANT_A, type, 'HR');

      // A tenant holding both `HR` and `hr` would have two units nobody can tell apart in a list.
      await expect(fixture.seedUnit(TENANT_A, type, 'hr')).rejects.toThrow(
        /organization_unit_code_key/,
      );
    });

    it("permits the same code in a different tenant, because codes are the customer's own", async () => {
      const typeA = await fixture.seedUnitType(TENANT_A, 'department');
      const typeB = await fixture.seedUnitType(TENANT_B, 'department');

      await fixture.seedUnit(TENANT_A, typeA, 'HR');
      await expect(fixture.seedUnit(TENANT_B, typeB, 'HR')).resolves.toBeTruthy();
    });

    it('refuses a legal entity whose country code is not a country code', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'legal-entity', true);
      const unit = await fixture.seedUnit(TENANT_A, type, 'CO');

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into legal_entity
               (id, tenant_id, unit_id, country_code, registered_name, registration_number,
                currency_code, status, metadata, effective_from,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, 'sa', '{"en":"X","ar":"س"}'::jsonb, '1010', 'SAR', 'active',
                     '{}'::jsonb, now(), now(), 'test', now(), 'test', 1)`,
            [uuidV7(), TENANT_A, unit],
          ),
        ),
      ).rejects.toThrow(/country_shape/);
    });

    it('refuses a second registration on one unit', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'legal-entity', true);
      const unit = await fixture.seedUnit(TENANT_A, type, 'CO');
      const register = (registration: string, country: string): Promise<unknown> =>
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into legal_entity
               (id, tenant_id, unit_id, country_code, registered_name, registration_number,
                currency_code, status, metadata, effective_from,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, $4, '{"en":"X","ar":"س"}'::jsonb, $5, 'SAR', 'active',
                     '{}'::jsonb, now(), now(), 'test', now(), 'test', 1)`,
            [uuidV7(), TENANT_A, unit, country, registration],
          ),
        );

      await register('1010', 'SA');
      // Two registrations would be two countries for one node, and every statutory figure
      // beneath it would depend on which row was read first.
      await expect(register('2020', 'JO')).rejects.toThrow(/legal_entity_unit_key/);
    });

    it('refuses an approved establishment with nobody named as the approver', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');
      const unit = await fixture.seedUnit(TENANT_A, type, 'HR');
      const position = uuidV7();

      await fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into job_position
             (id, tenant_id, code, title, criticality, status, metadata, effective_from,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'HR-MGR', '{"en":"X","ar":"س"}'::jsonb, 'standard', 'active',
                   '{}'::jsonb, now(), now(), 'test', now(), 'test', 1)`,
          [position, TENANT_A],
        ),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          transaction.execute(
            `insert into position_establishment
               (id, tenant_id, position_id, unit_id, budgeted_headcount, status, effective_from,
                created_at, created_by, updated_at, updated_by, version)
             values ($1, $2, $3, $4, 5, 'approved', now(), now(), 'test', now(), 'test', 1)`,
            [uuidV7(), TENANT_A, position, unit],
          ),
        ),
      ).rejects.toThrow(/approval_check/);
    });

    it('keeps one fact per calendar date, replacing rather than duplicating', async () => {
      const calendarId = await fixture.asTenant(TENANT_A, async (transaction) => {
        const calendar = OrganizationCalendar.define(
          {
            tenantId: TENANT_A,
            code: 'CORP',
            name: { en: 'Corporate', ar: 'المؤسسي' },
            timeZone: 'Asia/Riyadh',
            workingDays: [1, 2, 3, 4, 7],
            effectiveFrom: january,
          },
          origin,
          now,
        );

        if (!calendar.ok) throw new Error('setup');
        await fixture.stores.calendars.insert(transaction, calendar.value.snapshot());
        return calendar.value.id;
      });

      const record = (kind: 'holiday' | 'non-working'): Promise<void> =>
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.calendars.upsertDay(transaction, {
            id: uuidV7(),
            tenantId: TENANT_A,
            calendarId,
            onDate: '2027-03-20',
            kind,
            name: { en: 'Eid al-Fitr', ar: 'عيد الفطر' },
            version: 0,
          }),
        );

      await record('holiday');
      await record('non-working');

      const days = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.calendars.daysBetween(transaction, calendarId, '2027-01-01', '2027-12-31'),
      );

      // One row, replaced. Two facts about the same date is what makes a working-day count
      // ambiguous, and a leave balance that differs depending on which row was read.
      expect(days).toHaveLength(1);
      expect(days[0]?.kind).toBe('non-working');
      // The civil date, unchanged. Read back as a moment it would land a day out for anybody
      // east or west of the calendar's own zone.
      expect(days[0]?.onDate).toBe('2027-03-20');
    });

    it('refuses a stale write, so two administrators cannot silently overwrite each other', async () => {
      const type = await fixture.seedUnitType(TENANT_A, 'department');
      const unit = await fixture.seedUnit(TENANT_A, type, 'HR');
      const state = await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.units.byId(transaction, unit),
      );

      if (state === undefined) throw new Error('setup');
      await fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.units.update(transaction, { ...state, code: 'HR' }, state.version),
      );

      await expect(
        fixture.asTenant(TENANT_A, (transaction) =>
          fixture.stores.units.update(transaction, { ...state, code: 'HR' }, state.version),
        ),
      ).rejects.toThrow(ConcurrencyException);
    });
  });

  /**
   * The adapter that closes the Phase 2 debt, against the real table.
   *
   * The application-layer suite proves the *use case*; this proves the thing Workforce Identity
   * actually calls. Both tenants exist in one database here, exactly as they would in one
   * deployment — which is the configuration the old `ConfiguredTenantSettings` could not serve.
   */
  describe("a tenant reading its own settings through Identity's port", () => {
    it('gives each tenant its own defaults from one deployment and one database', async () => {
      await fixture.seedSettings(TENANT_A, RIYADH);
      await fixture.seedSettings(TENANT_B, AMMAN);

      const settings = new StoredTenantSettings(fixture.admin, DEPLOYMENT_DEFAULTS);

      expect(await settings.settingsFor(TENANT_A)).toEqual({
        language: 'ar',
        calendar: 'hijri',
        timeZone: 'Asia/Riyadh',
        numerals: 'arabic-indic',
        invitationValidityDays: 14,
        defaultPortals: ['employee'],
      });
      expect(await settings.settingsFor(TENANT_B)).toEqual({
        language: 'en',
        calendar: 'gregorian',
        timeZone: 'Asia/Amman',
        numerals: 'western',
        invitationValidityDays: 30,
        defaultPortals: ['employee', 'manager'],
      });
    });

    it("falls back to the deployment's configuration for a tenant configured with nothing", async () => {
      const settings = new StoredTenantSettings(fixture.admin, DEPLOYMENT_DEFAULTS);

      // Phase 2's behaviour exactly, for a tenant created five minutes ago. Refusing to invite
      // anybody into it until somebody visited a settings screen would be a worse product.
      expect(await settings.settingsFor(TENANT_A)).toEqual(DEPLOYMENT_DEFAULTS);
    });

    it('keeps a portal the tenant chose that the deployment default does not list', async () => {
      await fixture.seedSettings(TENANT_A, { ...RIYADH, defaultPortals: ['manager', 'admin'] });

      const settings = new StoredTenantSettings(fixture.admin, DEPLOYMENT_DEFAULTS);

      // The tenant's own choice, not an intersection with the deployment's. A tenant that opened
      // the manager portal must get the manager portal.
      expect((await settings.settingsFor(TENANT_A)).defaultPortals).toEqual(['manager', 'admin']);
    });

    it('drops a portal this product does not ship rather than handing it to a portal switch', async () => {
      await fixture.seedSettings(TENANT_A, { ...RIYADH, defaultPortals: ['employee', 'invented'] });

      const settings = new StoredTenantSettings(fixture.admin, DEPLOYMENT_DEFAULTS);

      expect((await settings.settingsFor(TENANT_A)).defaultPortals).toEqual(['employee']);
    });
  });
});
