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

import type { Asking } from './asking.js';
import { CONNECTION, requireDatabaseInCi } from './payroll-postgres.fixture.js';
import { PayrollOrganizationSource } from './payroll-period-sources.js';

/**
 * MW-072: the payroll adapter resolves a group's **legal entity** against the real Organization
 * module over real PostgreSQL, as an unprivileged role with row-level security on.
 *
 * A payroll group names a legal entity, and `organization.governing-legal-entity` walks from a
 * unit. The adapter used to hand it the entity's id as the unit id; Organization found no such
 * unit, and every calculation refused with `organization_unavailable`. The in-memory harness hid
 * it because its stub answered for whatever id it was given. Only the real module, with a legal
 * entity whose id differs from its unit's, shows the difference.
 *
 * The adapter is asked with **no** user permission at all: what it reads, it reads under its own
 * service grant (`organization.legal-entity.read`), exactly as in a calculation.
 */

requireDatabaseInCi('The payroll organization source suite');
const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const TENANT = '01930000-0000-7000-8000-0000000a7272';
const OTHER_TENANT = '01930000-0000-7000-8000-0000000a7273';
const ROLE = 'payroll_organization_source_fixture';
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

/** The Organization module over PostgreSQL, behind a dispatcher with the given checker. */
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

const inTenant = <TResult>(tenantId: string, work: () => Promise<TResult>): Promise<TResult> =>
  runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:payroll-calculator' }, work);

describeWithDatabase('the payroll organization source over PostgreSQL (MW-072)', () => {
  let admin: Pool;
  let application: Pool;
  let administrator: Dispatcher;
  let source: PayrollOrganizationSource;
  let legalEntityId = '';
  let unitId = '';

  const send = async <TResult>(tenantId: string, command: Command): Promise<TResult> => {
    const result = await inTenant(tenantId, () => administrator.send<TResult>(command));
    if (!result.ok) throw new Error(`${command.commandName}: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  /** A company unit with a registered legal entity, in `tenantId`. */
  const registerCompany = async (
    tenantId: string,
    code: string,
    countryCode: string,
    currencyCode: string,
  ): Promise<{ readonly unitId: string; readonly legalEntityId: string }> => {
    const type = await send<{ unitTypeId: string }>(tenantId, {
      commandName: 'organization.define-unit-type',
      code: `${code}-company`,
      name: { en: 'Company', ar: 'شركة' },
      ordinal: 1,
      allowedAtRoot: true,
      carriesLegalEntity: true,
    } as Command);
    const unit = await send<{ unitId: string }>(tenantId, {
      commandName: 'organization.create-unit',
      unitTypeId: type.unitTypeId,
      code,
      name: { en: 'Synthetic Company', ar: 'شركة اصطناعية' },
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    } as Command);
    const entity = await send<{ legalEntityId: string }>(tenantId, {
      commandName: 'organization.register-legal-entity',
      unitId: unit.unitId,
      countryCode,
      registeredName: { en: 'Synthetic Company LLC', ar: 'شركة اصطناعية ذ.م.م' },
      registrationNumber: `${code}-REG-0001`,
      currencyCode,
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    } as Command);
    return { unitId: unit.unitId, legalEntityId: entity.legalEntityId };
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: CONNECTION });
    application = new Pool({ connectionString: await unprivileged(admin) });
    for (const tenantId of [TENANT, OTHER_TENANT]) {
      for (const table of TABLES) {
        await admin.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
      }
    }

    administrator = organizationOver(application, ALL_ORGANIZATION_PERMISSIONS);
    // No user permission at all: the service grant is the only authority the adapter has.
    const calculator = organizationOver(application, []);
    const asking: Asking = {
      ask: <TResult>(query: Query) => calculator.ask<TResult>(query),
    };
    source = new PayrollOrganizationSource(asking);

    ({ unitId, legalEntityId } = await registerCompany(TENANT, 'SYN-CO', 'JO', 'JOD'));
  });

  afterAll(async () => {
    if (admin !== undefined) {
      for (const tenantId of [TENANT, OTHER_TENANT]) {
        for (const table of TABLES) {
          await admin.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
        }
      }
    }
    await application?.end();
    await admin?.end();
  });

  it('is set up with a legal entity whose id is not its unit id', () => {
    expect(legalEntityId).not.toBe('');
    expect(legalEntityId).not.toBe(unitId);
  });

  it("resolves a group's legal entity to its country and currency", async () => {
    const answer = await inTenant(TENANT, () => source.legalEntity(legalEntityId));

    expect(answer).toEqual({
      known: true,
      entity: { legalEntityId, countryCode: 'JO', currencyCode: 'JOD' },
    });
  });

  it('cannot resolve a legal entity Organization does not hold, and says so', async () => {
    const answer = await inTenant(TENANT, () => source.legalEntity(uuidV7()));

    expect(answer).toEqual({ known: false });
  });

  it("cannot resolve another tenant's legal entity", async () => {
    const other = await registerCompany(OTHER_TENANT, 'SYN-OTHER', 'SA', 'SAR');

    const answer = await inTenant(TENANT, () => source.legalEntity(other.legalEntityId));

    expect(answer).toEqual({ known: false });
  });
});
