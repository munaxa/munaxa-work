import {
  Dispatcher,
  runInContext,
  uuidV7,
  type Command,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
} from '@work/kernel';
import { InMemoryUnitOfWork, permitting } from '@work/testing';

import { attendanceModule } from './attendance-module.js';
import {
  inMemoryAttendanceStores,
  type InMemoryAttendanceStores,
} from './in-memory-definitions.js';
import { ALL_ATTENDANCE_PERMISSIONS } from './attendance-permissions.js';
import type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForAttendance,
  LeaveCoverage,
  LeaveDirectoryPort,
} from './cross-module-ports.js';
import type { CommandSender } from './transfer.use-case.js';

/**
 * The harness this module's application-service tests share.
 *
 * Everything goes through `Dispatcher` rather than calling handlers directly, because the pipeline
 * is where tenancy and authorization are applied — a test that bypassed it would prove a handler
 * works for a caller who was never checked.
 *
 * The two cross-module ports are **fakes with the properties that matter**, not mocks. Employment
 * can be told an employment has ended; Leave can be told to answer "unknown", "no leave" or
 * "approved leave". Those three answers are the ones this phase turns on, and a test asserting on a
 * mock call would prove none of them.
 */

export const TENANT_A = uuidV7();
export const TENANT_B = uuidV7();

/** Mutable so a test can move time forward, and fixed so nothing is flaky. */
export const testClock = {
  value: new Date('2026-05-04T09:00:00Z'),
  reset(): void {
    this.value = new Date('2026-05-04T09:00:00Z');
  },
};

export const clock: Clock = { now: () => testClock.value };

export const ALL = ALL_ATTENDANCE_PERMISSIONS;

/**
 * A stand-in for Employment.
 *
 * It answers what the real adapter answers and nothing more: whether an employment exists in this
 * tenant, its status, its dates and — for scoping only — its unit and manager. No other employment
 * fact is reachable from this module, in the fake or in production, and there is no `create`.
 */
export class FakeEmployment implements EmploymentDirectoryPort {
  private readonly employments = new Map<string, EmploymentForAttendance>();

  public add(overrides: Partial<EmploymentForAttendance> = {}): EmploymentForAttendance {
    const employment: EmploymentForAttendance = {
      employmentId: overrides.employmentId ?? uuidV7(),
      status: overrides.status ?? 'active',
      startDate: overrides.startDate ?? '2026-01-01',
      ...(overrides.endDate === undefined ? {} : { endDate: overrides.endDate }),
      ...(overrides.unitId === undefined ? {} : { unitId: overrides.unitId }),
      ...(overrides.managerEmploymentId === undefined
        ? {}
        : { managerEmploymentId: overrides.managerEmploymentId }),
    };

    this.employments.set(employment.employmentId, employment);
    return employment;
  }

  public end(employmentId: string, endDate: string): void {
    const existing = this.employments.get(employmentId);

    if (existing !== undefined) {
      this.employments.set(employmentId, { ...existing, status: 'ended', endDate });
    }
  }

  public find(employmentId: string): Promise<EmploymentForAttendance | undefined> {
    return Promise.resolve(this.employments.get(employmentId));
  }

  public activeEmployments(limit: number): Promise<readonly EmploymentForAttendance[]> {
    return Promise.resolve(
      [...this.employments.values()].filter((one) => one.status !== 'ended').slice(0, limit),
    );
  }
}

/**
 * A stand-in for Leave, which can give all three answers.
 *
 * The default is `{ known: false }` — the answer the real repository gives, because there is no
 * Leave module. A test can switch it to "no leave" or to approved leave, and the difference is what
 * decides whether somebody's record says they were absent without leave or says the question is
 * open (ADR-0056).
 */
export class FakeLeave implements LeaveDirectoryPort {
  private answer: LeaveCoverage = { known: false };

  public unknown(): void {
    this.answer = { known: false };
  }

  public noLeave(): void {
    this.answer = { known: true, days: [] };
  }

  public approve(onDate: string, minutes?: number): void {
    const day = {
      onDate,
      coverage: minutes === undefined ? ('full_day' as const) : ('partial_day' as const),
      ...(minutes === undefined ? {} : { minutes }),
      leaveRequestId: uuidV7(),
    };
    const existing = this.answer.known ? this.answer.days : [];

    this.answer = { known: true, days: [...existing, day] };
  }

  public approvedLeaveFor(): Promise<LeaveCoverage> {
    return Promise.resolve(this.answer);
  }

  /**
   * The incremental read Attendance's reconciliation calls.
   *
   * The fake ignores `changedSince` and answers with whatever it holds: what the reconciliation
   * test is about is the *direction* — Attendance asking Leave and marking its own days — and a
   * fake that filtered by an instant would only be testing the fake.
   */
  public approvedLeaveAffecting(): Promise<LeaveCoverage> {
    return Promise.resolve(this.answer);
  }
}

export interface Harness {
  readonly stores: InMemoryAttendanceStores;
  readonly work: InMemoryUnitOfWork;
  readonly dispatcher: Dispatcher;
  readonly employment: FakeEmployment;
  readonly leave: FakeLeave;
}

export const harnessFor = (tenantId: string, granted: readonly string[] = ALL): Harness =>
  harnessWithStores(tenantId, inMemoryAttendanceStores(), granted);

/** A harness sharing existing stores and fakes, for the cross-tenant and concurrency tests. */
export const harnessWithStores = (
  tenantId: string,
  stores: InMemoryAttendanceStores,
  granted: readonly string[] = ALL,
  shared?: { readonly employment?: FakeEmployment; readonly leave?: FakeLeave },
): Harness => {
  const work = new InMemoryUnitOfWork(tenantId);
  const permissions: PermissionChecker = permitting(...granted);
  const dispatcher = new Dispatcher(permissions);
  const employment = shared?.employment ?? new FakeEmployment();
  const leave = shared?.leave ?? new FakeLeave();
  // The same deferred seam the composition root uses, so import is exercised through the real
  // dispatcher rather than through a shortcut only the tests have.
  const sender: CommandSender = { send: (command) => dispatcher.send(command) };
  const module = attendanceModule({ unitOfWork: work, stores, employment, leave, clock }, sender);

  for (const handler of module.commands ?? []) {
    dispatcher.registerCommand(handler);
  }
  for (const handler of module.queries ?? []) {
    dispatcher.registerQuery(handler);
  }
  return { stores, work, dispatcher, employment, leave };
};

export const send = <TResult>(
  harness: Harness,
  command: Command & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.send<TResult>(command);

export const ask = <TResult>(
  harness: Harness,
  query: Query & Record<string, unknown>,
): Promise<Result<TResult, HandlerFailure>> => harness.dispatcher.ask<TResult>(query);

/** Runs work inside a tenant context, as the request pipeline does in production. */
export const asTenant = <TResult>(
  tenantId: string,
  work: () => Promise<TResult>,
): Promise<TResult> =>
  runInContext({ tenantId, correlationId: uuidV7(), actor: `user:${uuidV7()}` }, work);

/** Runs work as a *named* actor, for the tests about who decided what. */
export const asActor = <TResult>(
  tenantId: string,
  actor: string,
  work: () => Promise<TResult>,
): Promise<TResult> => runInContext({ tenantId, correlationId: uuidV7(), actor }, work);

const expected = <TResult>(result: Result<TResult, HandlerFailure>, what: string): TResult => {
  if (!result.ok) throw new Error(`Could not ${what}: ${JSON.stringify(result.error)}`);
  return result.value;
};

export interface ConfiguredAttendance {
  readonly shiftId: string;
  readonly scheduleId: string;
  readonly policyId: string;
}

/**
 * A published policy, a published nine-to-five shift and a published weekly schedule that runs it
 * Monday to Friday, all through the real commands.
 *
 * Published through the commands rather than written into the store, because "a published
 * definition is immutable" and "a day records the version it used" are the rules several suites are
 * about, and a fixture that wrote rows directly would quietly disable them.
 */
export const aConfiguredSchedule = async (
  harness: Harness,
  overrides: { readonly zone?: string; readonly suffix?: string } = {},
): Promise<ConfiguredAttendance> => {
  const suffix = overrides.suffix ?? uuidV7().slice(-8);
  const policyId = await aPublishedPolicy(harness, suffix);
  const shiftId = await aPublishedDayShift(harness, suffix);
  const scheduleId = await aPublishedWeek(
    harness,
    suffix,
    shiftId,
    overrides.zone ?? 'Asia/Riyadh',
  );

  return { shiftId, scheduleId, policyId };
};

const aPublishedPolicy = async (harness: Harness, suffix: string): Promise<string> => {
  const policy = expected<{ policyId: string }>(
    await send(harness, {
      commandName: 'attendance.define-policy',
      code: `standard-${suffix}`,
      name: { en: 'Standard', ar: 'قياسي' },
      effectiveFrom: '2026-01-01',
    }),
    'define a policy',
  );

  expected(
    await send(harness, {
      commandName: 'attendance.publish-policy',
      policyId: policy.policyId,
      expectedVersion: 1,
    }),
    'publish the policy',
  );
  return policy.policyId;
};

const aPublishedDayShift = async (harness: Harness, suffix: string): Promise<string> => {
  const shift = expected<{ shiftId: string }>(
    await send(harness, {
      commandName: 'attendance.define-shift',
      code: `day-${suffix}`,
      name: { en: 'Day shift', ar: 'الوردية الصباحية' },
      kind: 'fixed',
      startLocal: '08:00',
      endLocal: '17:00',
    }),
    'define a shift',
  );

  expected(
    await send(harness, {
      commandName: 'attendance.add-shift-segment',
      shiftId: shift.shiftId,
      sequence: 1,
      kind: 'work',
      startLocal: '08:00',
      endLocal: '17:00',
    }),
    'add a work segment',
  );
  expected(
    await send(harness, {
      commandName: 'attendance.publish-shift',
      shiftId: shift.shiftId,
      expectedVersion: 1,
    }),
    'publish the shift',
  );
  return shift.shiftId;
};

const aPublishedWeek = async (
  harness: Harness,
  suffix: string,
  shiftId: string,
  zone: string,
): Promise<string> => {
  const schedule = expected<{ scheduleId: string }>(
    await send(harness, {
      commandName: 'attendance.define-schedule',
      code: `weekly-${suffix}`,
      name: { en: 'Weekly', ar: 'أسبوعي' },
      zone,
      cycleLengthDays: 7,
      // A Monday, so positions 0–4 are the working week.
      cycleAnchorDate: '2026-05-04',
    }),
    'define a schedule',
  );

  for (let position = 0; position < 5; position += 1) {
    expected(
      await send(harness, {
        commandName: 'attendance.place-shift',
        scheduleId: schedule.scheduleId,
        cyclePosition: position,
        shiftId,
      }),
      'place a shift',
    );
  }
  expected(
    await send(harness, {
      commandName: 'attendance.publish-schedule',
      scheduleId: schedule.scheduleId,
      expectedVersion: 1,
    }),
    'publish the schedule',
  );
  return schedule.scheduleId;
};

/** An employment that exists in the fakes, assigned to the schedule from a date. */
export const anAssignedEmployment = async (
  harness: Harness,
  configured: ConfiguredAttendance,
  overrides: Partial<EmploymentForAttendance> = {},
): Promise<string> => {
  const employment = harness.employment.add(overrides);

  expected(
    await send(harness, {
      commandName: 'attendance.assign-schedule',
      employmentId: employment.employmentId,
      scheduleId: configured.scheduleId,
      effectiveFrom: overrides.startDate ?? '2026-01-01',
    }),
    'assign the schedule',
  );
  return employment.employmentId;
};
