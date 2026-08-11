import {
  attendanceModule,
  postgresAttendanceStores,
  systemClock,
  type CommandSender,
  type EmploymentDirectoryPort,
  type EmploymentForAttendance,
} from '@work/attendance';
import type { EmploymentSnapshot, EmploymentView } from '@work/employment';

import { AttendanceLeaveDirectory } from './leave.directory.js';
import type { Asking } from '../leave/leave.composition.js';
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
 * **Leave is now wired to the real thing.** Phase 8 left this as `leaveUnavailable`, which answered
 * `{ known: false }` honestly because there was no Leave module. Phase 9 supplies
 * `AttendanceLeaveDirectory`, and — exactly as that comment predicted — **nothing else in this
 * module changed**: the port was the right shape, the three answers were already modelled, and the
 * calculation already distinguished "no leave" from "nobody could be asked".
 *
 * The adapter keeps that third answer. Every failure path in it returns `{ known: false }`,
 * including a thrown exception, because collapsing a Leave outage into "no leave approved" would
 * write absence *without leave* onto somebody's record on the strength of a system fault
 * (ADR-0056).
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
export class DeferredAttendanceSender implements CommandSender, Asking {
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

/**
 * What Employment answers, taken from Employment's own published contract rather than mirrored.
 *
 * The composition root is the one place allowed to know both modules, so there is no reason to
 * guess this shape — and guessing it is what went wrong. `employment.read-employment` returns an
 * `EmploymentSnapshot`, which *wraps* the employment alongside its assignments, its reporting line
 * and the status in force on the date asked for. The original adapter read it as though it were
 * flat, so every field it took was `undefined`.
 */
interface EmploymentSearchResult {
  readonly items: readonly EmploymentView[];
}

/**
 * The two Employment queries this adapter sends, typed rather than asserted.
 *
 * They mirror `employment.read-employment` and `employment.search`, and they exist because the
 * alternative — an object literal cast to bare `Query` — is what let a defect through: a civil-date
 * string was passed where the contract takes an instant, and the compiler could not see it because
 * the cast had already discarded the shape.
 *
 * A mirror is not the real type; Employment does not export its query interfaces, and adding an
 * export to a completed phase to satisfy a caller is the wrong direction. What the mirror buys is
 * that the *next* mismatch is a compile error in this file rather than a `TypeError` in production,
 * and `attendance.composition.spec.ts` covers the gap a mirror cannot: that the shape is still the
 * one Employment actually answers.
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

/**
 * A civil date, as the instant Employment's timelines are compared against.
 *
 * Attendance speaks civil dates — an attendance date is a date in a schedule's zone, not an instant.
 * `employment.read-employment` takes an instant, and compares it through `DateRange.contains`, which
 * calls `getTime()` on whatever it is given. A string reaching that comparison throws.
 *
 * UTC midnight is not a guess: it is the conversion Employment's own edge performs on a
 * ten-character date (`employment/src/api/as-of.ts`), and Employment writes its effective dates the
 * same way. Converting here rather than there keeps the translation in the adapter, which is what an
 * adapter is for.
 */
const asOfInstant = (civilDate: string): Date => new Date(`${civilDate}T00:00:00.000Z`);

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
        this.sender.ask<EmploymentSnapshot, ReadEmploymentQuery>({
          queryName: 'employment.read-employment',
          employmentId,
          asOf: asOfInstant(asOf),
        }),
    );

    return result.ok ? fromSnapshot(result.value) : undefined;
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
        this.sender.ask<EmploymentSearchResult, SearchEmploymentsQuery>({
          queryName: 'employment.search',
          status: 'active',
          size: Math.min(limit, SCAN_PAGE),
        }),
    );

    return result.ok ? result.value.items.map(forAttendance) : [];
  }
}

/**
 * One employment as Attendance needs it, from the view the search returns.
 *
 * `EmploymentView` already carries its placement and its manager **as at the date it was resolved
 * for**, so the unit and the manager are read from it rather than reconstructed.
 */
const forAttendance = (employment: EmploymentView): EmploymentForAttendance => ({
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
 * The snapshot, flattened to what Attendance may hold.
 *
 * **`statusOn` is preferred over the employment row's `status`, and the difference is the whole
 * reason this adapter passes a date at all.** The row answers "now"; `statusOn` is reconstructed
 * from the status history and answers "then". An attendance day being recalculated for March must
 * see March's status — reading the row would tell it whether the person is employed *today*, which
 * is a different question and the wrong one.
 */
const fromSnapshot = (snapshot: EmploymentSnapshot): EmploymentForAttendance => ({
  ...forAttendance(snapshot.employment),
  status: snapshot.statusOn ?? snapshot.employment.status,
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
      // The real Leave read, under a bounded grant. Its failure path answers "nobody could be
      // asked" rather than "no leave approved" (ADR-0056).
      leave: new AttendanceLeaveDirectory(sender),
      clock: systemClock,
    },
    sender,
  );
