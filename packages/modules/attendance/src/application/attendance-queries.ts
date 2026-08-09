import {
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import { civilDateAt } from '../domain/zoned-time.js';
import type {
  AttendanceDashboardView,
  AttendanceDayView,
  AttendanceDaySnapshot,
  AttendanceExceptionView,
  PayableSnapshotView,
  TimeEventView,
} from '../contracts/views.js';

import { notFound } from './attendance-context.js';
import { DEFAULT_ZONE } from './expectation-resolution.js';
import { AttendancePermissions } from './attendance-permissions.js';
import {
  attendanceDayView,
  exceptionView,
  snapshotView,
  timeEventView,
} from './attendance-views.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * Reading attendance.
 *
 * **Progress and counts are aggregates, never pages of rows.** A dashboard that loaded every day to
 * count the late ones is the read that times out at a customer with three thousand employees, and
 * every count here is computed by the database.
 *
 * **No read joins a person's name.** A queue shows an employment identifier; resolving one is
 * People's read behind People's permission, which is what keeps an attendance screen usable by a
 * shift supervisor without making them a reader of the person register.
 *
 * **The day view carries no device identifier and no coordinate.** Those are on the event view,
 * behind `attendance.event.read`, and the separation is the point (ADR-0055).
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const boundsOf = (query: {
  readonly page?: number;
  readonly size?: number;
}): {
  readonly page: number;
  readonly size: number;
  readonly limit: number;
  readonly offset: number;
} => {
  const page = Math.max(1, query.page ?? 1);
  const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));

  return { page, size, limit: size, offset: (page - 1) * size };
};

export interface SearchDays extends Query {
  readonly queryName: 'attendance.search-days';
  readonly employmentId?: string;
  readonly state?: string;
  readonly dayKind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly page?: number;
  readonly size?: number;
}

export const searchDaysHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<SearchDays, PagedResult<AttendanceDayView>> => ({
  queryName: 'attendance.search-days',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.days.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.dayKind === undefined ? {} : { dayKind: query.dayKind }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });

      return success(
        pagedResult(found.items.map(attendanceDayView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface ReadDay extends Query {
  readonly queryName: 'attendance.read-day';
  readonly employmentId: string;
  readonly attendanceDate: string;
}

/**
 * One day, its events and its exceptions.
 *
 * The events include the superseded ones, deliberately: somebody reviewing a corrected day needs to
 * see what was originally captured, and hiding it would make the correction unauditable from the
 * screen where it matters.
 */
export const readDayHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ReadDay, AttendanceDaySnapshot> => ({
  queryName: 'attendance.read-day',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const day = await dependencies.stores.days.byDate(
        transaction,
        query.employmentId,
        query.attendanceDate,
      );

      if (day === undefined) return notFound<AttendanceDaySnapshot>('attendance day');

      const events = await dependencies.stores.events.forDay(
        transaction,
        query.employmentId,
        query.attendanceDate,
      );
      const exceptions = await dependencies.stores.exceptions.forDay(transaction, day.id);

      return success({
        day: attendanceDayView(day),
        events: events.map(timeEventView),
        exceptions: exceptions.map(exceptionView),
      });
    }),
});

export interface SearchEvents extends Query {
  readonly queryName: 'attendance.search-events';
  readonly employmentId?: string;
  readonly source?: string;
  readonly kind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly page?: number;
  readonly size?: number;
}

/** Raw events. Its own permission, because these carry device evidence a day view does not. */
export const searchEventsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<SearchEvents, PagedResult<TimeEventView>> => ({
  queryName: 'attendance.search-events',
  permission: AttendancePermissions.eventRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.events.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });

      return success(
        pagedResult(found.items.map(timeEventView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface SearchExceptions extends Query {
  readonly queryName: 'attendance.search-exceptions';
  readonly employmentId?: string;
  readonly kind?: string;
  readonly severity?: string;
  readonly state?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly page?: number;
  readonly size?: number;
}

/** The queue an HR administrator lives in. Indexed on exactly the filters it offers. */
export const searchExceptionsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<SearchExceptions, PagedResult<AttendanceExceptionView>> => ({
  queryName: 'attendance.search-exceptions',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const bounds = boundsOf(query);
      const found = await dependencies.stores.exceptions.search(transaction, {
        limit: bounds.limit,
        offset: bounds.offset,
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.severity === undefined ? {} : { severity: query.severity }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });

      return success(
        pagedResult(found.items.map(exceptionView), bounds.page, bounds.size, found.total),
      );
    }),
});

export interface ReadSnapshots extends Query {
  readonly queryName: 'attendance.read-snapshots';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly employmentId?: string;
}

/** What Payroll reads. Frozen, sequenced, and reproducible from the digest it carries. */
export const readSnapshotsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ReadSnapshots, readonly PayableSnapshotView[]> => ({
  queryName: 'attendance.read-snapshots',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.snapshots.forPeriod(
        transaction,
        query.periodStart,
        query.periodEnd,
        query.employmentId,
      );

      return success(found.map(snapshotView));
    }),
});

export interface ReadDashboard extends Query {
  readonly queryName: 'attendance.dashboard';
  readonly onDate?: string;
}

/**
 * The counts one screen shows.
 *
 * `awaitingRecalculation` is on the dashboard rather than hidden in an operations view, and that is
 * deliberate: it is the number that reveals a *failure* — days whose inputs moved and which nobody
 * has recalculated — and a number a human sees is a number a human notices growing.
 */
export const readDashboardHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ReadDashboard, AttendanceDashboardView> => ({
  queryName: 'attendance.dashboard',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const onDate = query.onDate ?? civilDateAt(dependencies.clock.now(), DEFAULT_ZONE);
      const days = await dependencies.stores.days.search(transaction, {
        limit: MAX_PAGE_SIZE,
        offset: 0,
        fromDate: onDate,
        toDate: onDate,
      });
      const exceptions = await dependencies.stores.exceptions.search(transaction, {
        limit: 1,
        offset: 0,
        state: 'open',
        fromDate: onDate,
        toDate: onDate,
      });
      const stale = await dependencies.stores.days.stale(transaction, MAX_PAGE_SIZE);
      const pending = await dependencies.stores.exceptions.search(transaction, {
        limit: 1,
        offset: 0,
        kind: 'absence_pending_explanation',
        state: 'open',
        fromDate: onDate,
        toDate: onDate,
      });
      const late = await dependencies.stores.exceptions.search(transaction, {
        limit: 1,
        offset: 0,
        kind: 'late_arrival',
        fromDate: onDate,
        toDate: onDate,
      });

      return success({
        onDate,
        expected: days.items.filter((day) => day.expectedMinutes > 0).length,
        present: days.items.filter((day) => day.workedMinutes > 0).length,
        absencePendingExplanation: pending.total,
        late: late.total,
        openExceptions: exceptions.total,
        awaitingRecalculation: stale.length,
      });
    }),
});
