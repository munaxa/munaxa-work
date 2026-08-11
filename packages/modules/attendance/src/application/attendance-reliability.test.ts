import { beforeEach, describe, expect, it } from 'vitest';

import { inMemoryAttendanceStores } from './in-memory-definitions.js';
import {
  aConfiguredSchedule,
  anAssignedEmployment,
  ask,
  asTenant,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  TENANT_A,
  type ConfiguredAttendance,
  type Harness,
} from './attendance-test-harness.js';
import type { EventRecorded } from './ingest.use-case.js';
import { readDay } from './attendance-day-helpers.js';
import type { RecalculationOutcome } from './recalculate.use-case.js';
import type { AwaitingRecalculationView } from './reconciliation-query.js';

/**
 * The properties this module's reliability rests on.
 *
 * One suite rather than several scattered assertions, because they are one argument:
 *
 * **Event delivery in this product is post-commit, in-process and at-most-once, with no outbox.** A
 * process can die between the commit and the dispatch and nothing replays what was lost. So no
 * attendance figure may depend on an event having been delivered. What it depends on instead is an
 * input-change mark written in the same transaction as the change, an idempotent recalculation
 * command, and a reconciliation query that names what is stale (ADR-0053).
 *
 * These tests are the evidence for that claim rather than a description of it.
 */
describe('Ingestion is idempotent, and recalculation is found by asking', () => {
  beforeEach(() => {
    testClock.reset();
  });

  const punchAt = (time: string, date = '2026-05-04'): Date => new Date(`${date}T${time}:00+03:00`);

  const start = async (
    harness: Harness,
  ): Promise<{ readonly configured: ConfiguredAttendance; readonly employmentId: string }> => {
    const configured = await aConfiguredSchedule(harness);
    const employmentId = await anAssignedEmployment(harness, configured);

    return { configured, employmentId };
  };

  /**
   * Records a punch as a server would receive it: at about the time it happened.
   *
   * The clock is advanced deliberately rather than left frozen, because ingestion disbelieves a
   * client whose claim diverges from the server's receipt by more than the policy's tolerance — and
   * a test that punched at 08:00 while the server thought it was 12:00 would be testing the skew
   * rule rather than the thing it meant to test. The skew rule has its own tests.
   */
  const record = async (
    harness: Harness,
    employmentId: string,
    kind: 'clock_in' | 'clock_out',
    at: Date,
    idempotencyKey?: string,
  ): Promise<EventRecorded> => {
    testClock.value = at;

    const result = await send<EventRecorded>(harness, {
      commandName: 'attendance.record-event',
      employmentId,
      kind,
      source: 'device',
      reportedAt: at,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    });

    if (!result.ok) throw new Error(`Ingestion failed: ${JSON.stringify(result.error)}`);
    return result.value;
  };

  /**
   * A device retrying is the ordinary case, not the exceptional one. A turnstile with a flaky
   * uplink resends, and the second attempt must be a success naming the same punch.
   */
  it('returns the same event when a device sends the same punch twice', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);
      const first = await record(harness, employmentId, 'clock_in', punchAt('08:00'), 'punch-1');
      const second = await record(harness, employmentId, 'clock_in', punchAt('08:00'), 'punch-1');

      expect(first.alreadyRecorded).toBe(false);
      expect(second.alreadyRecorded).toBe(true);
      expect(second.eventId).toBe(first.eventId);
      expect(harness.stores.events.rows).toHaveLength(1);
    });
  });

  it('deduplicates a repeated punch even with no client key, by its digest', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));

      const repeat = await record(harness, employmentId, 'clock_in', punchAt('08:00'));

      expect(repeat.alreadyRecorded).toBe(true);
      expect(harness.stores.events.rows).toHaveLength(1);
    });
  });

  /**
   * Two submissions arriving at once. The database decides; the loser reads the winner. This is the
   * branch a punch clock finds in production and a unit test would otherwise never reach — which is
   * why the in-memory store raises the driver's own SQLSTATE.
   */
  it('converges on one event when two ingestions race', async () => {
    const stores = inMemoryAttendanceStores();
    const first = harnessWithStores(TENANT_A, stores);
    const second = harnessWithStores(TENANT_A, stores, undefined, {
      employment: first.employment,
      leave: first.leave,
    });

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(first);
      const [left, right] = await Promise.all([
        record(first, employmentId, 'clock_in', punchAt('08:00'), 'race'),
        record(second, employmentId, 'clock_in', punchAt('08:00'), 'race'),
      ]);

      expect(left.eventId).toBe(right.eventId);
      expect([left.alreadyRecorded, right.alreadyRecorded].filter((one) => !one)).toHaveLength(1);
      expect(stores.events.rows).toHaveLength(1);
    });
  });

  /**
   * The reconciliation property. Nothing in this test publishes or consumes an event: the day is
   * marked when the punch lands, and the query finds it.
   */
  it('finds a day whose events arrived, recalculates it, and finds nothing on a rerun', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));
      await record(harness, employmentId, 'clock_out', punchAt('17:00'));

      const before = await ask<AwaitingRecalculationView>(harness, {
        queryName: 'attendance.days-awaiting-recalculation',
      });

      expect(before.ok && before.value.total).toBe(1);

      const first = await send<RecalculationOutcome>(harness, {
        commandName: 'attendance.recalculate',
      });

      expect(first.ok && first.value.recalculated).toBe(1);
      expect(first.ok && first.value.failures).toEqual([]);

      const after = await ask<AwaitingRecalculationView>(harness, {
        queryName: 'attendance.days-awaiting-recalculation',
      });

      expect(after.ok && after.value.total).toBe(0);

      const second = await send<RecalculationOutcome>(harness, {
        commandName: 'attendance.recalculate',
      });

      expect(second.ok && second.value.examined).toBe(0);
    });
  });

  /** Same inputs, same answer, and the digest proves it. A rerun writes nothing new. */
  it('reproduces the same figures when recalculation is retried', async () => {
    const harness = harnessFor(TENANT_A);

    await asTenant(TENANT_A, async () => {
      const { employmentId } = await start(harness);

      await record(harness, employmentId, 'clock_in', punchAt('08:00'));
      await record(harness, employmentId, 'clock_out', punchAt('17:00'));
      await send(harness, { commandName: 'attendance.recalculate' });

      const first = await readDay(harness, employmentId);

      await send(harness, {
        commandName: 'attendance.recalculate',
        employmentId,
        attendanceDate: '2026-05-04',
      });

      const second = await readDay(harness, employmentId);

      expect(second.day.inputsDigest).toBe(first.day.inputsDigest);
      expect(second.day.workedMinutes).toBe(first.day.workedMinutes);
      expect(second.day.workedMinutes).toBe(540);
      expect(second.day.calculationVersion).toBe(first.day.calculationVersion);
    });
  });
});
