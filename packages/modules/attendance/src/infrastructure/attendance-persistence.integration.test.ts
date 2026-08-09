import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dayException } from '../domain/attendance-day.js';
import type { AttendanceDayState } from '../domain/attendance-day-state.js';

import {
  CONNECTION,
  openAttendanceFixture,
  requireDatabaseInCi,
  TENANT_A,
  type AttendanceFixture,
} from './attendance-database.fixture.js';
import { NOW, aDay, aRosterEntry, aSnapshot, anEvent } from './attendance-fixtures.js';

/**
 * What the database guarantees, checked against a real one.
 *
 * These assertions are not about the repositories being wired correctly. They are about the
 * properties the module's reliability claims rest on, each of which lives in the schema:
 *
 * - the **deduplication index** that makes a device retry converge on one row;
 * - the **partial stale index** the reconciliation read depends on;
 * - the **soft delete** that lets a rota entry be replaced without losing who moved it;
 * - the **snapshot sequence** that stops a correction rewriting what Payroll already paid;
 * - and the **date columns**, which must come back as the dates that went in.
 *
 * The correction and definition round-trips are in `attendance-records.integration.test.ts`, split
 * for size.
 */
const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Attendance persistence');

suite('Attendance persistence', () => {
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

  /** A day as a recalculation leaves it: derived, and out of the reconciliation queue. */
  const calculated = (day: AttendanceDayState): AttendanceDayState => {
    const rest = Object.fromEntries(
      Object.entries(day).filter(([name]) => name !== 'inputsChangedAt'),
    ) as AttendanceDayState;

    return { ...rest, calculatedAt: NOW, state: 'calculated' };
  };

  /**
   * A civil date must survive the round trip.
   *
   * The driver turns a `date` column into a `Date` at the *process's* local midnight, so a date read
   * on a server west of UTC comes back as the day before. Every date column in this module is
   * selected as text for that reason, and this is the assertion that would notice if one were not.
   */
  it('returns a stored civil date unchanged, whatever the process time zone', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.events.insert(transaction, anEvent(TENANT_A, employmentId));
      await fixture.stores.days.insert(transaction, aDay(TENANT_A, employmentId));
      await fixture.stores.rosters.insert(transaction, aRosterEntry(TENANT_A, employmentId));
    });

    const read = await fixture.asTenant(TENANT_A, async (transaction) => ({
      day: await fixture.stores.days.byDate(transaction, employmentId, '2026-05-04'),
      roster: await fixture.stores.rosters.on(transaction, employmentId, '2026-05-04'),
      events: await fixture.stores.events.forDay(transaction, employmentId, '2026-05-04'),
    }));

    expect(read.day?.attendanceDate).toBe('2026-05-04');
    expect(read.roster?.onDate).toBe('2026-05-04');
    expect(read.events[0]?.attendanceDate).toBe('2026-05-04');
    expect(read.events[0]?.zone).toBe('Asia/Riyadh');
  });

  /** The index the whole ingestion path rests on, refusing the second row rather than trusting a read. */
  it('refuses a second event carrying the same deduplication key', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const event = anEvent(TENANT_A, employmentId, { idempotencyKey: 'turnstile-1' });

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.insert(transaction, event),
    );

    const again = await fixture
      .asTenant(TENANT_A, (transaction) =>
        fixture.stores.events.insert(transaction, {
          ...event,
          id: aDay(TENANT_A, employmentId).id,
        }),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect((again as { code?: string } | undefined)?.code).toBe('23505');
  });

  /** Punch location evidence survives as numbers, not as the strings `numeric` arrives as. */
  it('round-trips punch location evidence as coordinates', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.insert(
        transaction,
        anEvent(TENANT_A, employmentId, { latitude: 24.7136, longitude: 46.6753 }),
      ),
    );

    const events = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.forDay(transaction, employmentId, '2026-05-04'),
    );

    expect(events[0]?.latitude).toBeCloseTo(24.7136, 4);
    expect(events[0]?.longitude).toBeCloseTo(46.6753, 4);
    expect(events[0]?.locationAccuracyMetres).toBe(12);
  });

  /**
   * The reconciliation read, against the real partial index.
   *
   * `markStale` writes the mark for a month in one statement, `stale` finds exactly the marked rows,
   * and clearing the mark takes the day out of the queue.
   */
  it('marks a period stale in one statement and finds exactly those days', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const day = aDay(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.days.insert(transaction, day);
      // Calculated, so the row leaves the queue and the mark can be re-applied deliberately. A day
      // is opened *already* marked — ingestion opens it and the calculation has not run — so
      // clearing the mark here is what a recalculation would have done.
      await fixture.stores.days.update(transaction, calculated(day), 1);
    });

    const settled = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.stale(transaction, 50),
    );

    expect(settled).toHaveLength(0);

    const marked = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.markStale(
        transaction,
        { from: '2026-05-01', to: '2026-05-31' },
        new Date('2026-05-06T09:00:00Z'),
      ),
    );

    expect(marked).toBe(1);

    const queued = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.stale(transaction, 50),
    );

    expect(queued.map((one) => one.id)).toEqual([day.id]);
  });

  /** A day outside the marked period is untouched: widening a policy in June cannot forgive March. */
  it('leaves days outside the marked period alone', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const march = aDay(TENANT_A, employmentId, '2026-03-04');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.days.insert(transaction, march);
      await fixture.stores.days.update(transaction, calculated(march), 1);
    });

    const marked = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.markStale(transaction, { from: '2026-06-01', to: '9999-12-31' }, NOW),
    );

    expect(marked).toBe(0);
  });

  /** A recalculation supersedes what the previous one found. Nothing is deleted. */
  it('supersedes open exceptions rather than deleting them', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const day = aDay(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.days.insert(transaction, day);
      await fixture.stores.exceptions.insert(
        transaction,
        dayException(
          {
            tenantId: TENANT_A,
            attendanceDayId: day.id,
            employmentId,
            attendanceDate: '2026-05-04',
            kind: 'missing_clock_out',
            severity: 'blocking',
          },
          NOW,
        ),
      );
      await fixture.stores.exceptions.supersedeOpen(transaction, day.id, NOW);
    });

    const found = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.exceptions.forDay(transaction, day.id),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.state).toBe('superseded');
  });

  /** Replacing a rota entry supersedes it: the same date accepts a new row, and the old one stays. */
  it('accepts a replacement rota entry on a date whose entry was removed', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const original = aRosterEntry(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.rosters.insert(transaction, original),
    );
    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.rosters.remove(transaction, original.id, 1);
      await fixture.stores.rosters.insert(transaction, aRosterEntry(TENANT_A, employmentId));
    });

    const live = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.rosters.on(transaction, employmentId, '2026-05-04'),
    );
    const kept = await fixture.admin.query<{ total: string }>(
      'select count(*)::text as total from attendance_roster_entry where employment_id = $1',
      [employmentId],
    );

    expect(live?.id).not.toBe(original.id);
    expect(kept.rows[0]?.total).toBe('2');
  });

  /** A freeze after a correction is the next sequence, not an edit of what Payroll already read. */
  it('keeps both sequences of a re-frozen period', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.snapshots.insert(transaction, aSnapshot(TENANT_A, employmentId, 1));
      await fixture.stores.snapshots.insert(transaction, aSnapshot(TENANT_A, employmentId, 2));
    });

    const both = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.snapshots.forPeriod(transaction, '2026-05-01', '2026-05-31'),
    );
    const latest = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.snapshots.latest(transaction, employmentId, '2026-05-01', '2026-05-31'),
    );

    expect(both.map((one) => one.sequence)).toEqual([1, 2]);
    expect(latest?.sequence).toBe(2);
  });
});
