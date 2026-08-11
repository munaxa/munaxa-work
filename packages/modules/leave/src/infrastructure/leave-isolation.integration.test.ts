import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  LEAVE_TABLES,
  TENANT_A,
  TENANT_B,
  openLeaveFixture,
  requireDatabaseInCi,
  type LeaveFixture,
} from './leave-database.fixture.js';
import { aBalance, aDay, aRequest, anEntry, configuredTenant } from './leave-fixtures.js';

/**
 * Tenant isolation, as an **unprivileged role that owns nothing and holds no `BYPASSRLS`**.
 *
 * The role matters more than the assertions. A superuser bypasses every policy, so a suite run as
 * one would pass whether or not isolation worked — which is the failure mode this file exists to
 * avoid, not merely to test.
 *
 * Four of these are specifically dangerous and are here because of it:
 *
 * - **the bulk mark** writes by predicate rather than by identity, so a missing tenant clause fails
 *   *silently* across tenants rather than loudly. Phase 8 found this the most valuable assertion it
 *   had;
 * - **the ledger sum** is an aggregate, and a cross-tenant leak in an aggregate is invisible: the
 *   balance is simply wrong by an amount nobody can trace;
 * - **the coverage read** is the query Attendance calls, and a leak there puts one tenant's leave on
 *   another tenant's attendance record;
 * - **the overlap constraint** must not refuse one tenant's leave because another tenant has leave
 *   on the same date for a different person.
 */

const describeIfDatabase = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Leave isolation');

describeIfDatabase('Leave, isolated by tenant', () => {
  let fixture: LeaveFixture;
  let employmentA: string;
  let employmentB: string;
  let configuredA: { readonly leaveTypeId: string; readonly leavePolicyId: string };
  let configuredB: { readonly leaveTypeId: string; readonly leavePolicyId: string };

  beforeAll(async () => {
    fixture = await openLeaveFixture('leave_isolation_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    employmentA = await fixture.seedEmployment(TENANT_A);
    employmentB = await fixture.seedEmployment(TENANT_B);
    configuredA = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );
    configuredB = await fixture.asTenant(TENANT_B, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_B),
    );
  });

  /** Every table carries the policy. One assertion, so a fifteenth table cannot arrive unprotected. */
  it('protects every one of the fourteen tables with row-level security', async () => {
    const rows = await fixture.admin.query<{ tablename: string; rowsecurity: boolean }>(
      `select tablename, rowsecurity from pg_tables
        where schemaname = 'public' and tablename = any($1::text[])`,
      [LEAVE_TABLES],
    );

    expect(rows.rows).toHaveLength(LEAVE_TABLES.length);
    expect(rows.rows.filter((row) => !row.rowsecurity)).toEqual([]);
  });

  it('hides another tenant’s leave type, policy and assignment', async () => {
    const types = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.types.all(transaction),
    );
    const policies = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.policies.all(transaction),
    );

    expect(types.map((one) => one.id)).not.toContain(configuredB.leaveTypeId);
    expect(policies.map((one) => one.id)).not.toContain(configuredB.leavePolicyId);

    const foreign = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.policies.byId(transaction, configuredB.leavePolicyId),
    );

    expect(foreign).toBeUndefined();
  });

  /**
   * The aggregate case. A leak here is invisible: the figure is just wrong.
   */
  it('sums only this tenant’s ledger', async () => {
    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.ledger.insert(
        transaction,
        anEntry(TENANT_A, employmentA, configuredA.leaveTypeId, { minutes: 9600 }),
      );
    });
    await fixture.asTenant(TENANT_B, async (transaction) => {
      await fixture.stores.ledger.insert(
        transaction,
        anEntry(TENANT_B, employmentB, configuredB.leaveTypeId, { minutes: 4800 }),
      );
    });

    const mine = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.ledger.search(transaction, { limit: 100, offset: 0 }),
    );

    expect(mine.total).toBe(1);
    expect(mine.items.reduce((sum, one) => sum + one.minutes, 0)).toBe(9600);
  });

  /**
   * The bulk mark, which writes by predicate.
   *
   * The one Phase 8 found most valuable: a statement that lost its tenant clause would mark every
   * tenant's balances and nothing would fail.
   */
  it('marks only this tenant’s balances stale', async () => {
    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.balances.insert(
        transaction,
        aBalance(TENANT_A, employmentA, configuredA.leaveTypeId),
      );
    });
    await fixture.asTenant(TENANT_B, async (transaction) => {
      await fixture.stores.balances.insert(
        transaction,
        aBalance(TENANT_B, employmentB, configuredB.leaveTypeId),
      );
    });

    const marked = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.balances.markStale(transaction, {}, new Date()),
    );

    expect(marked).toBe(1);

    const theirs = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.balances.forEmployment(transaction, employmentB),
    );

    expect(theirs).toHaveLength(1);
  });

  /**
   * The read Attendance calls.
   *
   * A leak here puts one tenant's approved leave onto another tenant's attendance record — which is
   * a statement about a person, made from data nobody in that tenant can see.
   */
  it('answers the Attendance coverage read within one tenant only', async () => {
    const theirs = aRequest(
      TENANT_B,
      employmentB,
      configuredB.leaveTypeId,
      configuredB.leavePolicyId,
    );

    await fixture.asTenant(TENANT_B, async (transaction) => {
      await fixture.stores.requests.insert(transaction, theirs);
      await fixture.stores.requestDays.insert(transaction, aDay(theirs));
    });

    const asA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requestDays.covering(transaction, {
        employmentId: employmentB,
        from: '2026-06-15',
        to: '2026-06-15',
      }),
    );

    expect(asA).toHaveLength(0);

    const asB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.requestDays.covering(transaction, {
        employmentId: employmentB,
        from: '2026-06-15',
        to: '2026-06-15',
      }),
    );

    expect(asB).toHaveLength(1);
  });

  /**
   * The exclusion constraint is tenant-scoped too.
   *
   * `tenant_id with =` is the first term of it, so one tenant's leave on the fifteenth does not
   * refuse another tenant's — which would be a cross-tenant denial of service that looks like a
   * business rule.
   */
  it('does not let one tenant’s leave block another’s on the same date', async () => {
    const theirs = aRequest(
      TENANT_B,
      employmentB,
      configuredB.leaveTypeId,
      configuredB.leavePolicyId,
    );
    const mine = aRequest(
      TENANT_A,
      employmentA,
      configuredA.leaveTypeId,
      configuredA.leavePolicyId,
    );

    await fixture.asTenant(TENANT_B, async (transaction) => {
      await fixture.stores.requests.insert(transaction, theirs);
      await fixture.stores.requestDays.insert(transaction, aDay(theirs));
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, mine);
      await fixture.stores.requestDays.insert(transaction, aDay(mine));
    });

    const days = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requestDays.forRequest(transaction, mine.id),
    );

    expect(days).toHaveLength(1);
  });

  /**
   * A foreign key does **not** enforce the tenant, and this test records that rather than
   * pretending otherwise.
   *
   * PostgreSQL runs a referential-integrity check as the *table owner* with row-level security
   * suspended, so `leave_request.employment_id` resolves against another tenant's employment and
   * the insert succeeds. The row is still tenant-A's and still invisible to tenant B, so nothing
   * leaks — but the database alone does not refuse the reference.
   *
   * What refuses it is the application: every write path resolves the employment through
   * Employment's published read first, which *is* tenant-scoped, and a request for an employment
   * this tenant cannot see is refused as `employment_not_found`. Both halves are asserted here, so
   * the guarantee is written down where somebody adding a fifteenth table will find it.
   *
   * Recorded as technical debt in the phase report: a composite foreign key on
   * `(tenant_id, employment_id)` would move the guarantee into the database, and it needs a unique
   * constraint on Employment's side — a change to a completed phase, not one to make here.
   */
  it('leaves the tenant check on a foreign key to the application, and says so', async () => {
    const forged = aRequest(
      TENANT_A,
      employmentB,
      configuredA.leaveTypeId,
      configuredA.leavePolicyId,
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, forged);
    });

    // Written — because a foreign-key check is not subject to row-level security.
    const asA = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requests.byId(transaction, forged.id),
    );

    expect(asA?.id).toBe(forged.id);

    // But it belongs to tenant A, and tenant B cannot see it. Nothing crosses the boundary.
    const asB = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.requests.byId(transaction, forged.id),
    );

    expect(asB).toBeUndefined();
  });
});
