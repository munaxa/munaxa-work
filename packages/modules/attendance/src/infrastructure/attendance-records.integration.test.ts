import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AttendanceDay } from '../domain/attendance-day.js';
import { decideCorrection } from '../domain/correction.js';

import {
  CONNECTION,
  openAttendanceFixture,
  requireDatabaseInCi,
  TENANT_A,
  type AttendanceFixture,
} from './attendance-database.fixture.js';
import {
  NOW,
  aCorrection,
  aDay,
  aPolicyState,
  aRemoval,
  aSchedule,
  aScheduleDay,
  aSegment,
  aShift,
  anAssignment,
  anEvent,
} from './attendance-fixtures.js';

/**
 * Corrections, definitions and the concurrency check, against a real database.
 *
 * Two of these are the module's strongest structural claims and neither can be proved without the
 * schema: **self-approval is refused by a check constraint** as well as by the domain, and **an
 * approved removal leaves the event in the table** — the correction record is the tombstone, and
 * this is where that is demonstrated rather than asserted (ADR-0052).
 */
const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('Attendance records');

suite('Attendance records', () => {
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

  /**
   * Self-approval, refused by the database.
   *
   * The domain refuses it too. Both, deliberately: a control that lives only in application code is
   * a control that any future path around that code silently removes.
   */
  it('refuses a correction decided by the person who requested it', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const correction = aCorrection(TENANT_A, employmentId, 'user:supervisor');

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.corrections.insert(transaction, correction),
    );

    const refused = await fixture
      .asTenant(TENANT_A, (transaction) =>
        fixture.stores.corrections.update(
          transaction,
          {
            ...correction,
            state: 'approved',
            decidedBy: 'user:supervisor',
            decidedAt: NOW,
            version: 1,
          },
          1,
        ),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(String(refused)).toContain('attendance_correction_self_approval_check');
  });

  /** An approved removal is found by the calculation, and the event it names stays in the table. */
  it('reports an applied removal so the calculation can leave the event out', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const event = anEvent(TENANT_A, employmentId);
    const removal = aRemoval(TENANT_A, employmentId, event.id, 'user:supervisor');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      await fixture.stores.events.insert(transaction, event);
      await fixture.stores.corrections.insert(transaction, removal);
    });

    const decided = decideCorrection(
      { ...removal, version: 1 },
      { approve: true, decidedBy: 'user:manager' },
      NOW,
    );

    if (!decided.ok) throw new Error('The decision should have been accepted.');

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.corrections.update(transaction, { ...decided.value, state: 'applied' }, 1),
    );

    const removed = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.corrections.appliedRemovals(transaction, employmentId, '2026-05-04'),
    );
    const stillThere = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.events.byId(transaction, event.id),
    );

    expect(removed).toEqual([event.id]);
    expect(stillThere?.occurredAt).toEqual(event.occurredAt);
  });

  /** Every definition round-trips: the shapes the calculation resolves an expectation from. */
  it('round-trips a shift, its segments, a schedule, its cycle and an assignment', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const shift = aShift(TENANT_A);
    const schedule = aSchedule(TENANT_A);

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
      await fixture.stores.policies.insert(transaction, aPolicyState(TENANT_A));
    });

    const read = await fixture.asTenant(TENANT_A, async (transaction) => ({
      shift: await fixture.stores.shifts.byId(transaction, shift.id),
      segments: await fixture.stores.segments.forShift(transaction, shift.id),
      schedule: await fixture.stores.schedules.byId(transaction, schedule.id),
      days: await fixture.stores.scheduleDays.forSchedule(transaction, schedule.id),
      assignments: await fixture.stores.assignments.forEmployment(transaction, employmentId),
      policies: await fixture.stores.policies.all(transaction),
    }));

    expect(read.shift?.expectedMinutes).toBe(540);
    expect(read.shift?.crossesMidnight).toBe(false);
    expect(read.segments).toHaveLength(1);
    expect(read.schedule?.zone).toBe('Asia/Riyadh');
    expect(read.schedule?.cycleAnchorDate).toBe('2026-05-04');
    expect(read.days[0]?.cyclePosition).toBe(0);
    expect(read.assignments[0]?.effectiveFrom).toBe('2026-01-01');
    // Nothing statutory ships: an unconfigured policy is inert in every dimension (00B).
    expect(read.policies[0]?.lateToleranceMinutes).toBe(0);
    expect(read.policies[0]?.roundingMinutes).toBe(0);
  });

  /** A write that lost a race is refused, rather than overwriting the version it never read. */
  it('refuses a day update whose version has moved', async () => {
    const employmentId = await fixture.seedEmployment(TENANT_A);
    const day = aDay(TENANT_A, employmentId);

    await fixture.asTenant(TENANT_A, (transaction) => fixture.stores.days.insert(transaction, day));

    const rehydrated = AttendanceDay.rehydrate({ ...day, version: 1 });

    rehydrated.markStale(NOW);

    await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.days.update(transaction, rehydrated.snapshot(), 1),
    );

    const stale = await fixture
      .asTenant(TENANT_A, (transaction) =>
        fixture.stores.days.update(transaction, rehydrated.snapshot(), 1),
      )
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(stale).toBeDefined();
  });
});
