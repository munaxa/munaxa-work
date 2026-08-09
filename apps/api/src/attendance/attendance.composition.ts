import {
  attendanceModule,
  leaveUnavailable,
  postgresAttendanceStores,
  systemClock,
  type CommandSender,
  type EmploymentDirectoryPort,
  type EmploymentForAttendance,
} from '@work/attendance';
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
 * Attendance's composition, and the one adapter that is the whole of its cross-module surface.
 *
 * Attendance depends on Employment and reaches it through Employment's **published application
 * service**, never its repositories. The adapter runs its call inside a **bounded service grant**
 * (ADR-0043), for the reason Phase 6 established: a supervisor recording a punch must not thereby
 * become somebody who may browse the employment register. The user is checked for the *attendance*
 * operation; the module holds the narrow cross-domain read.
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
 * **Leave is wired to the adapter that says "nobody can be asked".** There is no Leave module in
 * this repository, and `leaveUnavailable` answers `{ known: false }` honestly. Wiring a stub that
 * answered "no leave approved" would turn every unexplained absence into an absence *without leave*
 * on somebody's record — a false statement the product has no way to support (ADR-0056). Phase 9
 * replaces this line with a real adapter and nothing else in the module changes.
 *
 * Note what is absent, and stays absent. There is **no `create`** on the adapter and no `personId`
 * anywhere in it. Employment owns the employment; Attendance references it and copies no fact from
 * it, and the foreign keys would refuse a row if a defect tried (ADR-0051).
 */

/**
 * A sender handed its dispatcher after the dispatcher exists.
 *
 * Import sends the same record-event command a turnstile would, and the dispatcher that receives it
 * is assembled from a handler list that includes import — a genuine cycle. Rather than break it by
 * letting import write rows directly (which would bypass the deduplication every row depends on),
 * the seam is made explicit. It refuses rather than returning something wrong if used before
 * attachment.
 */
export class DeferredAttendanceSender implements CommandSender {
  private dispatcher: Dispatcher | undefined;

  public attach(dispatcher: Dispatcher): void {
    this.dispatcher = dispatcher;
  }

  public send<TResult, TCommand extends Command>(
    command: TCommand,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().send<TResult>(command);
  }

  public ask<TResult, TQuery extends Query>(
    query: TQuery,
  ): Promise<Result<TResult, HandlerFailure>> {
    return this.attached().ask<TResult>(query);
  }

  private attached(): Dispatcher {
    if (this.dispatcher === undefined) {
      throw new Error(
        'Attendance was used before the dispatcher was attached. The composition root must call attach().',
      );
    }
    return this.dispatcher;
  }
}

/** The permission the grant permits — one, listed, so a reviewer sees the whole surface at once. */
const EMPLOYMENT_READ = 'employment.employment.read';

/**
 * The page bound the roster scan reads employments at.
 *
 * Bounded rather than unbounded because a run has to finish: an operator opening a roster across a
 * hundred thousand employments needs a screen, not a request that is still open when they give up.
 */
const SCAN_PAGE = 200;

interface EmploymentReadResult {
  readonly employmentId: string;
  readonly status: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly unitId?: string;
  readonly managerEmploymentId?: string;
}

interface EmploymentSearchResult {
  readonly items: readonly EmploymentReadResult[];
}

/**
 * Employment, asked two questions and never told anything.
 *
 * `find` confirms an employment is real in this tenant **as at a date** and reports what attendance
 * needs: its status, its dates and — for scoping only — its unit and manager. `activeEmployments`
 * is the roster screen's half: Attendance cannot join to Employment's tables, so it asks for a
 * bounded page.
 *
 * The unit is used to scope a screen. It is **not a place of work**: this product has no
 * authoritative work-location model, and using an organizational unit as a substitute for one would
 * be inventing exactly the entity ADR-0041 declined to invent inside a business phase (ADR-0055).
 *
 * Both are reads. Neither writes, and there is no method here that could.
 */
export class AttendanceEmploymentDirectory implements EmploymentDirectoryPort {
  public constructor(private readonly sender: DeferredAttendanceSender) {}

  public async find(
    employmentId: string,
    asOf: string,
  ): Promise<EmploymentForAttendance | undefined> {
    const result = await runWithServiceGrant(
      {
        module: 'attendance',
        operation: 'attendance.record-event',
        permits: [EMPLOYMENT_READ],
        reason: 'confirming the employment a time event belongs to, as at the attendance date',
      },
      () =>
        this.sender.ask<EmploymentReadResult, Query>({
          queryName: 'employment.read-employment',
          employmentId,
          asOf,
        } as Query),
    );

    return result.ok ? forAttendance(result.value) : undefined;
  }

  public async activeEmployments(limit: number): Promise<readonly EmploymentForAttendance[]> {
    const result = await runWithServiceGrant(
      {
        module: 'attendance',
        operation: 'attendance.roster',
        permits: [EMPLOYMENT_READ],
        reason: 'listing the employments a roster or an attendance screen covers',
      },
      () =>
        this.sender.ask<EmploymentSearchResult, Query>({
          queryName: 'employment.search',
          status: 'active',
          size: Math.min(limit, SCAN_PAGE),
        } as Query),
    );

    return result.ok ? result.value.items.map(forAttendance) : [];
  }
}

const forAttendance = (employment: EmploymentReadResult): EmploymentForAttendance => ({
  employmentId: employment.employmentId,
  status: employment.status,
  startDate: employment.startDate,
  ...(employment.endDate === undefined ? {} : { endDate: employment.endDate }),
  ...(employment.unitId === undefined ? {} : { unitId: employment.unitId }),
  ...(employment.managerEmploymentId === undefined
    ? {}
    : { managerEmploymentId: employment.managerEmploymentId }),
});

/** Everything Attendance needs, assembled. Registered by the identity module's composition. */
export const attendanceModuleFor = (
  unitOfWork: UnitOfWork,
  sender: DeferredAttendanceSender,
): WorkModule =>
  attendanceModule(
    {
      unitOfWork,
      stores: postgresAttendanceStores(),
      employment: new AttendanceEmploymentDirectory(sender),
      // The honest adapter, not a stub that would invent an answer (ADR-0056).
      leave: leaveUnavailable,
      clock: systemClock,
    },
    sender,
  );
