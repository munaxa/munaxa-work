import {
  Dispatcher,
  GrantAwarePermissionChecker,
  InProcessEventDispatcher,
  runInContext,
  uuidV7,
  type Command,
  type Query,
} from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import {
  ALL_ORGANIZATION_PERMISSIONS,
  NoAssignmentsYet,
  organizationModule,
  postgresOrganizationStores,
} from '@work/organization';
import { permitting } from '@work/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Asking } from '../payroll/asking.js';
import { CONNECTION, requireDatabaseInCi } from '../payroll/payroll-postgres.fixture.js';

import { PerformanceOrganization } from './performance-sources.js';

/**
 * MW-074: the Performance adapter reads the governing legal entity from the real Organization
 * module over real PostgreSQL, as an unprivileged role with row-level security on.
 *
 * `organization.governing-legal-entity` answers `{ unitId, asOf, legalEntity, throughUnitIds }`.
 * The adapter read a `legalEntityId` field the answer does not have, so every completed review's
 * snapshot recorded no legal entity. The phase-thirteen stub answered `{ legalEntityId }`, the shape
 * the adapter expected rather than the one Organization publishes, which is what hid it.
 *
 * The adapter is asked with **no** user permission: it reads under its own service grant
 * (`organization.legal-entity.read`) and nothing wider.
 */

requireDatabaseInCi('The performance organization source suite');
const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const TENANT = '01930000-0000-7000-8000-0000000a7474';
const ROLE = 'performance_organization_source_fixture';
const TABLES = [
  'organization_calendar_day',
  'organization_calendar',
  'position_establishment',
  'job_position',
  'financial_center',
  'legal_entity',
  'organization_unit_placement',
  'organization_unit',
  'organization_unit_type',
];
const FROM = new Date('2026-01-01T00:00:00Z');

const unprivileged = async (admin: Pool): Promise<string> => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(`grant select, insert, update, delete on ${TABLES.join(', ')} to ${ROLE}`);
  const url = new URL(CONNECTION ?? '');
  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
};

/** The Organization module over PostgreSQL, behind a dispatcher holding `granted`. */
const organizationOver = (application: Pool, granted: readonly string[]): Dispatcher => {
  const dispatcher = new Dispatcher(new GrantAwarePermissionChecker(permitting(...granted)));
  const module = organizationModule(
    {
      unitOfWork: new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
      stores: postgresOrganizationStores(),
      filled: new NoAssignmentsYet(),
      clock: { now: () => new Date('2026-08-06T09:00:00Z') },
    },
    { send: (command) => dispatcher.send(command) },
  );
  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

const inTenant = <TResult>(work: () => Promise<TResult>): Promise<TResult> =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:reviewer' }, work);

const clear = async (admin: Pool): Promise<void> => {
  for (const table of TABLES) {
    await admin.query(`delete from ${table} where tenant_id = $1`, [TENANT]);
  }
};

describeWithDatabase('the performance organization source over PostgreSQL (MW-074)', () => {
  let admin: Pool;
  let application: Pool;
  let administrator: Dispatcher;
  let organization: PerformanceOrganization;
  let companyUnitId = '';
  let legalEntityId = '';
  let unregisteredUnitId = '';

  const send = async <TResult>(command: Command): Promise<TResult> => {
    const result = await inTenant(() => administrator.send<TResult>(command));
    if (!result.ok) throw new Error(`${command.commandName}: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  const unitOf = async (unitTypeId: string, code: string): Promise<string> =>
    (
      await send<{ unitId: string }>({
        commandName: 'organization.create-unit',
        unitTypeId,
        code,
        name: { en: code, ar: code },
        effectiveFrom: FROM,
      } as Command)
    ).unitId;

  beforeAll(async () => {
    admin = new Pool({ connectionString: CONNECTION });
    application = new Pool({ connectionString: await unprivileged(admin) });
    await clear(admin);

    administrator = organizationOver(application, ALL_ORGANIZATION_PERMISSIONS);
    // No user permission at all: the service grant is the only authority the adapter has.
    const reviewer = organizationOver(application, []);
    const asking: Asking = { ask: <TResult>(query: Query) => reviewer.ask<TResult>(query) };
    organization = new PerformanceOrganization(asking);

    const company = await send<{ unitTypeId: string }>({
      commandName: 'organization.define-unit-type',
      code: 'syn-company',
      name: { en: 'Company', ar: 'شركة' },
      ordinal: 1,
      allowedAtRoot: true,
      carriesLegalEntity: true,
    } as Command);
    companyUnitId = await unitOf(company.unitTypeId, 'SYN-CO');
    unregisteredUnitId = await unitOf(company.unitTypeId, 'SYN-UNREGISTERED');
    legalEntityId = (
      await send<{ legalEntityId: string }>({
        commandName: 'organization.register-legal-entity',
        unitId: companyUnitId,
        countryCode: 'JO',
        registeredName: { en: 'Synthetic Company LLC', ar: 'شركة اصطناعية ذ.م.م' },
        registrationNumber: 'SYN-REG-0001',
        currencyCode: 'JOD',
        effectiveFrom: FROM,
      } as Command)
    ).legalEntityId;
  });

  afterAll(async () => {
    if (admin !== undefined) await clear(admin);
    await application?.end();
    await admin?.end();
  });

  it("answers the legal entity's id for a unit that carries one", async () => {
    const answer = await inTenant(() => organization.governingLegalEntityOf(companyUnitId));

    expect(legalEntityId).not.toBe(companyUnitId);
    expect(answer).toBe(legalEntityId);
  });

  it('answers nothing for a unit no legal entity governs', async () => {
    const answer = await inTenant(() => organization.governingLegalEntityOf(unregisteredUnitId));

    expect(answer).toBeUndefined();
  });

  it('answers nothing for a unit Organization does not hold', async () => {
    const answer = await inTenant(() => organization.governingLegalEntityOf(uuidV7()));

    expect(answer).toBeUndefined();
  });
});
