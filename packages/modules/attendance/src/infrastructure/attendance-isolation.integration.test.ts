import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  ATTENDANCE_TABLES,
  CONNECTION,
  openAttendanceFixture,
  requireDatabaseInCi,
  TENANT_A,
  TENANT_B,
  type AttendanceFixture,
} from './attendance-database.fixture.js';
import {
  aCorrection,
  aDay,
  aPolicyState,
  aRosterEntry,
  aSchedule,
  aScheduleDay,
  aSegment,
  aShift,
  aSnapshot,
  anAssignment,
  anEvent,
} from './attendance-fixtures.js';

/**
 * Tenant isolation, and the race idempotent ingestion is built to lose safely.
 *
 * The suite connects as a role that owns nothing and holds no `BYPASSRLS`, which is the only
 * configuration under which any of this means anything: a superuser bypasses every policy, so the
 * same assertions run as one would pass whether or not isolation worked.
 *
 * The concurrency assertion is the one to read. Two transactions, both reading "no such punch",
 * both inserting. The database decides. That is what makes ingestion safe to call from a turnstile
 * retry, a mobile offline queue and a re-run import at the same moment (ADR-0053).
 */
const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Attendance isolation');

suite('Attendance isolation', () => {
  let fixture: AttendanceFixture;

  beforeAll(async () => {
    fixture = await openAttendanceFixture('attendance_fixture');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  /** Every table this module owns carries the policy. There is no exception, so none is asserted. */
  it('protects every one of its thirteen tables with row-level security', async () => {
    const protectedTables = await fixture.admin.query<{ tablename: string }>(
      `select tablename from pg_tables
        where schemaname = 'public' and tablename = any($1::text[]) and rowsecurity`,
      [ATTENDANCE_TABLES],
    );

    expect(protectedTables.rows.map((row) => row.tablename).sort()).toEqual(
      [...ATTENDANCE_TABLES].sort(),
    );
  });

  /**
   * The raw register: when a named person came and went.
   *
   * The most sensitive read in the module, and the one whose leak would be least visible — a search
   * returning another customer's punches looks like an empty week to the customer it belongs to.
   */
  it("hides one tenant's punches from another, by identifier, by day and by search", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const event = anEvent(TENANT_A, employmentId, { idempotencyKey: 'turnstile-1' });

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.insert(transaction, event),
    );

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      byId: await fixture.stores.events.byId(transaction, event.id),
      byKey: await fixture.stores.events.byKey(transaction, event.eventKey),
      forDay: await fixture.stores.events.forDay(transaction, employmentId, '2026-05-04'),
      search: await fixture.stores.events.search(transaction, { limit: 50, offset: 0 }),
    }));

    expect(seen.byId).toBeUndefined();
    expect(seen.byKey).toBeUndefined();
    expect(seen.forDay).toEqual([]);
    expect(seen.search.items).toEqual([]);
    expect(seen.search.total).toBe(0);
  });

  it("hides one tenant's days, exceptions and reconciliation queue from another", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const day = aDay(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, (transaction) => fixture.stores.days.insert(transaction, day));

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      byId: await fixture.stores.days.byId(transaction, day.id),
      byDate: await fixture.stores.days.byDate(transaction, employmentId, '2026-05-04'),
      period: await fixture.stores.days.forPeriod(
        transaction,
        employmentId,
        '2026-05-01',
        '2026-05-31',
      ),
      stale: await fixture.stores.days.stale(transaction, 50),
      search: await fixture.stores.days.search(transaction, { limit: 50, offset: 0 }),
      exceptions: await fixture.stores.exceptions.forDay(transaction, day.id),
    }));

    expect(seen.byId).toBeUndefined();
    expect(seen.byDate).toBeUndefined();
    expect(seen.period).toEqual([]);
    expect(seen.stale).toEqual([]);
    expect(seen.search.items).toEqual([]);
    expect(seen.exceptions).toEqual([]);
  });

  /**
   * A bulk statement is the one that could touch another tenant's month.
   *
   * `markStale` writes by *predicate* rather than by identity, so a missing tenant clause would not
   * fail — it would quietly queue a competitor's whole workforce for recalculation.
   */
  it("cannot mark another tenant's days stale", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.insert(transaction, aDay(TENANT_A, employmentId)),
    );

    const marked = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.days.markStale(
        transaction,
        { from: '2026-01-01', to: '9999-12-31' },
        new Date('2026-05-06T09:00:00Z'),
      ),
    );

    expect(marked).toBe(0);
  });

  it("hides one tenant's schedules, shifts, rotas and policies from another", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const shift = aShift(TENANT_A);
    const schedule = aSchedule(TENANT_A);
    const roster = aRosterEntry(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.shifts.insert(transaction, shift);
      await fixture.stores.segments.insert(transaction, aSegment(TENANT_A, shift.id));
      await fixture.stores.schedules.insert(transaction, schedule);
      await fixture.stores.scheduleDays.insert(
        transaction,
        aScheduleDay(TENANT_A, schedule.id, shift.id),
      );
      await fixture.stores.assignments.insert(
        transaction,
        anAssignment(TENANT_A, employmentId, schedule.id),
      );
      await fixture.stores.rosters.insert(transaction, roster);
      await fixture.stores.policies.insert(transaction, aPolicyState(TENANT_A));
    });

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      shifts: await fixture.stores.shifts.all(transaction),
      shiftById: await fixture.stores.shifts.byId(transaction, shift.id),
      segments: await fixture.stores.segments.forShift(transaction, shift.id),
      schedules: await fixture.stores.schedules.all(transaction),
      cycle: await fixture.stores.scheduleDays.forSchedule(transaction, schedule.id),
      assignments: await fixture.stores.assignments.forEmployment(transaction, employmentId),
      roster: await fixture.stores.rosters.on(transaction, employmentId, '2026-05-04'),
      rosterWindow: await fixture.stores.rosters.between(transaction, '2026-05-01', '2026-05-31'),
      policies: await fixture.stores.policies.published(transaction),
    }));

    expect(seen.shifts).toEqual([]);
    expect(seen.shiftById).toBeUndefined();
    expect(seen.segments).toEqual([]);
    expect(seen.schedules).toEqual([]);
    expect(seen.cycle).toEqual([]);
    expect(seen.assignments).toEqual([]);
    expect(seen.roster).toBeUndefined();
    expect(seen.rosterWindow).toEqual([]);
    expect(seen.policies).toEqual([]);
  });

  it("hides one tenant's corrections and payable snapshots from another", async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const correction = aCorrection(TENANT_A, employmentId, 'user:supervisor');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.corrections.insert(transaction, correction);
      await fixture.stores.snapshots.insert(transaction, aSnapshot(TENANT_A, employmentId, 1));
    });

    const seen = await fixture.asTenant(TENANT_B, async (transaction) => ({
      byId: await fixture.stores.corrections.byId(transaction, correction.id),
      search: await fixture.stores.corrections.search(transaction, { limit: 50, offset: 0 }),
      removals: await fixture.stores.corrections.appliedRemovals(
        transaction,
        employmentId,
        '2026-05-04',
      ),
      snapshots: await fixture.stores.snapshots.forPeriod(transaction, '2026-05-01', '2026-05-31'),
      latest: await fixture.stores.snapshots.latest(
        transaction,
        employmentId,
        '2026-05-01',
        '2026-05-31',
      ),
    }));

    expect(seen.byId).toBeUndefined();
    expect(seen.search.items).toEqual([]);
    expect(seen.removals).toEqual([]);
    expect(seen.snapshots).toEqual([]);
    expect(seen.latest).toBeUndefined();
  });

  /**
   * The deduplication key is tenant-scoped, and this is why it must be.
   *
   * Two customers whose devices happen to number their punches the same way are two different
   * people. An index that omitted the tenant would let one customer's punch silently suppress
   * another's — the worst class of isolation failure, because it looks like a business rule.
   */
  it("does not let one tenant's event key suppress another's punch", async () => {
    const inA = await fixture.seedEmployment(TENANT_A);
    const inB = await fixture.seedEmployment(TENANT_B);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.insert(
        transaction,
        anEvent(TENANT_A, inA, { idempotencyKey: 'turnstile-000001' }),
      ),
    );
    await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.events.insert(
        transaction,
        anEvent(TENANT_B, inB, { idempotencyKey: 'turnstile-000001' }),
      ),
    );

    const both = await fixture.admin.query<{ total: string }>(
      'select count(*)::text as total from attendance_time_event',
    );

    expect(both.rows[0]?.total).toBe('2');
  });

  /**
   * Two concurrent submissions of one punch.
   *
   * Both transactions read nothing and both insert. Exactly one commits; the other is refused by
   * the unique index with `23505`, which is the error ingestion's race branch recognises. The
   * losing caller re-reads and is told the winner's identifier, so a retrying punch clock is safe
   * rather than a source of duplicates.
   */
  it('lets the index decide when two submissions of one punch race', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const punch = anEvent(TENANT_A, employmentId, { idempotencyKey: 'race' });
    const other = anEvent(TENANT_A, employmentId, { idempotencyKey: 'race' });
    const submit = (state: typeof punch): Promise<unknown> =>
      fixture
        .asTenant(TENANT_A, (transaction) => fixture.stores.events.insert(transaction, state))
        .then(() => 'committed')
        .catch((error: unknown) => (error as { code?: string }).code ?? 'failed');

    const outcomes = await Promise.all([submit(punch), submit(other)]);
    const stored = await fixture.admin.query<{ total: string }>(
      'select count(*)::text as total from attendance_time_event',
    );

    expect(outcomes.filter((one) => one === 'committed')).toHaveLength(1);
    expect(outcomes.filter((one) => one === '23505')).toHaveLength(1);
    expect(stored.rows[0]?.total).toBe('1');
  });

  /**
   * Attendance cannot invent an employment.
   *
   * The foreign key is the guarantee, and it points *backward* to a module Attendance already
   * depends on — which is the rule ADR-0042 states and the reason it is a foreign key here rather
   * than a bare identifier.
   */
  it('refuses a day for an employment that does not exist', async () => {
    const refused = await fixture
      .asTenant(TENANT_A, (transaction) =>
        fixture.stores.days.insert(
          transaction,
          aDay(TENANT_A, '01920000-0000-7000-8000-00000000dead'),
        ),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(String(refused)).toContain('attendance_day_employment_fk');
  });
});
