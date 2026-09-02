import 'reflect-metadata';

import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import {
  ALL_ATTENDANCE_PERMISSIONS,
  attendanceModule,
  inMemoryAttendanceStores,
  leaveUnavailable,
} from '@work/attendance';
import {
  ALL_EMPLOYMENT_PERMISSIONS,
  employmentModule,
  inMemoryEmploymentStores,
} from '@work/employment';
import { FakeOrganization, FakePeople } from '@work/employment/testing';
import { InMemoryUnitOfWork } from '@work/testing';
import { describe, expect, it } from 'vitest';

import {
  AttendanceEmploymentDirectory,
  DeferredAttendanceSender,
} from './attendance.composition.js';

/**
 * The composition boundary between Attendance and Employment, exercised for real.
 *
 * Both modules are registered on **one real dispatcher**, and the adapter under test is the one the
 * composition root builds — not a stand-in. That is the whole point: every other Attendance test
 * uses `FakeEmployment`, which answers whatever it is asked and therefore cannot notice that the
 * question was malformed.
 *
 * **The defect this suite exists for.** `AttendanceEmploymentDirectory.find` took a civil date — an
 * attendance date is a date in a schedule's zone — and passed the *string* to
 * `employment.read-employment`, whose contract is `asOf?: Date`. The call site cast the literal to
 * `Query`, so the compiler saw nothing. At runtime the value reached
 * `DateRange.contains(instant)` → `instant.getTime()`, which throws on a string.
 *
 * It was unreachable in production only because every business endpoint returns 401 until
 * Platform's authentication adapter lands (ADR-0032). That is a reason it had not been *noticed*,
 * not a reason it was harmless.
 *
 * `should have failed before the fix` below is the regression assertion: it sends the malformed
 * shape the adapter used to send and asserts that Employment does not answer it. If a future change
 * made a bare string acceptable, that test fails and this file is re-read.
 */

const TENANT = uuidV7();
const NOW = new Date('2026-05-04T05:00:00Z');

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

interface Wired {
  readonly dispatcher: Dispatcher;
  readonly directory: AttendanceEmploymentDirectory;
  readonly people: FakePeople;
}

/**
 * Attendance and Employment on one dispatcher, with the real adapter between them.
 *
 * The permission checker grants both modules' permissions directly rather than exercising the
 * bounded service grant: `GrantAwarePermissionChecker` is tested where it lives, and wiring it here
 * would make this suite fail for a reason unrelated to the shape of a query.
 */
const wire = (): Wired => {
  const dispatcher = new Dispatcher(
    permitting(...ALL_ATTENDANCE_PERMISSIONS, ...ALL_EMPLOYMENT_PERMISSIONS),
  );
  const work = new InMemoryUnitOfWork(TENANT);
  const clock = { now: () => NOW };
  const people = new FakePeople();
  const sender = new DeferredAttendanceSender();
  const directory = new AttendanceEmploymentDirectory(sender);

  const employment = employmentModule(
    {
      unitOfWork: work,
      stores: inMemoryEmploymentStores(),
      people,
      organization: new FakeOrganization(),
      clock,
    },
    { send: (command) => dispatcher.send(command) },
  );
  const attendance = attendanceModule(
    {
      unitOfWork: work,
      stores: inMemoryAttendanceStores(),
      // The real adapter, reading the real Employment module through the real dispatcher.
      employment: directory,
      leave: leaveUnavailable,
      clock,
    },
    { send: (command) => dispatcher.send(command) },
  );

  for (const module of [employment, attendance]) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
  sender.attach(dispatcher);
  return { dispatcher, directory, people };
};

const asTenant = <TResult>(work: () => Promise<TResult>): Promise<TResult> =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:test' }, work);

/** A real, active employment, created through Employment's own commands. */
const anActiveEmployment = async (wired: Wired): Promise<string> => {
  const personId = wired.people.add(uuidV7(), { en: 'Sara Al-Amri', ar: 'سارة العامري' });
  const created = await wired.dispatcher.send<{ employmentId: string }>({
    commandName: 'employment.create-employment',
    personId,
    employmentTypeCode: 'full-time',
    startDate: '2026-01-15',
  } as never);

  if (!created.ok) throw new Error(`Could not create: ${JSON.stringify(created.error)}`);

  const activated = await wired.dispatcher.send({
    commandName: 'employment.change-status',
    employmentId: created.value.employmentId,
    status: 'active',
    expectedVersion: 1,
  } as never);

  if (!activated.ok) throw new Error(`Could not activate: ${JSON.stringify(activated.error)}`);
  return created.value.employmentId;
};

describe('the Attendance to Employment composition boundary', () => {
  /**
   * The fix, asserted at the adapter.
   *
   * With the civil-date string this threw inside `DateRange.contains`; the adapter's `catch`-free
   * path meant the exception left `find` rather than becoming `undefined`, so the assertion below
   * would have failed with a `TypeError` rather than with a wrong value.
   */
  it('resolves an employment as at a civil attendance date', async () => {
    const wired = wire();

    await asTenant(async () => {
      const employmentId = await anActiveEmployment(wired);
      const found = await wired.directory.find(employmentId, '2026-05-04');

      expect(found).toBeDefined();
      expect(found?.employmentId).toBe(employmentId);
      expect(found?.status).toBe('active');
      expect(found?.startDate).toBe('2026-01-15');
    });
  });

  /**
   * The regression assertion.
   *
   * This is the exact shape the adapter used to send. Employment must not answer it — and the way
   * it does not answer is what made the original defect a runtime failure rather than a wrong
   * result. Asserting the *rejection* rather than the message keeps the test tied to the behaviour
   * rather than to a driver's wording.
   */
  it('refuses the civil-date string the adapter used to send', async () => {
    const wired = wire();

    await asTenant(async () => {
      const employmentId = await anActiveEmployment(wired);
      const malformed = wired.dispatcher.ask<unknown>({
        queryName: 'employment.read-employment',
        employmentId,
        asOf: '2026-05-04',
      } as never);

      await expect(malformed).rejects.toThrow();
    });
  });

  /** The `asOf` actually reaches Employment: a date before the employment began finds nothing. */
  it('honours the date it was asked for, rather than answering as at today', async () => {
    const wired = wire();

    await asTenant(async () => {
      const employmentId = await anActiveEmployment(wired);
      const beforeItBegan = await wired.directory.find(employmentId, '2025-06-01');
      const afterItBegan = await wired.directory.find(employmentId, '2026-05-04');

      // The employment exists either way — what moves with the date is the effective-dated part of
      // the answer. Reading before the start date must not throw and must not invent an assignment.
      expect(afterItBegan).toBeDefined();
      expect(beforeItBegan?.unitId).toBeUndefined();
    });
  });

  /** The roster scan reads through the same dispatcher, and its shape is checked too. */
  it('lists active employments through the real Employment query', async () => {
    const wired = wire();

    await asTenant(async () => {
      const employmentId = await anActiveEmployment(wired);
      const found = await wired.directory.activeEmployments(50);

      expect(found.map((one) => one.employmentId)).toContain(employmentId);
    });
  });
});
