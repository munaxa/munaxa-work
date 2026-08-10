import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  TENANT_A,
  openLeaveFixture,
  requireDatabaseInCi,
  type LeaveFixture,
} from './leave-database.fixture.js';
import { aDay, aRequest, anEntry, configuredTenant } from './leave-fixtures.js';

/**
 * Two transactions racing, against a real database.
 *
 * This is the file the exclusion constraint exists for. Two people asking for the same morning both
 * pass every application check — they read, they find nothing, they write — and an application-level
 * guard cannot settle it: the read happened before either wrote. **Only the database can**, and
 * only if the constraint is actually there.
 *
 * So these suites open two genuine connections and hold both open at once. A sequential test would
 * pass with no constraint at all, which is precisely why it would be worthless.
 *
 * Every wait here is bounded by the fixture's `statement_timeout`, because a contended index turns
 * an unbounded wait into a job that produces no output and no failure until it is killed hours
 * later.
 */

const describeIfDatabase = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Leave concurrency');

describeIfDatabase('Leave, under real concurrency', () => {
  let fixture: LeaveFixture;
  let employmentId: string;
  let configured: { readonly leaveTypeId: string; readonly leavePolicyId: string };

  beforeAll(async () => {
    fixture = await openLeaveFixture('leave_concurrency_role');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    employmentId = await fixture.seedEmployment(TENANT_A);
    configured = await fixture.asTenant(TENANT_A, (transaction) =>
      configuredTenant(transaction, fixture.stores, TENANT_A),
    );
  });

  /**
   * The race, run for real.
   *
   * Both transactions write a full day on the same date for the same employment, concurrently. One
   * commits and one is refused — and *which* one is not the point. What matters is that exactly one
   * succeeds, which is the guarantee an application check cannot give.
   */
  it('lets exactly one of two concurrent requests take the same morning', async () => {
    const first = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );
    const second = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, first);
      await fixture.stores.requests.insert(transaction, second);
    });

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(transaction, aDay(first)),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(transaction, aDay(second)),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(1);

    const days = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requestDays.covering(transaction, {
        employmentId,
        from: '2026-06-15',
        to: '2026-06-15',
      }),
    );

    expect(days).toHaveLength(1);
  });

  /** A first and a second half of the same date are not a race. Both commit. */
  it('lets a first and a second half of one date commit concurrently', async () => {
    const morning = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );
    const afternoon = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, morning);
      await fixture.stores.requests.insert(transaction, afternoon);
    });

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(
          transaction,
          aDay(morning, { portion: 'first_half', minutes: 240 }),
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(
          transaction,
          aDay(afternoon, { portion: 'second_half', minutes: 240 }),
        ),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'rejected')).toHaveLength(0);
  });

  /**
   * Two overlapping hourly requests, which a partial unique index could not have caught.
   *
   * `09:00–12:00` and `11:00–13:00` are different rows with different portions; only a range
   * comparison refuses them, and only the exclusion constraint does it under concurrency. This is
   * the case that decided D-4.
   */
  it('refuses two overlapping hourly requests on the same date', async () => {
    const early = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );
    const late = aRequest(TENANT_A, employmentId, configured.leaveTypeId, configured.leavePolicyId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, early);
      await fixture.stores.requests.insert(transaction, late);
    });

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(
          transaction,
          aDay(early, {
            portion: 'hours',
            minutes: 180,
            startLocal: '09:00',
            endLocal: '12:00',
          }),
        ),
      ),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.requestDays.insert(
          transaction,
          aDay(late, {
            portion: 'hours',
            minutes: 120,
            startLocal: '11:00',
            endLocal: '13:00',
          }),
        ),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);
  });

  /** Two hourly requests that do not overlap are not a race either. */
  it('permits two hourly requests on the same date that do not overlap', async () => {
    const early = aRequest(
      TENANT_A,
      employmentId,
      configured.leaveTypeId,
      configured.leavePolicyId,
    );
    const late = aRequest(TENANT_A, employmentId, configured.leaveTypeId, configured.leavePolicyId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.requests.insert(transaction, early);
      await fixture.stores.requests.insert(transaction, late);
      await fixture.stores.requestDays.insert(
        transaction,
        aDay(early, { portion: 'hours', minutes: 120, startLocal: '09:00', endLocal: '11:00' }),
      );
      await fixture.stores.requestDays.insert(
        transaction,
        aDay(late, { portion: 'hours', minutes: 120, startLocal: '13:00', endLocal: '15:00' }),
      );
    });

    const days = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.requestDays.covering(transaction, {
        employmentId,
        from: '2026-06-15',
        to: '2026-06-15',
      }),
    );

    expect(days).toHaveLength(2);
  });

  /**
   * The ledger's idempotency, under concurrency.
   *
   * Two runs writing the same movement at once: exactly one entry exists afterwards. This is what
   * makes a bounded run safe to retry rather than something an operator has to be careful with.
   */
  it('writes one ledger entry when two runs race on the same source', async () => {
    const entry = anEntry(TENANT_A, employmentId, configured.leaveTypeId);

    const outcomes = await Promise.allSettled([
      fixture.asTenant(TENANT_A, (transaction) => fixture.stores.ledger.insert(transaction, entry)),
      fixture.asTenant(TENANT_A, (transaction) =>
        fixture.stores.ledger.insert(transaction, {
          ...entry,
          id: anEntry(TENANT_A, employmentId, configured.leaveTypeId).id,
        }),
      ),
    ]);

    expect(outcomes.filter((one) => one.status === 'fulfilled')).toHaveLength(1);

    const stored = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.ledger.forBucket(transaction, {
        employmentId,
        leaveTypeId: configured.leaveTypeId,
        leaveYearStart: '2026-01-01',
      }),
    );

    expect(stored).toHaveLength(1);
  });
});
