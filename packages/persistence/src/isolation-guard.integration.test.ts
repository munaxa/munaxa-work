import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  IsolationNotEnforcedError,
  assertIsolationEnforced,
  readIsolationDiagnostics,
} from './isolation-guard.js';
import { checkDatabase } from './database-health.js';

/**
 * The guard is the control that stops a connection-string mistake from silently disabling every
 * tenant policy, so it is tested against both configurations it must distinguish: a privileged
 * connection it has to refuse, and an unprivileged one it has to accept.
 */

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined && process.env.CI !== undefined) {
  throw new Error('Isolation guard tests require a database. Set TEST_DATABASE_URL.');
}

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

describeWithDatabase('isolation guard', () => {
  let admin: Pool;
  let application: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: CONNECTION });
    await admin.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'work_guard_test') then
          create role work_guard_test login nosuperuser password 'guard';
        end if;
      end $$`);

    const url = new URL(CONNECTION ?? '');
    url.username = 'work_guard_test';
    url.password = 'guard';
    application = new Pool({ connectionString: url.toString() });
  });

  afterAll(async () => {
    await application?.end();
    await admin?.end();
  });

  it('refuses a connection that can bypass row-level security', async () => {
    await expect(assertIsolationEnforced(admin)).rejects.toThrow(IsolationNotEnforcedError);
  });

  it('names the role and the reason, so the misconfiguration is actionable', async () => {
    await expect(assertIsolationEnforced(admin)).rejects.toThrow(/superuser/);
  });

  it('accepts an unprivileged application role', async () => {
    const diagnostics = await assertIsolationEnforced(application);

    expect(diagnostics.role).toBe('work_guard_test');
    expect(diagnostics.canBypassRowLevelSecurity).toBe(false);
  });

  it('reports whether the policy function is installed at all', async () => {
    const diagnostics = await readIsolationDiagnostics(application);

    expect(diagnostics.policyFunctionInstalled).toBe(true);
  });
});

describeWithDatabase('checkDatabase', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: CONNECTION });
  });

  afterAll(async () => {
    await pool.end();
  });

  it('answers with a round trip, not with the pool is opinion of itself', async () => {
    const health = await checkDatabase(pool);

    expect(health.status).toBe('up');
    expect(health.latencyMilliseconds).toBeGreaterThanOrEqual(0);
  });

  it('reports down without leaking the connection detail', async () => {
    const unreachable = new Pool({
      connectionString: 'postgresql://nobody:nobody@127.0.0.1:1/none',
      connectionTimeoutMillis: 300,
    });

    const health = await checkDatabase(unreachable);

    expect(health.status).toBe('down');
    expect(JSON.stringify(health)).not.toContain('nobody');
    await unreachable.end().catch(() => undefined);
  });
});
