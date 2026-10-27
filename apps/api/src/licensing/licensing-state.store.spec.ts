import { Pool } from 'pg';
import type { EntitlementSnapshot } from '@munaxa/licensing';
import { InProcessEventDispatcher, runInContext, uuidV7 } from '@work/kernel';
import { PostgresUnitOfWork } from '@work/persistence';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CONNECTION, requireDatabaseInCi } from './licensing-state.fixture.js';
import { PostgresLicensingStateStore } from './licensing-state.store.js';

/**
 * `licensing_state` against the real table, as a role that cannot bypass row-level security — the
 * only configuration in which "a tenant reads only its own state" means anything (ADR-0030).
 */
requireDatabaseInCi('licensing_state');
const ROLE = 'licensing_state_app';

const TENANT_A = uuidV7();
const TENANT_B = uuidV7();
const snapshotFor = (tenantId: string): EntitlementSnapshot => ({
  schemaVersion: 1,
  customerId: 'cus_1',
  tenantId,
  product: 'work',
  deployment: 'SAAS',
  subscriptionId: 'sub_1',
  plan: { code: 'business', version: 1 },
  status: 'ACTIVE',
  trialEndsAt: null,
  expiresAt: null,
  graceUntil: null,
  features: ['payroll'],
  limits: { employees: 25 },
  resolvedAt: '2026-10-27T09:00:00.000Z',
});

describe.skipIf(CONNECTION === undefined)('licensing_state', () => {
  let admin: Pool;
  let application: Pool;
  let store: PostgresLicensingStateStore;
  const as = <T>(tenantId: string, work: () => Promise<T>) =>
    runInContext({ tenantId, correlationId: uuidV7(), actor: 'system:test' }, work);

  beforeAll(async () => {
    admin = new Pool({ connectionString: CONNECTION, max: 2 });
    await admin.query(
      `do $$ begin
         if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
           create role ${ROLE} login nosuperuser nobypassrls password 'fixture';
         end if;
       end $$`,
    );
    await admin.query(`grant select, insert, update on licensing_state to ${ROLE}`);
    const url = new URL(CONNECTION ?? '');
    url.username = ROLE;
    url.password = 'fixture';
    application = new Pool({ connectionString: url.toString(), max: 2 });
    store = new PostgresLicensingStateStore(
      new PostgresUnitOfWork(application, new InProcessEventDispatcher()),
    );
  });

  afterAll(async () => {
    await admin.query('delete from licensing_state where tenant_id = any($1::uuid[])', [
      [TENANT_A, TENANT_B],
    ]);
    await application.end();
    await admin.end();
  });

  it('keeps the last snapshot, and moves the observed instant forward only', async () => {
    await as(TENANT_A, () =>
      store.write(TENANT_A, {
        snapshot: snapshotFor(TENANT_A),
        source: 'CONTROL_PLANE',
        observedAt: new Date('2026-10-27T10:00:00Z'),
      }),
    );
    await as(TENANT_A, () =>
      store.write(TENANT_A, {
        snapshot: null,
        source: 'CONTROL_PLANE',
        observedAt: new Date('2026-10-01T00:00:00Z'),
      }),
    );
    const stored = await as(TENANT_A, () => store.read(TENANT_A));
    expect(stored?.snapshot).toBeNull();
    expect(stored?.lastObservedAt.toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });

  it("never reads or writes another tenant's state", async () => {
    await as(TENANT_B, () =>
      store.write(TENANT_B, {
        snapshot: snapshotFor(TENANT_B),
        source: 'CONTROL_PLANE',
        observedAt: new Date('2026-10-27T10:00:00Z'),
      }),
    );
    // Asked in tenant A's context about tenant B: nothing, and nothing written.
    expect(await as(TENANT_A, () => store.read(TENANT_B))).toBeNull();
    await as(TENANT_A, () =>
      store.write(TENANT_B, {
        snapshot: null,
        source: 'CONTROL_PLANE',
        observedAt: new Date('2027-01-01T00:00:00Z'),
      }),
    );
    // And the database refuses the reach even when the application asks directly.
    const leaked = await as(TENANT_A, () =>
      new PostgresUnitOfWork(application, new InProcessEventDispatcher()).execute((transaction) =>
        transaction.execute('select tenant_id from licensing_state where tenant_id = $1', [
          TENANT_B,
        ]),
      ),
    );
    expect(leaked).toEqual([]);
    const own = await as(TENANT_B, () => store.read(TENANT_B));
    expect(own?.snapshot?.tenantId).toBe(TENANT_B);
    expect(own?.lastObservedAt.toISOString()).toBe('2026-10-27T10:00:00.000Z');
  });
});
