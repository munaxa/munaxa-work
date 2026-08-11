import 'reflect-metadata';

import {
  Dispatcher,
  runInContext,
  uuidV7,
  type HandlerFailure,
  type PermissionChecker,
  type Query,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';
import {
  ALL_EMPLOYMENT_PERMISSIONS,
  FakeOrganization as FakeEmploymentOrganization,
  FakePeople,
  employmentModule,
  inMemoryEmploymentStores,
} from '@work/employment';
import {
  ALL_COMPENSATION_PERMISSIONS,
  FixedClock,
  compensationModule,
  inMemoryCompensationStores,
} from '@work/compensation';
import { ALL_PAYROLL_PERMISSIONS, inMemoryPayrollStores, payrollModule } from '@work/payroll';
import { InMemoryUnitOfWork } from '@work/testing';

import {
  CompensationEmploymentDirectory,
  CompensationOrganizationDirectory,
} from '../compensation/compensation.composition.js';
import type { Asking } from './asking.js';
import { PayrollCompensationSource, PayrollEmploymentSource } from './payroll-sources.js';
import {
  PayrollAttendanceSource,
  PayrollLeaveSource,
  PayrollOrganizationSource,
} from './payroll-period-sources.js';

/**
 * The wiring the cross-module suite runs against: Employment, Compensation and Payroll on **one
 * real dispatcher**, connected by the real adapters the composition root builds.
 *
 * Apart from the assertions because it is a composition rather than a test. Only the database,
 * People and Organization are fakes; `PayrollEmploymentSource`, `PayrollCompensationSource`,
 * `PayrollAttendanceSource`, `PayrollLeaveSource` and `PayrollOrganizationSource` are the
 * **production classes**, and every cross-module call goes through the real bounded service grant.
 *
 * Attendance and Leave are represented by **stub query handlers on the same dispatcher** rather
 * than by fake ports. That distinction matters: the adapter under test still sends
 * `attendance.read-snapshots` and `leave.payroll-period` through the dispatcher, still runs inside
 * its grant, and still maps the published view — so a change to either contract's *shape* breaks
 * this suite, which is the whole point of testing an adapter rather than a mock of one.
 *
 * `suppressEvents` is what makes the lost-event assertion honest: the dispatcher is told to drop
 * everything it would have published, and the payroll still finds the change.
 */

export const TENANT = uuidV7();
export const NOW = new Date('2026-07-01T09:00:00Z');

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

export interface AttendanceStub {
  readonly employmentId: string;
  sequence: number;
  inputsDigest: string;
  overtimeCandidateMinutes: number;
  unpaidMinutes: number;
  blockingExceptions: number;
  leaveState: string;
}

export interface LeaveStub {
  readonly employmentId: string;
  inputsDigest: string;
  lines: readonly {
    readonly leaveTypeId: string;
    readonly leaveTypeCode: string;
    readonly paidTreatmentCode: string;
    readonly minutes: number;
    readonly days: number;
  }[];
}

export interface Wired {
  readonly dispatcher: Dispatcher;
  readonly people: FakePeople;
  readonly attendance: Map<string, AttendanceStub>;
  readonly leave: Map<string, LeaveStub>;
  readonly organizationUnavailable: () => void;
  readonly leaveUnavailable: () => void;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

/**
 * Where the three modules keep their rows.
 *
 * The default is in-memory, which is what the behavioural cross-module suite wants: it is asking
 * whether the *modules* agree with each other, and a database would only slow that question down.
 * `payroll.production-scenario.spec.ts` passes real PostgreSQL stores and a real unit of work
 * through the same wiring, so the production scenario exercises the same composition rather than a
 * second one assembled to look like it.
 */
export interface Persistence {
  readonly unitOfWork: UnitOfWork;
  readonly employment: EmploymentStoresFor;
  readonly compensation: CompensationStoresFor;
  readonly payroll: PayrollStoresFor;
}

// Taken from what each module's factory accepts rather than from the in-memory factory's return
// type: the fakes are structurally *wider* (they expose their rows for assertions), and typing the
// seam by them would refuse the real repositories.
type EmploymentStoresFor = Parameters<typeof employmentModule>[0]['stores'];
type CompensationStoresFor = Parameters<typeof compensationModule>[0]['stores'];
type PayrollStoresFor = Parameters<typeof payrollModule>[0]['stores'];

const inMemory = (): Persistence => ({
  unitOfWork: new InMemoryUnitOfWork(TENANT),
  employment: inMemoryEmploymentStores(),
  compensation: inMemoryCompensationStores(),
  payroll: inMemoryPayrollStores(),
});

export const wire = (persistence: Persistence = inMemory()): Wired => {
  const dispatcher = new Dispatcher(
    permitting(
      ...ALL_EMPLOYMENT_PERMISSIONS,
      ...ALL_COMPENSATION_PERMISSIONS,
      ...ALL_PAYROLL_PERMISSIONS,
      'attendance.read',
      'leave.read',
      'organization.legal-entity.read',
    ),
  );
  const work = persistence.unitOfWork;
  const people = new FakePeople();
  const clock = new FixedClock(NOW);
  const attendance = new Map<string, AttendanceStub>();
  const leave = new Map<string, LeaveStub>();
  let organizationAvailable = true;
  let leaveAvailable = true;

  const asking: Asking = {
    ask: <TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> =>
      dispatcher.ask<TResult>(query),
  };

  register(dispatcher, modulesFor({ dispatcher, work, people, clock, asking, persistence }));

  registerSourceStubs(dispatcher, {
    attendance,
    leave,
    organizationAvailable: () => organizationAvailable,
    leaveAvailable: () => leaveAvailable,
  });

  return {
    dispatcher,
    people,
    attendance,
    leave,
    organizationUnavailable: () => {
      organizationAvailable = false;
    },
    leaveUnavailable: () => {
      leaveAvailable = false;
    },
    as: (actor, body) => runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor }, body),
  };
};

interface Wiring {
  readonly dispatcher: Dispatcher;
  readonly work: UnitOfWork;
  readonly people: FakePeople;
  readonly clock: FixedClock;
  readonly asking: Asking;
  readonly persistence: Persistence;
}

/** Three real modules on one dispatcher, connected by the production adapters. */
const modulesFor = ({
  dispatcher,
  work,
  people,
  clock,
  asking,
  persistence,
}: Wiring): readonly WorkModule[] => [
  employmentModule(
    {
      unitOfWork: work,
      stores: persistence.employment,
      people,
      organization: new FakeEmploymentOrganization(),
      clock,
    },
    { send: (command) => dispatcher.send(command) },
  ),
  compensationModule({
    unitOfWork: work,
    stores: persistence.compensation,
    employment: new CompensationEmploymentDirectory(asking),
    organization: new CompensationOrganizationDirectory(asking),
    clock,
  }),
  payrollModule({
    unitOfWork: work,
    stores: persistence.payroll,
    // The production adapters, not fakes. This is the point of the suite.
    employment: new PayrollEmploymentSource(asking),
    compensation: new PayrollCompensationSource(asking),
    attendance: new PayrollAttendanceSource(asking),
    leave: new PayrollLeaveSource(asking),
    organization: new PayrollOrganizationSource(asking),
    countryRules: { apply: () => undefined },
    clock,
  }),
];

interface Stubs {
  readonly attendance: Map<string, AttendanceStub>;
  readonly leave: Map<string, LeaveStub>;
  readonly organizationAvailable: () => boolean;
  readonly leaveAvailable: () => boolean;
}

/**
 * Attendance, Leave and Organization as **query handlers on the real dispatcher**.
 *
 * They answer in the published views' own shapes, so the production adapters map real contract
 * payloads rather than convenient objects. Attendance and Leave are not otherwise present in this
 * composition — registering their whole modules would drag in their schedules, ledgers and
 * calendars, which this suite is not about.
 */
const registerSourceStubs = (dispatcher: Dispatcher, stubs: Stubs): void => {
  registerAttendance(dispatcher, stubs);
  registerLeaveAndOrganization(dispatcher, stubs);
};

const registerAttendance = (dispatcher: Dispatcher, stubs: Stubs): void => {
  dispatcher.registerQuery({
    queryName: 'attendance.read-snapshots',
    permission: 'attendance.read',
    handle: (query: Query & { readonly periodStart: string; readonly periodEnd: string }) =>
      Promise.resolve({
        ok: true,
        value: [...stubs.attendance.values()].map((stub) => ({
          snapshotId: uuidV7(),
          employmentId: stub.employmentId,
          periodStart: query.periodStart,
          periodEnd: query.periodEnd,
          sequence: stub.sequence,
          frozenAt: NOW,
          frozenBy: 'user:attendance',
          workedMinutes: 9_600,
          regularCandidateMinutes: 9_600,
          overtimeCandidateMinutes: stub.overtimeCandidateMinutes,
          unpaidMinutes: stub.unpaidMinutes,
          absenceMinutes: 0,
          leaveMinutes: 0,
          leaveState: stub.leaveState,
          daysTotal: 30,
          daysApproved: 30,
          daysUnapproved: 0,
          blockingExceptions: stub.blockingExceptions,
          calculationVersion: 1,
          inputsDigest: stub.inputsDigest,
        })),
      }),
  } as never);
};

const registerLeaveAndOrganization = (dispatcher: Dispatcher, stubs: Stubs): void => {
  dispatcher.registerQuery({
    queryName: 'leave.payroll-period',
    permission: 'leave.read',
    handle: (query: Query & { readonly periodStart: string; readonly periodEnd: string }) =>
      Promise.resolve(
        stubs.leaveAvailable()
          ? {
              ok: true as const,
              value: {
                items: [...stubs.leave.values()].map((stub) => ({
                  employmentId: stub.employmentId,
                  periodStart: query.periodStart,
                  periodEnd: query.periodEnd,
                  lines: stub.lines,
                  encashableMinutes: 0,
                  calculationVersion: 1,
                  inputsDigest: stub.inputsDigest,
                })),
              },
            }
          : { ok: false as const, error: { kind: 'unavailable', reason: 'leave_unavailable' } },
      ),
  } as never);

  dispatcher.registerQuery({
    queryName: 'organization.governing-legal-entity',
    permission: 'organization.legal-entity.read',
    handle: (query: Query & { readonly unitId: string }) =>
      Promise.resolve(
        stubs.organizationAvailable()
          ? {
              ok: true as const,
              value: {
                legalEntity: {
                  id: query.unitId,
                  countryCode: 'JO',
                  currencyCode: 'JOD',
                },
              },
            }
          : { ok: false as const, error: { kind: 'unavailable', reason: 'organization_down' } },
      ),
  } as never);
};

const register = (dispatcher: Dispatcher, modules: readonly WorkModule[]): void => {
  for (const module of modules) {
    for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
    for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  }
};

/** Sends a command and fails loudly, so a broken step names itself rather than the next one. */
export const send = async <TResult>(
  wired: Wired,
  command: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.send<TResult>(command as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};

export const trySend = (
  wired: Wired,
  command: Record<string, unknown>,
): Promise<Result<unknown, HandlerFailure>> => wired.dispatcher.send(command as never);

export const ask = async <TResult>(
  wired: Wired,
  query: Record<string, unknown>,
): Promise<TResult> => {
  const result = await wired.dispatcher.ask<TResult>(query as never);

  if (!result.ok) throw new Error(`Refused: ${JSON.stringify(result.error)}`);
  return result.value;
};
