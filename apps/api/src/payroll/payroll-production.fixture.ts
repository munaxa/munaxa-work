import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Pool } from 'pg';
import { loadEnvironment } from '@work/config';
import { InProcessEventDispatcher, uuidV7 } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { postgresEmploymentStores } from '@work/employment';
import { postgresCompensationStores } from '@work/compensation';
import {
  PayrollConfigurationController,
  PayrollDecisionController,
  PayrollDispatcher,
  PayrollResultController,
  PayrollRunController,
  postgresPayrollStores,
} from '@work/payroll';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';
import { TENANT, wire, type Wired } from './cross-module-harness.js';

/**
 * The composition for the **final production scenario**: everything real at once.
 *
 * Each existing suite holds one variable fixed. The cross-module suite runs the real Employment and
 * Compensation modules through the real dispatcher, but over in-memory stores. The PostgreSQL API
 * suite runs the real repositories and the real HTTP edge, but answers Employment and Compensation
 * from stubs. Neither, on its own, proves the whole chain — and a chain is exactly what a payroll
 * is: an employment, a salary, attendance, leave, a population, a snapshot, a calculation, results,
 * reconciliation, approval, finalization, outputs, immutable history, reversal.
 *
 * This one holds nothing fixed. Real PostgreSQL, real repositories for all three modules, the real
 * production cross-module adapters, the real dispatcher, real permission checks, and the real API
 * for every payroll step. Attendance, Leave and Organization remain query handlers answering in
 * their published views' shapes, because their modules are not in this composition and registering
 * them would drag in schedules and ledgers this scenario is not about — the adapters under test map
 * real contract payloads either way.
 *
 * The role owns nothing and holds no `BYPASSRLS`, so every statement passes through the same
 * row-level security a request does.
 */

export const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const requireDatabaseInCi = (suite: string): void => {
  if (CONNECTION === undefined && process.env.CI !== undefined) {
    throw new Error(`${suite} requires a database. Set TEST_DATABASE_URL. Refusing to skip in CI.`);
  }
};

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

const COMPENSATION_TABLES = [
  'compensation_change',
  'compensation_approval_decision',
  'compensation_adjustment',
  'compensation_one_time',
  'compensation_recurring',
  'compensation_import_batch',
  'compensation_plan_component',
  'compensation_plan_assignment',
  'compensation_salary_step',
  'compensation_pay_scale',
  'compensation_pay_grade',
  'compensation_salary_structure',
  'compensation_component',
  'compensation_plan',
];

const EMPLOYMENT_TABLES = [
  'employment_reporting_line',
  'employment_link',
  'employment_assignment',
  'employment_contract',
  'employment_status_record',
  'employment_number_sequence',
  'employment',
];

const ALL_TABLES = [...PAYROLL_TABLES, ...COMPENSATION_TABLES, ...EMPLOYMENT_TABLES, 'person'];
const ROLE = 'payroll_production_fixture';
const AUDIT = `now(), 'test', now(), 'test', 1`;

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
  await admin.query(`grant select, insert, update, delete on ${ALL_TABLES.join(', ')} to ${ROLE}`);
  await admin.query(`grant usage, select on all sequences in schema public to ${ROLE}`);

  const url = new URL(CONNECTION ?? '');

  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
};

export interface ProductionFixture {
  readonly wired: Wired;
  readonly http: Server;
  /** Seeds the `person` row the employment's foreign key requires, and returns its identifier. */
  seedPerson(): Promise<string>;
  truncate(): Promise<void>;
  close(): Promise<void>;
}

/** The real controllers over the **same** dispatcher the three modules registered on. */
const nestOver = async (wired: Wired): Promise<INestApplication> => {
  const testing = await Test.createTestingModule({
    controllers: [
      PayrollConfigurationController,
      PayrollResultController,
      PayrollDecisionController,
      PayrollRunController,
    ],
    providers: [
      // The API is a second entrance to one composition, not a second composition.
      { provide: PayrollDispatcher, useValue: new PayrollDispatcher(wired.dispatcher) },
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
      void wired.as(incoming.headers['x-test-actor'] ?? 'user:payroll-administrator', () => {
        next();
        return Promise.resolve();
      });
    },
  );
  configureApplication(nest, environment);
  await nest.init();
  return nest;
};

export const openProduction = async (): Promise<ProductionFixture> => {
  const admin = new Pool({ connectionString: CONNECTION, max: 4 });
  const application = new Pool({
    connectionString: await unprivileged(admin),
    max: 8,
    connectionTimeoutMillis: 15_000,
  });
  const wired = wire({
    unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    employment: postgresEmploymentStores(),
    compensation: postgresCompensationStores(),
    payroll: postgresPayrollStores(),
  });
  const nest = await nestOver(wired);

  return {
    wired,
    http: nest.getHttpServer() as Server,

    seedPerson: async () => {
      const personId = uuidV7();

      await admin.query(
        `insert into person
           (id, tenant_id, person_number, status, metadata,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})`,
        [personId, TENANT, `PROD-${personId.slice(-12)}`],
      );
      return personId;
    },

    truncate: async () => {
      await admin.query(`truncate ${ALL_TABLES.join(', ')} cascade`);
    },

    close: async () => {
      await nest.close();
      await application.end();
      await admin.end();
    },
  };
};
