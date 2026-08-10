import {
  leaveModule,
  postgresLeaveStores,
  systemClock,
  type EmploymentDirectoryPort,
  type EmploymentForLeave,
  type WorkingDayPort,
  type WorkingDays,
} from '@work/leave';
import type { ExpectedWorkingDaysView } from '@work/attendance';
import type { EmploymentSnapshot, EmploymentView } from '@work/employment';
import {
  runWithServiceGrant,
  type Command,
  type Dispatcher,
  type HandlerFailure,
  type Query,
  type Result,
  type UnitOfWork,
  type WorkModule,
} from '@work/kernel';

/**
 * Leave's composition, and the two adapters that are the whole of its cross-module surface.
 *
 * Leave reaches Employment and Attendance through their **published application services**, never
 * their repositories. Each call runs inside a **bounded service grant** (ADR-0043), for the reason
 * Phase 6 established and Phase 8 repeated: an HR administrator approving somebody's leave must not
 * thereby become a reader of the employment register, nor of everybody's attendance record. The
 * user is checked for the *leave* operation; the module holds the narrow cross-domain read.
 *
 * Each grant here:
 *
 * - is entered *inside* a handler the pipeline has already authorized;
 * - permits an **explicit list** of permissions — never a wildcard, never a prefix;
 * - **cannot nest**, so authority is not accumulated by composition;
 * - leaves the tenant, the actor and the correlation identifier untouched, so every audit column
 *   and every event still names the human being who asked;
 * - is **observable**: every elevation is logged with the operation that caused it.
 *
 * **Neither adapter writes anything.** There is no `create` and no `update` on either, and there is
 * no method that could mark an attendance day, publish a roster entry or change an employment.
 * Attendance discovers a leave change by *asking Leave*, on its own reconciliation run — the
 * direction that keeps the dependency acyclic (ADR-0058).
 *
 * Note what is absent and stays absent: no `personId`, no salary, no employment status Leave
 * stores, and nothing that could put an `on_leave` state on an employment (ADR-0040, ADR-0051).
 */

/** The permissions the grants permit — two, listed, so a reviewer sees the whole surface at once. */
const EMPLOYMENT_READ = 'employment.employment.read';
const ATTENDANCE_READ = 'attendance.read';

/** The page bound an accrual run reads employments at. Bounded, because a run has to finish. */
const SCAN_PAGE = 200;

/**
 * The two Employment queries this adapter sends, typed rather than asserted.
 *
 * Typed because the alternative — an object literal cast to bare `Query` — is what let the Phase 8
 * defect through: a civil-date string was passed where the contract takes an instant, and the
 * compiler could not see it because the cast had already discarded the shape. A mirror is not the
 * real type, but it makes the *next* mismatch a compile error in this file rather than a
 * `TypeError` in production.
 */
interface ReadEmploymentQuery extends Query {
  readonly queryName: 'employment.read-employment';
  readonly employmentId: string;
  readonly asOf?: Date;
}

interface SearchEmploymentsQuery extends Query {
  readonly queryName: 'employment.search';
  readonly status?: string;
  readonly size?: number;
}

interface EmploymentSearchResult {
  readonly items: readonly EmploymentView[];
}

interface ExpectedWorkingDaysQuery extends Query {
  readonly queryName: 'attendance.expected-working-days';
  readonly employmentId: string;
  readonly from: string;
  readonly to: string;
}

/**
 * A civil date, as the instant Employment's timelines are compared against.
 *
 * Leave speaks civil dates — a leave date is a date on somebody's calendar, not an instant.
 * `employment.read-employment` takes an instant and compares it through `DateRange.contains`, which
 * calls `getTime()` on whatever it is given; a string reaching that comparison throws. UTC midnight
 * is not a guess: it is the conversion Employment's own edge performs on a ten-character date.
 *
 * This is the Phase 8 defect's fix, applied here from the start rather than found later.
 */
const asOfInstant = (civilDate: string): Date => new Date(`${civilDate}T00:00:00.000Z`);

/**
 * The one capability both adapters need.
 *
 * Narrower than `Dispatcher` on purpose: an adapter that held the whole dispatcher could *send a
 * command*, and neither of these has any business writing anything. Both the real dispatcher and
 * the deferred one satisfy it, so the seam costs nothing.
 */
export interface Asking {
  ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>>;
}

/** Employment, asked two questions and never told anything. */
export class LeaveEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async find(employmentId: string, asOf: string): Promise<EmploymentForLeave | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'leave',
        operation: 'leave.raise-request',
        permits: [EMPLOYMENT_READ],
        reason: 'confirming the employment a leave request belongs to, as at the leave date',
      },
      () =>
        this.ask<EmploymentSnapshot, ReadEmploymentQuery>({
          queryName: 'employment.read-employment',
          employmentId,
          asOf: asOfInstant(asOf),
        }),
    );

    return result.ok ? fromSnapshot(result.value) : undefined;
  }

  public async activeEmployments(limit: number): Promise<readonly EmploymentForLeave[]> {
    const result = await runWithServiceGrant(
      {
        module: 'leave',
        operation: 'leave.run-accrual',
        permits: [EMPLOYMENT_READ],
        reason: 'listing the employments an accrual run covers',
      },
      () =>
        this.ask<EmploymentSearchResult, SearchEmploymentsQuery>({
          queryName: 'employment.search',
          status: 'active',
          size: Math.min(limit, SCAN_PAGE),
        }),
    );

    return result.ok ? result.value.items.map(forLeave) : [];
  }

  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

/**
 * Attendance, asked one question: which dates did this employment work, and for how long.
 *
 * **A failure answers `known: false`, and that is not "no working days".** It means Attendance
 * could not be asked, and Leave refuses a `working_days` request by name rather than silently
 * counting calendar days. Collapsing the two would compute somebody's leave against a working week
 * they do not work — the same class of mistake `leaveUnavailable` prevents in the other direction
 * (ADR-0056).
 */
export class LeaveWorkingDayDirectory implements WorkingDayPort {
  public constructor(private readonly dispatcher: Asking) {}

  public async expectedWorkingDays(
    employmentId: string,
    from: string,
    to: string,
  ): Promise<WorkingDays> {
    const result = await runWithServiceGrant(
      {
        module: 'leave',
        operation: 'leave.raise-request',
        permits: [ATTENDANCE_READ],
        reason: 'reading the working pattern a leave duration is counted against',
      },
      () =>
        this.ask<ExpectedWorkingDaysView, ExpectedWorkingDaysQuery>({
          queryName: 'attendance.expected-working-days',
          employmentId,
          from,
          to,
        }),
    );

    if (!result.ok) return { known: false };

    return { known: true, days: result.value.days };
  }

  private ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.dispatcher.ask<TResult>(query);
  }
}

/**
 * One employment as Leave needs it, from the view the search returns.
 *
 * `workingHoursPerWeek` is deliberately **not** invented where Employment does not publish it: a
 * `calendar_days` request for somebody whose contracted hours are unknown is refused rather than
 * computed against an assumed eight-hour day.
 */
const forLeave = (employment: EmploymentView): EmploymentForLeave => ({
  employmentId: employment.employmentId,
  status: employment.status,
  startDate: employment.startDate,
  ...(employment.endDate === undefined ? {} : { endDate: employment.endDate }),
  ...(employment.assignment?.unitId === undefined ? {} : { unitId: employment.assignment.unitId }),
  ...(employment.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: employment.managerEmploymentId }),
});

/**
 * The snapshot, flattened to what Leave may hold.
 *
 * **`statusOn` is preferred over the employment row's `status`**, and the difference is the whole
 * reason this adapter passes a date. The row answers "now"; `statusOn` is reconstructed from the
 * status history and answers "then". Leave granted for March must be checked against March's
 * status.
 */
const fromSnapshot = (snapshot: EmploymentSnapshot): EmploymentForLeave => ({
  ...forLeave(snapshot.employment),
  status: snapshot.statusOn ?? snapshot.employment.status,
});

/**
 * A dispatcher handed over after it exists.
 *
 * Leave's handler list does not send Leave commands, so there is no cycle in the module itself —
 * but its two adapters need the dispatcher that is assembled *from* that list, which is the same
 * seam Attendance's import command needed. It refuses rather than answering wrongly if used before
 * attachment.
 */
export class DeferredLeaveDispatcher implements Asking {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().ask<TResult>(query);
  }

  public send<TResult>(command: Command): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().send<TResult>(command);
  }

  private attached(): Dispatcher {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Leave was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** Everything Leave needs, assembled. Registered by the identity module's composition. */
export const leaveModuleFor = (
  unitOfWork: UnitOfWork,
  dispatcher: DeferredLeaveDispatcher,
): WorkModule =>
  leaveModule({
    unitOfWork,
    stores: postgresLeaveStores(),
    employment: new LeaveEmploymentDirectory(dispatcher),
    workingDays: new LeaveWorkingDayDirectory(dispatcher),
    clock: systemClock,
  });
