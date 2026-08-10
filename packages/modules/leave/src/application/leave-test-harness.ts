import { Dispatcher, runInContext, uuidV7, type PermissionChecker } from '@work/kernel';
import { InMemoryUnitOfWork } from '@work/testing';

import { leaveModule } from './leave-module.js';
import { inMemoryLeaveStores } from './in-memory-definitions.js';
import { ALL_LEAVE_PERMISSIONS } from './leave-permissions.js';
import type {
  Clock,
  EmploymentDirectoryPort,
  EmploymentForLeave,
  LeaveStores,
  WorkingDayPort,
  WorkingDays,
} from './leave-ports.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The harness every application suite in this module builds on, and the two cross-module fakes.
 *
 * The fakes are **exported from the package**, deliberately and under names that cannot be mistaken
 * for production code: the API's endpoint tests need the same stores and the same fakes this
 * module's own tests use, and a fake duplicated in two packages is a fake that will drift from the
 * real thing in one of them.
 *
 * `FakeAttendance` answers `known: false` **until it is told otherwise**, which is the honest
 * default and the one a `working_days` policy is refused against. A fake that answered "Monday to
 * Friday" by default would make every duration test pass against a working week no customer
 * configured.
 */

export class FakeEmployment implements EmploymentDirectoryPort {
  private readonly employments = new Map<string, EmploymentForLeave>();

  public add(employment: EmploymentForLeave): string {
    this.employments.set(employment.employmentId, employment);
    return employment.employmentId;
  }

  /** A serviceable employment with sensible dates, for a test that does not care about them. */
  public addOne(overrides: Partial<EmploymentForLeave> = {}): string {
    return this.add({
      employmentId: overrides.employmentId ?? uuidV7(),
      status: 'active',
      startDate: '2020-01-01',
      workingHoursPerWeek: 40,
      ...overrides,
    });
  }

  public find(employmentId: string): Promise<EmploymentForLeave | undefined> {
    return Promise.resolve(this.employments.get(employmentId));
  }

  public activeEmployments(limit: number): Promise<readonly EmploymentForLeave[]> {
    return Promise.resolve([...this.employments.values()].slice(0, limit));
  }
}

/**
 * Attendance's working-day read, faked.
 *
 * Starts as **unknown**, so a suite that forgets to configure a pattern gets the refusal rather
 * than a silently invented working week (§19).
 */
export class FakeAttendance implements WorkingDayPort {
  private answer: WorkingDays = { known: false };

  /** Marks a set of dates as expected working days of a stated length. */
  public expects(dates: readonly string[], minutes = 480, zone = 'Asia/Amman'): void {
    this.answer = {
      known: true,
      days: dates.map((onDate) => ({
        onDate,
        expected: true,
        expectedMinutes: minutes,
        dayKind: 'working',
        zone,
      })),
    };
  }

  /** Marks dates as known but *not* worked — a rest day, a public holiday. */
  public rests(dates: readonly string[], dayKind = 'rest', zone = 'Asia/Amman'): void {
    const known = this.answer.known ? this.answer.days : [];

    this.answer = {
      known: true,
      days: [
        ...known,
        ...dates.map((onDate) => ({
          onDate,
          expected: false,
          expectedMinutes: 0,
          dayKind,
          zone,
        })),
      ],
    };
  }

  public unknown(): void {
    this.answer = { known: false };
  }

  public expectedWorkingDays(
    _employmentId: string,
    from: string,
    to: string,
  ): Promise<WorkingDays> {
    if (!this.answer.known) return Promise.resolve({ known: false });

    return Promise.resolve({
      known: true,
      days: this.answer.days.filter((day) => day.onDate >= from && day.onDate <= to),
    });
  }
}

/** A clock that does not move unless a test moves it. */
export class FixedClock implements Clock {
  public constructor(private instant: Date) {}

  public now(): Date {
    return this.instant;
  }

  public set(instant: Date): void {
    this.instant = instant;
  }
}

export interface Harness {
  readonly dispatcher: Dispatcher;
  readonly stores: LeaveStores;
  readonly employment: FakeEmployment;
  readonly attendance: FakeAttendance;
  readonly clock: FixedClock;
  readonly dependencies: LeaveDependencies;
  readonly tenantId: string;
  as<TResult>(actor: string, work: () => Promise<TResult>): Promise<TResult>;
}

const permitting = (...granted: readonly string[]): PermissionChecker => ({
  holds: (permission) => Promise.resolve(granted.includes(permission)),
});

export const harnessFor = (
  options: { readonly permissions?: readonly string[]; readonly now?: Date } = {},
): Harness => {
  const tenantId = uuidV7();
  const clock = new FixedClock(options.now ?? new Date('2026-06-15T09:00:00Z'));
  const employment = new FakeEmployment();
  const attendance = new FakeAttendance();
  const dependencies: LeaveDependencies = {
    unitOfWork: new InMemoryUnitOfWork(tenantId),
    stores: inMemoryLeaveStores(),
    employment,
    workingDays: attendance,
    clock,
  };
  const dispatcher = new Dispatcher(permitting(...(options.permissions ?? ALL_LEAVE_PERMISSIONS)));
  const module = leaveModule(dependencies);

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);

  return {
    dispatcher,
    stores: dependencies.stores,
    employment,
    attendance,
    clock,
    dependencies,
    tenantId,
    as: (actor, work) => runInContext({ tenantId, correlationId: uuidV7(), actor }, work),
  };
};
