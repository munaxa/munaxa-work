import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Pool } from 'pg';
import { loadEnvironment } from '@work/config';
import {
  Dispatcher,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type PermissionChecker,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import {
  PayrollConfigurationController,
  PayrollDecisionController,
  PayrollDispatcher,
  PayrollResultController,
  PayrollRunController,
  attendanceUnavailable,
  leaveUnavailable,
  noCountryRules,
  payrollModule,
  postgresPayrollStores,
  sourceAnswered,
  type CompensationFacts,
  type EmploymentFacts,
} from '@work/payroll';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * The Payroll API over **real PostgreSQL**, as an unprivileged role, with row-level security on.
 *
 * The in-memory harness cannot answer the two questions this one exists for. Its tables are not
 * tenant-scoped — in production RLS is what scopes them — so a cross-tenant assertion against it
 * would be an assertion about a `Map`. And a monetary amount above 2^53 never leaves the process
 * there, so nothing proves it survived a driver, a `bigint` column, a driver again and `JSON.
 * stringify`. Both properties are the kind that hold in a fake and fail in production.
 *
 * The role matters as much as the database. It owns nothing and holds no `BYPASSRLS`: a superuser
 * bypasses every policy, so a suite run as one would report that tenant B cannot read tenant A's
 * net pay without having checked.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

/** A suite that quietly skips itself where merges are gated reports a property nobody checked. */
export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

export const TENANT_A = '01930000-0000-7000-8000-0000000a1111';
export const TENANT_B = '01930000-0000-7000-8000-0000000a2222';
export const APPROVER = 'user:payroll-approver';
export const REQUESTER = 'user:payroll-administrator';

/** 9,007,199,254,740,993 fils — one past the largest integer a double can hold. */
export const ENORMOUS = '9007199254740993';

const PAYROLL_TABLES = [
  'payroll_payment_instruction',
  'payroll_accounting_line',
  'payroll_reconciliation',
  'payroll_approval_decision',
  'payroll_adjustment',
  'payroll_exception',
  'payroll_deduction_line',
  'payroll_earning_line',
  'payroll_result',
  'payroll_input_snapshot',
  'payroll_run',
  'payroll_period',
  'payroll_deduction_definition',
  'payroll_group',
];

/** People's and Employment's tables: read, written, and never truncated by this suite. */
const FOREIGN_TABLES = ['person', 'employment'];

const AUDIT = `now(), 'test', now(), 'test', 1`;
const ROLE = 'payroll_api_fixture';

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const unprivileged = async (admin: Pool): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on ${[...PAYROLL_TABLES, ...FOREIGN_TABLES].join(', ')} to ${ROLE}`,
  );

  const url = new URL(CONNECTION ?? '');

  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
};

export interface PostgresApiFixture {
  /** An application bound to one tenant, one actor and one permission set. */
  applicationFor(
    tenantId: string,
    checker: PermissionChecker,
    actor?: string,
  ): Promise<INestApplication>;
  seedEmployment(tenantId: string): Promise<string>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

const seedEmploymentWith = async (admin: Pool, tenantId: string): Promise<string> => {
  const personId = uuidV7();
  const employmentId = uuidV7();

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
    [personId, tenantId, `API-${personId.slice(-12)}`],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, $4, 'active', 'permanent', '2020-01-01'::date, '2020-01-01'::date,
             '{}'::jsonb, ${AUDIT})`,
    [employmentId, tenantId, personId, `API-${employmentId.slice(-12)}`],
  );
  return employmentId;
};

const factsFor = (employmentId: string): EmploymentFacts => ({
  employmentId,
  status: 'active',
  startDate: '2020-01-01',
  employmentTypeCode: 'full-time',
  version: 1,
});

const compensationFor = (): CompensationFacts => ({
  currencies: [
    {
      currencyCode: 'JOD',
      currencyExponent: 3,
      recurring: [
        {
          componentId: uuidV7(),
          componentCode: 'salary',
          kind: 'base',
          payrollTreatmentCode: 'ordinary',
          proratable: true,
          amount: { amountMinor: BigInt(ENORMOUS), currencyCode: 'JOD', currencyExponent: 3 },
          effectiveFrom: '2020-01-01',
          partialPeriod: false,
        },
      ],
      oneTime: [],
    },
  ],
  inputsDigest: 'aaaa0001',
  calculationVersion: 1,
});

/** The Payroll module wired to real repositories, over a population this fixture controls. */
const moduleFor = (
  application: Pool,
  owned: () => readonly string[],
  checker: PermissionChecker,
): Dispatcher => {
  const dispatcher = new Dispatcher(checker);
  const module = payrollModule({
    unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    stores: postgresPayrollStores(),
    employment: {
      employmentIds: (_legalEntityId, after, limit) => {
        const all = [...owned()].sort();
        const from = after === undefined ? 0 : all.indexOf(after) + 1;

        return Promise.resolve(all.slice(from, from + limit));
      },
      factsFor: (ids) =>
        Promise.resolve(sourceAnswered(new Map(ids.map((id) => [id, factsFor(id)])))),
    },
    compensation: {
      factsFor: (ids) =>
        Promise.resolve(sourceAnswered(new Map(ids.map((id) => [id, compensationFor()])))),
      changedSince: () => Promise.resolve([]),
    },
    attendance: attendanceUnavailable,
    leave: leaveUnavailable,
    organization: {
      legalEntity: (legalEntityId) =>
        Promise.resolve({
          known: true,
          entity: { legalEntityId, countryCode: 'JO', currencyCode: 'JOD' },
        }),
    },
    countryRules: noCountryRules,
    clock: { now: () => new Date('2026-07-01T09:00:00Z') },
  });

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

/** The real controllers, the real filter and the real validation pipe, bound to one tenant. */
const nestFor = async (
  dispatcher: Dispatcher,
  tenantId: string,
  actor: string,
): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: [
      PayrollConfigurationController,
      PayrollResultController,
      PayrollDecisionController,
      PayrollRunController,
    ],
    providers: [
      { provide: PayrollDispatcher, useValue: new PayrollDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();
  const nest = testing.createNestApplication();

  nest.use(
    (
      incoming: { readonly headers: Record<string, string | undefined> },
      _response: unknown,
      next: () => void,
    ) => {
      runInContext(
        { tenantId, correlationId: uuidV7(), actor: incoming.headers['x-test-actor'] ?? actor },
        next,
      );
    },
  );
  configureApplication(nest, environment);
  await nest.init();
  return nest;
};

export const openPostgresApi = async (): Promise<PostgresApiFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, max: 4 });
  const application = new Pool({
    connectionString: await unprivileged(admin),
    max: 6,
    connectionTimeoutMillis: 15_000,
  });
  // Which employments each tenant owns, so the population source answers per tenant exactly as
  // Employment's published search would — never a join across a module boundary.
  const population = new Map<string, string[]>();

  return {
    seedEmployment: async (tenantId) => {
      const employmentId = await seedEmploymentWith(admin, tenantId);

      population.set(tenantId, [...(population.get(tenantId) ?? []), employmentId]);
      return employmentId;
    },

    applicationFor: (tenantId, checker, actor = REQUESTER) =>
      nestFor(
        moduleFor(application, () => population.get(tenantId) ?? [], checker),
        tenantId,
        actor,
      ),

    truncate: async () => {
      await admin.query(`truncate ${PAYROLL_TABLES.join(', ')} cascade`);
      // The employment rows survive — they are Employment's, not this suite's — but the population
      // each tenant is calculated over is rebuilt per test, or a run would silently cover everybody
      // seeded by every test before it.
      population.clear();
    },

    close: async () => {
      await application.end();
      await admin.end();
    },
  };
};

export const httpOf = (application: INestApplication): Server =>
  application.getHttpServer() as Server;
