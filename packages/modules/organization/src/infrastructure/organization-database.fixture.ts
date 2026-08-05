import { Pool } from 'pg';
import {
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Transaction,
  type UnitOfWork,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';

import { postgresOrganizationStores } from './organization-stores.js';

/**
 * The database fixture the module's integration suites share.
 *
 * They run against a real PostgreSQL because what they check belongs to the database: row-level
 * security, the unique indexes that keep one open placement per unit, the check constraints that
 * refuse a half-named unit, and the upsert that keeps one fact per calendar date. A mock would
 * only prove the mock behaves as instructed.
 *
 * Two connections, deliberately. `admin` seeds and inspects, as a migration would. `application`
 * connects as a role that owns nothing and cannot bypass row-level security — the only
 * configuration under which any isolation assertion means anything.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/**
 * A suite that quietly skips itself on the machine that gates merges reports success for a
 * property nobody checked. So it skips for a developer without a database, and never in CI.
 */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01920000-0000-7000-8000-00000000cccc';
export const TENANT_B = '01920000-0000-7000-8000-00000000dddd';

/** The tables this module owns, most dependent first, for truncation between tests. */
export const ORGANIZATION_TABLES = [
  'organization_calendar_day',
  'organization_calendar',
  'position_establishment',
  'job_position',
  'financial_center',
  'legal_entity',
  'organization_unit_placement',
  'organization_unit',
  'organization_unit_type',
  'tenant_settings',
];

export interface OrganizationFixture {
  readonly admin: Pool;
  readonly application: Pool;
  readonly unitOfWork: UnitOfWork;
  readonly stores: ReturnType<typeof postgresOrganizationStores>;
  asTenant<TResult>(
    tenantId: string,
    work: (transaction: Transaction) => Promise<TResult>,
  ): Promise<TResult>;
  seedUnitType(tenantId: string, code: string, carriesLegalEntity?: boolean): Promise<string>;
  seedUnit(tenantId: string, unitTypeId: string, code: string): Promise<string>;
  seedSettings(tenantId: string, settings: SeededSettings): Promise<void>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

export interface SeededSettings {
  readonly language: string;
  readonly calendar: string;
  readonly timeZone: string;
  readonly numerals: string;
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly string[];
}

/**
 * Fails with the cause rather than a symptom.
 *
 * Phase 2 learned this the expensive way: a database that has not been migrated otherwise
 * produces `relation "..." does not exist` from whichever statement touched it first, which
 * sends the reader to the fixture rather than to the missing migration step.
 */
const assertSchemaApplied = async (admin: Pool): Promise<void> => {
  const present = await admin.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])`,
    [ORGANIZATION_TABLES],
  );
  const missing = ORGANIZATION_TABLES.filter(
    (table) => !present.rows.some((row) => row.table_name === table),
  );

  if (missing.length > 0) {
    throw new Error(
      `Organization's tables are not in this database: ${missing.join(', ')}. ` +
        'These suites exercise the real schema — its policies, indexes and check constraints — ' +
        'so run `pnpm db:migrate` against TEST_DATABASE_URL first.',
    );
  }
};

/**
 * Creates the unprivileged role the suite connects as, and grants it the module's tables.
 *
 * It owns nothing and holds no `BYPASSRLS`, which is the only configuration under which an
 * isolation assertion means anything: a superuser bypasses every policy, so a suite run as one
 * would pass whether or not isolation worked.
 */
const ensureApplicationRole = async (admin: Pool, role: string): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${role}') then
         create role ${role} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on ${ORGANIZATION_TABLES.join(', ')} to ${role}`,
  );

  const url = new URL(CONNECTION ?? '');
  url.username = role;
  url.password = 'fixture';
  return url.toString();
};

const AUDIT = `now(), 'test', now(), 'test', 1`;

/**
 * The seeders, written as free functions taking the pool.
 *
 * They sit outside `openOrganizationFixture` so that function stays within the size budget —
 * and so a reader looking for what a seeded unit actually contains finds it without scrolling
 * through connection setup.
 */
const seedUnitTypeWith = async (
  admin: Pool,
  tenantId: string,
  code: string,
  carriesLegalEntity = false,
): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into organization_unit_type
       (id, tenant_id, code, name, ordinal, allowed_parent_codes, allowed_at_root,
        carries_legal_entity, status, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4::jsonb, 10, '{}', true, $5, 'active', ${AUDIT})`,
    [id, tenantId, code, JSON.stringify({ en: code, ar: code }), carriesLegalEntity],
  );
  return id;
};

const seedUnitWith = async (
  admin: Pool,
  tenantId: string,
  unitTypeId: string,
  code: string,
): Promise<string> => {
  const id = uuidV7();

  await admin.query(
    `insert into organization_unit
       (id, tenant_id, unit_type_id, code, name, status, metadata, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, $5::jsonb, 'active', '{}'::jsonb, now(), ${AUDIT})`,
    [id, tenantId, unitTypeId, code, JSON.stringify({ en: code, ar: code })],
  );
  return id;
};

const seedSettingsWith = async (
  admin: Pool,
  tenantId: string,
  settings: SeededSettings,
): Promise<void> => {
  await admin.query(
    `insert into tenant_settings
       (id, tenant_id, language, calendar, time_zone, numerals, invitation_validity_days,
        default_portals, created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, ${AUDIT})`,
    [
      uuidV7(),
      tenantId,
      settings.language,
      settings.calendar,
      settings.timeZone,
      settings.numerals,
      settings.invitationValidityDays,
      [...settings.defaultPortals],
    ],
  );
};

export const openOrganizationFixture = async (role: string): Promise<OrganizationFixture> => {
  const admin = new Pool({ connectionString: CONNECTION });

  await assertSchemaApplied(admin);

  const application = new Pool({ connectionString: await ensureApplicationRole(admin, role) });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresOrganizationStores();

  return {
    admin,
    application,
    unitOfWork,
    stores,
    // Through the real Unit of Work, so `app.tenant_id` is genuinely set on the transaction.
    asTenant: (tenantId, work) =>
      runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:test' }, () =>
        unitOfWork.execute(work),
      ),
    seedUnitType: (tenantId, code, carriesLegalEntity) =>
      seedUnitTypeWith(admin, tenantId, code, carriesLegalEntity),
    seedUnit: (tenantId, unitTypeId, code) => seedUnitWith(admin, tenantId, unitTypeId, code),
    seedSettings: (tenantId, settings) => seedSettingsWith(admin, tenantId, settings),
    truncate: async () => {
      await admin.query(`truncate ${ORGANIZATION_TABLES.join(', ')} cascade`);
    },
    close: async () => {
      await application.end();
      await admin.query(`truncate ${ORGANIZATION_TABLES.join(', ')} cascade`);
      await admin.end();
    },
  };
};
