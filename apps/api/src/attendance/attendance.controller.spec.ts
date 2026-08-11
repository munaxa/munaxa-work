import 'reflect-metadata';

import type { Server } from 'node:http';

import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadEnvironment } from '@work/config';
import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  AttendanceController,
  AttendanceCorrectionController,
  AttendanceDayController,
  AttendanceDispatcher,
  AttendancePermissions,
  AttendanceRosterController,
  AttendanceScheduleController,
  AttendanceShiftController,
  AttendanceTransferController,
  FakeEmployment,
  FakeLeave,
  attendanceModule,
  inMemoryAttendanceStores,
  leaveUnavailable,
} from '@work/attendance';
import { InMemoryUnitOfWork } from '@work/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { configureApplication } from '../application.setup.js';
import { AuthenticatedTenantGuard } from '../tenancy/authenticated-tenant.guard.js';

/**
 * API tests for the Attendance endpoints.
 *
 * They exercise the real composition — the real dispatcher, the real pipeline, the real global
 * filter and validation pipe — because routing, prefixes and global filters are exactly where a
 * test that configured things slightly differently from production proves nothing about it.
 *
 * The route ordering assertion is not decoration. Every controller in this module claims the bare
 * `/attendance` prefix, and `days/:attendanceDayId/approval` and `days/:employmentId/:date` are the
 * same shape to a router. A controller declared in the wrong order makes one resolve to the other,
 * and no unit test would notice.
 *
 * The tenant context is established by a stand-in rather than by the real middleware:
 * `tenant.middleware.spec.ts` is where that is tested, and repeating it here would make these tests
 * fail for reasons unrelated to the endpoints.
 */

const TENANT = uuidV7();
const NOW = new Date('2026-05-04T05:00:00Z');

const environment = loadEnvironment({
  APP_NAME: 'munaxa-work-test',
  APP_VERSION: '0.0.0-test',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/work',
});

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

const ALL = Object.values(AttendancePermissions);

interface Wired {
  readonly application: INestApplication;
  readonly employment: FakeEmployment;
  readonly leave: FakeLeave;
}

const applicationWith = async (checker: PermissionChecker): Promise<Wired> => {
  const dispatcher = new Dispatcher(checker);
  const employment = new FakeEmployment();
  const leave = new FakeLeave();
  const module = attendanceModule(
    {
      unitOfWork: new InMemoryUnitOfWork(TENANT),
      stores: inMemoryAttendanceStores(),
      employment,
      leave,
      clock: { now: () => NOW },
    },
    // The same deferred seam the composition root uses, so import goes through the real dispatcher
    // here too rather than a shortcut only the tests have.
    { send: (command) => dispatcher.send(command) },
  );

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }

  const testing = await Test.createTestingModule({
    // The same order the Nest module declares, because that order is what makes
    // `POST /attendance/days/:id/approval` resolve to approval rather than to a day read.
    controllers: [
      AttendanceTransferController,
      AttendanceRosterController,
      AttendanceShiftController,
      AttendanceScheduleController,
      AttendanceCorrectionController,
      AttendanceDayController,
      AttendanceController,
    ],
    providers: [
      { provide: AttendanceDispatcher, useValue: new AttendanceDispatcher(dispatcher) },
      { provide: APP_GUARD, useClass: AuthenticatedTenantGuard },
    ],
  }).compile();

  const application = testing.createNestApplication();

  application.use((_request: unknown, _response: unknown, next: () => void) => {
    runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, next);
  });
  configureApplication(application, environment);
  await application.init();
  return { application, employment, leave };
};

describe('the Attendance endpoints', () => {
  let wired: Wired | undefined;

  afterEach(async () => {
    await wired?.application.close();
    wired = undefined;
  });

  const server = (): Server => wired?.application.getHttpServer() as Server;

  const openApplication = async (granted: readonly string[] = ALL): Promise<Wired> => {
    wired = await applicationWith(permitting(...granted));
    return wired;
  };

  const anEmployment = (): string => wired?.employment.add({}).employmentId ?? '';

  /** A published policy, shift and schedule, through the endpoints a customer would use. */
  const aConfiguredSchedule = async (): Promise<{ scheduleId: string; shiftId: string }> => {
    const policy = await request(server())
      .post('/api/v1/attendance/policies')
      .send({
        code: 'standard',
        name: { en: 'Standard', ar: 'قياسي' },
        effectiveFrom: '2026-01-01',
      })
      .expect(201);

    await request(server())
      .post(
        `/api/v1/attendance/policies/${(policy.body as { policyId: string }).policyId}/publication`,
      )
      .send({ expectedVersion: 1 })
      .expect(201);

    const shift = await request(server())
      .post('/api/v1/attendance/shifts')
      .send({
        code: 'day-shift',
        name: { en: 'Day shift', ar: 'الوردية الصباحية' },
        kind: 'fixed',
        startLocal: '08:00',
        endLocal: '17:00',
      })
      .expect(201);
    const shiftId = (shift.body as { shiftId: string }).shiftId;

    await request(server())
      .post(`/api/v1/attendance/shifts/${shiftId}/segments`)
      .send({ sequence: 1, kind: 'work', startLocal: '08:00', endLocal: '17:00' })
      .expect(201);
    await request(server())
      .post(`/api/v1/attendance/shifts/${shiftId}/publication`)
      .send({ expectedVersion: 1 })
      .expect(201);

    const schedule = await request(server())
      .post('/api/v1/attendance/schedules')
      .send({
        code: 'weekly',
        name: { en: 'Weekly', ar: 'أسبوعي' },
        zone: 'Asia/Riyadh',
        cycleLengthDays: 7,
        cycleAnchorDate: '2026-05-04',
      })
      .expect(201);
    const scheduleId = (schedule.body as { scheduleId: string }).scheduleId;

    await request(server())
      .post(`/api/v1/attendance/schedules/${scheduleId}/placements`)
      .send({ cyclePosition: 0, shiftId })
      .expect(201);
    await request(server())
      .post(`/api/v1/attendance/schedules/${scheduleId}/publication`)
      .send({ expectedVersion: 1 })
      .expect(201);
    return { scheduleId, shiftId };
  };

  const anAssignedEmployment = async (scheduleId: string): Promise<string> => {
    const employmentId = anEmployment();

    await request(server())
      .post(`/api/v1/attendance/schedules/${scheduleId}/assignments`)
      .send({ employmentId, effectiveFrom: '2026-01-01' })
      .expect(201);
    return employmentId;
  };

  /**
   * The property the whole module rests on, at the edge a punch clock actually retries against.
   *
   * A retried `POST` is a success naming the same event — not a 409 the device has to interpret,
   * and not a second punch.
   */
  it('returns the same event when a punch is submitted twice', async () => {
    await openApplication();

    const { scheduleId } = await aConfiguredSchedule();
    const employmentId = await anAssignedEmployment(scheduleId);
    const body = {
      employmentId,
      kind: 'clock_in',
      source: 'device',
      idempotencyKey: 'turnstile-000001',
      reportedAt: NOW.toISOString(),
    };
    const first = await request(server()).post('/api/v1/attendance/events').send(body).expect(201);
    const again = await request(server()).post('/api/v1/attendance/events').send(body).expect(201);

    expect((first.body as { alreadyRecorded: boolean }).alreadyRecorded).toBe(false);
    expect((again.body as { alreadyRecorded: boolean }).alreadyRecorded).toBe(true);
    expect((again.body as { eventId: string }).eventId).toBe(
      (first.body as { eventId: string }).eventId,
    );
  });

  /**
   * The route-ordering assertion.
   *
   * `POST /attendance/days/:attendanceDayId/approval` belongs to the review controller and
   * `GET /attendance/days/:employmentId/:attendanceDate` to the main one. They are declared in this
   * order for that reason, and this test is what would fail if somebody reordered them.
   */
  it('routes a day read and a day approval to different controllers', async () => {
    await openApplication();

    const { scheduleId } = await aConfiguredSchedule();
    const employmentId = await anAssignedEmployment(scheduleId);

    await request(server())
      .post('/api/v1/attendance/events')
      .send({ employmentId, kind: 'clock_in', source: 'device', reportedAt: NOW.toISOString() })
      .expect(201);
    await request(server()).post('/api/v1/attendance/recalculation').send({}).expect(201);

    const day = await request(server())
      .get(`/api/v1/attendance/days/${employmentId}/2026-05-04`)
      .expect(200);
    const snapshot = day.body as {
      day: { attendanceDayId: string; version: number; zone: string };
      exceptions: readonly { kind: string }[];
    };

    expect(snapshot.day.zone).toBe('Asia/Riyadh');
    // The clock-out never came, so approval is refused — by the review controller, which is what
    // proves the route resolved there rather than to the day read.
    expect(snapshot.exceptions.map((one) => one.kind)).toContain('missing_clock_out');

    await request(server())
      .post(`/api/v1/attendance/days/${snapshot.day.attendanceDayId}/approval`)
      .send({ expectedVersion: snapshot.day.version })
      .expect(422);
  });

  /** `reconciliation` and `dashboard` are literals, not employment identifiers. */
  it('routes the reconciliation and dashboard reads to their own handlers', async () => {
    await openApplication();

    const reconciliation = await request(server())
      .get('/api/v1/attendance/reconciliation')
      .expect(200);
    const dashboard = await request(server())
      .get('/api/v1/attendance/dashboard?onDate=2026-05-04')
      .expect(200);

    expect((reconciliation.body as { total: number }).total).toBe(0);
    expect((dashboard.body as { onDate: string }).onDate).toBe('2026-05-04');
  });

  /** A caller without the permission is refused by the pipeline, before any handler runs. */
  it('refuses a punch from a caller without the recording permission', async () => {
    await openApplication(ALL.filter((one) => one !== AttendancePermissions.eventRecord));

    await request(server())
      .post('/api/v1/attendance/events')
      .send({
        employmentId: uuidV7(),
        kind: 'clock_in',
        source: 'device',
        reportedAt: NOW.toISOString(),
      })
      .expect(403);
  });

  /** A malformed body is 400 — the client can fix it — and never 422. */
  it('rejects a malformed punch with 400 rather than 422', async () => {
    await openApplication();

    await request(server())
      .post('/api/v1/attendance/events')
      .send({ employmentId: 'not-a-uuid', kind: 'teleported', source: 'device' })
      .expect(400);
  });

  /**
   * Leave, at the edge.
   *
   * The default adapter in this repository answers "nobody can be asked", and the day says so
   * rather than asserting an absence without leave (ADR-0056).
   */
  it('reports an unexplained absence as pending explanation while Leave cannot be asked', async () => {
    await openApplication();

    const { scheduleId, shiftId } = await aConfiguredSchedule();
    const employmentId = await anAssignedEmployment(scheduleId);

    await request(server())
      .post('/api/v1/attendance/roster')
      .send({ employmentId, onDate: '2026-05-04', kind: 'shift', shiftId })
      .expect(201);
    await request(server()).post('/api/v1/attendance/recalculation').send({}).expect(201);

    const day = await request(server())
      .get(`/api/v1/attendance/days/${employmentId}/2026-05-04`)
      .expect(200);
    const snapshot = day.body as {
      day: { leaveState: string };
      exceptions: readonly { kind: string }[];
    };

    expect(snapshot.day.leaveState).toBe('unknown');
    expect(snapshot.exceptions.map((one) => one.kind)).toContain('absence_pending_explanation');
    expect(snapshot.exceptions.map((one) => one.kind)).not.toContain('absent_unexplained');
  });

  /** The adapter the composition root actually wires answers "unknown", and says so out loud. */
  it('ships a Leave adapter that admits it cannot answer', async () => {
    await expect(
      leaveUnavailable.approvedLeaveFor('any', '2026-05-01', '2026-05-31'),
    ).resolves.toEqual({ known: false });
  });
});
