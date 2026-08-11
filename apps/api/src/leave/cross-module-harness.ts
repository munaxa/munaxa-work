import 'reflect-metadata';

import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
  type WorkModule,
} from '@work/kernel';
import {
  ALL_ATTENDANCE_PERMISSIONS,
  attendanceModule,
  inMemoryAttendanceStores,
  systemClock as attendanceClock,
} from '@work/attendance';
import {
  ALL_EMPLOYMENT_PERMISSIONS,
  FakeOrganization,
  FakePeople,
  employmentModule,
  inMemoryEmploymentStores,
} from '@work/employment';
import { ALL_LEAVE_PERMISSIONS, FixedClock, inMemoryLeaveStores, leaveModule } from '@work/leave';
import { InMemoryUnitOfWork } from '@work/testing';

import {
  LeaveEmploymentDirectory,
  LeaveWorkingDayDirectory,
  type Asking,
} from './leave.composition.js';
import { AttendanceLeaveDirectory } from '../attendance/leave.directory.js';

/**
 * The wiring the cross-module suite runs against: Employment, Attendance and Leave on **one real
 * dispatcher**, connected by the real adapters the composition root builds.
 *
 * Apart from the assertions because it is a composition rather than a test, and because the
 * assertions are the part worth reading. Only the database, People and Organization are fakes here;
 * `LeaveEmploymentDirectory`, `LeaveWorkingDayDirectory` and `AttendanceLeaveDirectory` are the
 * production classes.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-06-15T09:00:00Z');
export const LEAVE_DATE = '2026-06-16';
export const ZONE = 'Asia/Amman';

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

export interface Wired {
  readonly dispatcher: Dispatcher;
  readonly people: FakePeople;
  readonly leaveUnavailable: () => void;
  readonly leaveRestored: () => void;
}

/**
 * The three modules, the two real adapters, and one dispatcher.
 *
 * The adapters are the ones `leave.composition.ts` and `attendance/leave.directory.ts` build for
 * production. Only the database, People and Organization are fakes.
 */
export const wire = (): Wired => {
  const dispatcher = new Dispatcher(
    permitting(
      ...ALL_ATTENDANCE_PERMISSIONS,
      ...ALL_EMPLOYMENT_PERMISSIONS,
      ...ALL_LEAVE_PERMISSIONS,
    ),
  );
  const work = new InMemoryUnitOfWork(TENANT);
  const people = new FakePeople();
  const clock = new FixedClock(NOW);
  let available = true;

  // The seam every adapter asks through. `available` is what the honest-failure assertion flips:
  // a Leave that throws must become "nobody could be asked", not "no leave approved".
  const asking: Asking = {
    ask: <TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> => {
      if (!available && query.queryName.startsWith('leave.')) {
        throw new Error('Leave is unavailable.');
      }
      return dispatcher.ask<TResult>(query);
    },
  };

  register(dispatcher, modulesFor({ dispatcher, work, people, asking, clock }));

  return {
    dispatcher,
    people,
    leaveUnavailable: () => {
      available = false;
    },
    leaveRestored: () => {
      available = true;
    },
  };
};

interface Assembly {
  readonly dispatcher: Dispatcher;
  readonly work: InMemoryUnitOfWork;
  readonly people: FakePeople;
  readonly asking: Asking;
  readonly clock: FixedClock;
}

/**
 * The three modules, each with the real adapter for the module next door.
 *
 * `AttendanceLeaveDirectory`, `LeaveEmploymentDirectory` and `LeaveWorkingDayDirectory` are the
 * production classes the composition root builds. Only People and Organization are fakes.
 */
const modulesFor = (assembly: Assembly): readonly WorkModule[] => [
  employmentModule(
    {
      unitOfWork: assembly.work,
      stores: inMemoryEmploymentStores(),
      people: assembly.people,
      organization: new FakeOrganization(),
      clock: attendanceClock,
    },
    { send: (command) => assembly.dispatcher.send(command) },
  ),
  attendanceModule(
    {
      unitOfWork: assembly.work,
      stores: inMemoryAttendanceStores(),
      employment: attendanceEmployment(assembly.dispatcher),
      // The real Leave adapter, reading the real Leave module through the real dispatcher.
      leave: new AttendanceLeaveDirectory(assembly.asking),
      clock: attendanceClock,
    },
    { send: (command) => assembly.dispatcher.send(command) },
  ),
  leaveModule({
    unitOfWork: assembly.work,
    stores: inMemoryLeaveStores(),
    // The real Employment and Attendance adapters, both asking the same dispatcher.
    employment: new LeaveEmploymentDirectory({
      ask: (query) => assembly.dispatcher.ask(query),
    }),
    workingDays: new LeaveWorkingDayDirectory({
      ask: (query) => assembly.dispatcher.ask(query),
    }),
    clock: assembly.clock,
  }),
];

const register = (dispatcher: Dispatcher, modules: readonly WorkModule[]): void => {
  for (const module of modules) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
};

/** Attendance's own Employment adapter, minimal here because its own suite covers it in full. */
const attendanceEmployment = (dispatcher: Dispatcher) => ({
  find: async (employmentId: string) => {
    const found = await dispatcher.ask<{
      readonly employment: { readonly employmentId: string; readonly startDate: string };
      readonly statusOn?: string;
    }>({ queryName: 'employment.read-employment', employmentId } as never);

    if (!found.ok) return undefined;

    return {
      employmentId: found.value.employment.employmentId,
      status: found.value.statusOn ?? 'active',
      startDate: found.value.employment.startDate,
    };
  },
  activeEmployments: () => Promise.resolve([]),
});

export const asTenant = <TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult> =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, work);

export const send = async <TResult>(
  wired: Wired,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.send<TResult>(command as never);

  if (!result.ok) {
    throw new Error(`${String(command['commandName'])} refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

export const ask = async <TResult>(
  wired: Wired,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.ask<TResult>(query as never);

  if (!result.ok) {
    throw new Error(`${String(query['queryName'])} refused: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};

export interface Ready {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly shiftId: string;
}

/** An employment on a published schedule, and a published leave policy that governs it. */
export const configured = async (wired: Wired): Promise<Ready> => {
  const personId = wired.people.add(uuidV7(), { en: 'Rania Odeh', ar: 'رانيا عودة' });
  const created = await send<{ employmentId: string }>(wired, {
    commandName: 'employment.create-employment',
    personId,
    employmentTypeCode: 'full-time',
    startDate: '2024-01-15',
  });

  await send(wired, {
    commandName: 'employment.change-status',
    employmentId: created.employmentId,
    status: 'active',
    expectedVersion: 1,
  });

  const shiftId = await attendanceConfigured(wired, created.employmentId);

  const type = await send<{ leaveTypeId: string }>(wired, {
    commandName: 'leave.define-type',
    code: 'holiday',
    name: { en: 'Holiday', ar: 'عطلة' },
    unit: 'days',
    paidTreatmentCode: 'full-pay',
  });

  await send(wired, {
    commandName: 'leave.publish-type',
    leaveTypeId: type.leaveTypeId,
    expectedVersion: 1,
  });

  const policy = await send<{ leavePolicyId: string }>(wired, {
    commandName: 'leave.define-policy',
    leaveTypeId: type.leaveTypeId,
    code: 'standard',
    name: { en: 'Standard', ar: 'قياسي' },
    effectiveFrom: '2020-01-01',
    approvalsRequired: 1,
    limits: { maximumBackdateDays: 365 },
  });

  await send(wired, {
    commandName: 'leave.publish-policy',
    leavePolicyId: policy.leavePolicyId,
    expectedVersion: 1,
  });
  await send(wired, {
    commandName: 'leave.assign-policy',
    leavePolicyId: policy.leavePolicyId,
    scope: 'tenant',
    effectiveFrom: '2020-01-01',
  });
  await send(wired, {
    commandName: 'leave.grant-entitlement',
    employmentId: created.employmentId,
    leaveTypeId: type.leaveTypeId,
    onDate: '2026-01-01',
    grantedMinutes: 9600,
    source: 'opening',
  });

  return { employmentId: created.employmentId, leaveTypeId: type.leaveTypeId, shiftId };
};

/** A published shift, a published schedule and an assignment — the working pattern Leave reads. */
const attendanceConfigured = async (wired: Wired, employmentId: string): Promise<string> => {
  const policy = await send<{ policyId: string }>(wired, {
    commandName: 'attendance.define-policy',
    code: 'standard',
    name: { en: 'Standard', ar: 'قياسي' },
    effectiveFrom: '2020-01-01',
  });

  await send(wired, {
    commandName: 'attendance.publish-policy',
    policyId: policy.policyId,
    expectedVersion: 1,
  });

  const shift = await send<{ shiftId: string }>(wired, {
    commandName: 'attendance.define-shift',
    code: 'day',
    name: { en: 'Day shift', ar: 'وردية نهارية' },
    kind: 'fixed',
    startLocal: '08:00',
    endLocal: '16:00',
  });

  await send(wired, {
    commandName: 'attendance.add-shift-segment',
    shiftId: shift.shiftId,
    sequence: 1,
    kind: 'work',
    startLocal: '08:00',
    endLocal: '16:00',
    paid: true,
  });
  await send(wired, {
    commandName: 'attendance.publish-shift',
    shiftId: shift.shiftId,
    expectedVersion: 1,
  });

  return scheduleFor(wired, employmentId, shift.shiftId);
};

/** The schedule the shift is placed in, and the assignment that puts the employment on it. */
const scheduleFor = async (
  wired: Wired,
  employmentId: string,
  shiftId: string,
): Promise<string> => {
  const schedule = await send<{ scheduleId: string }>(wired, {
    commandName: 'attendance.define-schedule',
    code: 'weekly',
    name: { en: 'Weekly', ar: 'أسبوعي' },
    zone: ZONE,
    cycleLengthDays: 1,
    cycleAnchorDate: '2026-01-01',
  });

  await send(wired, {
    commandName: 'attendance.place-shift',
    scheduleId: schedule.scheduleId,
    cyclePosition: 0,
    shiftId,
  });
  await send(wired, {
    commandName: 'attendance.publish-schedule',
    scheduleId: schedule.scheduleId,
    expectedVersion: 1,
  });
  await send(wired, {
    commandName: 'attendance.assign-schedule',
    employmentId,
    scheduleId: schedule.scheduleId,
    effectiveFrom: '2024-01-15',
  });

  return shiftId;
};
