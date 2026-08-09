import { beforeEach, describe, expect, it } from 'vitest';

import { inMemoryAttendanceStores } from './in-memory-definitions.js';
import {
  aConfiguredSchedule,
  anAssignedEmployment,
  asActor,
  ask,
  asTenant,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  TENANT_A,
  TENANT_B,
} from './attendance-test-harness.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { EventRecorded } from './ingest.use-case.js';
import type { RecalculationOutcome } from './recalculate.use-case.js';
import type { AttendanceDaySnapshot } from '../contracts/views.js';

/**
 * Who may do what, and whose data they can see.
 *
 * Both properties are proved **through the dispatcher**, because that is where the permission check
 * and the tenant scope are applied. A test that called a handler directly would prove a handler
 * works for a caller nobody checked, which is the opposite of what these assert.
 *
 * The tenant assertions here are the *application* half. Row-level security is the database's, and
 * the integration suite proves it against a real one — an in-memory store filtering by
 * `transaction.tenantId` is evidence that the code asks for the right rows, not that the database
 * would refuse the wrong ones.
 */
describe('Attendance is permissioned narrowly and scoped to one tenant', () => {
  beforeEach(() => {
    testClock.reset();
  });

  const at = new Date('2026-05-04T05:00:00Z');

  /**
   * The separations that matter, each stated as a caller who holds everything *except* the one
   * permission the operation needs.
   */
  const refusals = [
    {
      what: 'recording a punch',
      without: AttendancePermissions.eventRecord,
      command: { commandName: 'attendance.record-event', kind: 'clock_in', source: 'device' },
    },
    {
      what: 'signing a day off',
      without: AttendancePermissions.approve,
      command: {
        commandName: 'attendance.approve-day',
        attendanceDayId: '019d0000-0000-7000-8000-000000000000',
        expectedVersion: 1,
      },
    },
    {
      what: 'publishing a shift',
      without: AttendancePermissions.schedulePublish,
      command: {
        commandName: 'attendance.publish-shift',
        shiftId: '019d0000-0000-7000-8000-000000000000',
        expectedVersion: 1,
      },
    },
    {
      what: 'deciding a correction',
      without: AttendancePermissions.correctionApprove,
      command: {
        commandName: 'attendance.decide-correction',
        correctionId: '019d0000-0000-7000-8000-000000000000',
        approve: true,
        expectedVersion: 1,
      },
    },
    {
      what: 'freezing a period',
      without: AttendancePermissions.periodFreeze,
      command: {
        commandName: 'attendance.freeze-period',
        periodStart: '2026-05-01',
        periodEnd: '2026-05-31',
      },
    },
    {
      what: 'importing a batch',
      without: AttendancePermissions.import,
      command: { commandName: 'attendance.import-events', source: 'device', rows: [] },
    },
  ] as const;

  for (const scenario of refusals) {
    it(`refuses ${scenario.what} to a caller who holds everything but that permission`, async () => {
      const granted = Object.values(AttendancePermissions).filter(
        (permission) => permission !== scenario.without,
      );
      const harness = harnessFor(TENANT_A, granted);

      await asTenant(TENANT_A, async () => {
        const result = await send(harness, {
          employmentId: '019d0000-0000-7000-8000-000000000001',
          ...scenario.command,
        });

        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.kind).toBe('forbidden');
      });
    });
  }

  /**
   * Reading a day and reading its raw events are different permissions, and the second is the
   * narrower one: the events carry device identifiers and, where a tenant enables capture,
   * coordinates.
   */
  it('lets a reviewer read a day without reading the device evidence behind it', async () => {
    const stores = inMemoryAttendanceStores();
    const full = harnessWithStores(TENANT_A, stores);
    const reviewer = harnessWithStores(TENANT_A, stores, [AttendancePermissions.read], {
      employment: full.employment,
      leave: full.leave,
    });

    await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(full);
      const employmentId = await anAssignedEmployment(full, configured);

      testClock.value = at;
      await send(full, {
        commandName: 'attendance.record-event',
        employmentId,
        kind: 'clock_in',
        source: 'device',
        deviceReference: 'lobby-turnstile-3',
        reportedAt: at,
      });
      await send(full, { commandName: 'attendance.recalculate' });

      const day = await ask(reviewer, {
        queryName: 'attendance.read-day',
        employmentId,
        attendanceDate: '2026-05-04',
      });

      expect(day.ok).toBe(true);

      const events = await ask(reviewer, {
        queryName: 'attendance.search-events',
        employmentId,
      });

      expect(events.ok).toBe(false);
      expect(!events.ok && events.error.kind).toBe('forbidden');
    });
  });

  /** One store, two tenants. Neither can see the other's day, and neither can recalculate it. */
  it('hides one tenant’s attendance from another sharing the same store', async () => {
    const stores = inMemoryAttendanceStores();
    const alpha = harnessWithStores(TENANT_A, stores);
    const beta = harnessWithStores(TENANT_B, stores, undefined, {
      employment: alpha.employment,
      leave: alpha.leave,
    });

    const employmentId = await asTenant(TENANT_A, async () => {
      const configured = await aConfiguredSchedule(alpha);
      const id = await anAssignedEmployment(alpha, configured);

      testClock.value = at;
      await send(alpha, {
        commandName: 'attendance.record-event',
        employmentId: id,
        kind: 'clock_in',
        source: 'device',
        reportedAt: at,
      });
      return id;
    });

    await asTenant(TENANT_B, async () => {
      const day = await ask<AttendanceDaySnapshot>(beta, {
        queryName: 'attendance.read-day',
        employmentId,
        attendanceDate: '2026-05-04',
      });

      expect(day.ok).toBe(false);
      expect(!day.ok && day.error.kind).toBe('not_found');

      // And the other tenant's stale day is not in this tenant's work queue.
      const recalculated = await send<RecalculationOutcome>(beta, {
        commandName: 'attendance.recalculate',
      });

      expect(recalculated.ok && recalculated.value.examined).toBe(0);
    });

    await asTenant(TENANT_A, async () => {
      const day = await ask<AttendanceDaySnapshot>(alpha, {
        queryName: 'attendance.read-day',
        employmentId,
        attendanceDate: '2026-05-04',
      });

      expect(day.ok).toBe(true);
    });
  });

  /**
   * Two tenants sending an identical punch, with the same client key.
   *
   * They are two different punches by two different people who happen to share an identifier, and
   * the deduplication key is tenant-scoped so neither is swallowed by the other.
   */
  it('does not deduplicate one tenant’s punch against another’s', async () => {
    const stores = inMemoryAttendanceStores();
    const alpha = harnessWithStores(TENANT_A, stores);
    const beta = harnessWithStores(TENANT_B, stores, undefined, {
      employment: alpha.employment,
      leave: alpha.leave,
    });
    const submit = async (
      harness: typeof alpha,
      tenantId: string,
      employmentId: string,
    ): Promise<EventRecorded> => {
      const result = await asTenant(tenantId, () => {
        testClock.value = at;
        return send<EventRecorded>(harness, {
          commandName: 'attendance.record-event',
          employmentId,
          kind: 'clock_in',
          source: 'device',
          idempotencyKey: 'turnstile-000001',
          reportedAt: at,
        });
      });

      if (!result.ok) throw new Error(`Ingestion failed: ${JSON.stringify(result.error)}`);
      return result.value;
    };

    const one = alpha.employment.add({});
    const other = alpha.employment.add({});
    const first = await submit(alpha, TENANT_A, one.employmentId);
    const second = await submit(beta, TENANT_B, other.employmentId);

    expect(second.alreadyRecorded).toBe(false);
    expect(second.eventId).not.toBe(first.eventId);
    expect(stores.events.rows).toHaveLength(2);
  });

  /**
   * Self-approval, refused for somebody holding both permissions.
   *
   * A separation of duties that depends on nobody being granted two roles is a separation that
   * fails the first time somebody is. This one is enforced by the domain and by a check constraint
   * in the database, so it holds regardless of what the tenant granted.
   */
  it('refuses a correction decided by the person who requested it', async () => {
    const harness = harnessFor(TENANT_A);

    await asActor(TENANT_A, 'user:supervisor', async () => {
      const configured = await aConfiguredSchedule(harness);
      const employmentId = await anAssignedEmployment(harness, configured);
      const requested = await send<{ correctionId: string }>(harness, {
        commandName: 'attendance.request-correction',
        employmentId,
        attendanceDate: '2026-05-04',
        kind: 'add_event',
        proposedKind: 'clock_in',
        proposedOccurredAt: at,
        reasonCode: 'reader-offline',
        justification: 'The reader was down and the arrival was logged by security.',
      });

      if (!requested.ok) throw new Error('The request should have been accepted.');

      const decided = await send(harness, {
        commandName: 'attendance.decide-correction',
        correctionId: requested.value.correctionId,
        approve: true,
        expectedVersion: 1,
      });

      expect(decided.ok).toBe(false);
    });
  });
});
