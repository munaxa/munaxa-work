import { success, type Query, type QueryHandler } from '@work/kernel';

import type {
  CorrectionView,
  ImportBatchView,
  RosterEntryView,
  ScheduleView,
  ShiftView,
} from '../contracts/views.js';

import {
  correctionView,
  importBatchView,
  rosterEntryView,
  scheduleView,
  shiftView,
} from './attendance-views.js';
import { AttendancePermissions } from './attendance-permissions.js';
import type { AttendanceDependencies } from './attendance-dependencies.js';

/**
 * The reads an administrator's screens make: the definitions, the rota, the correction queue and
 * what the last import did.
 *
 * Apart from `attendance-queries.ts` for size, and grouped by who asks rather than by table: these
 * are the configuration screens, where the day and exception reads beside them are the operational
 * ones.
 *
 * **The policy list is not here.** An attendance policy is read through the day it governed — the
 * day stores which policy and which version produced it — and publishing a screen that listed
 * policies as live objects would invite reading "the" policy rather than the one in force on the
 * date being disputed. What a tenant configures, they configure through the write endpoints.
 */

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 200;

export interface ListShifts extends Query {
  readonly queryName: 'attendance.list-shifts';
}

/** Every shift, published and draft, newest version first. A configuration screen's read. */
export const listShiftsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ListShifts, readonly ShiftView[]> => ({
  queryName: 'attendance.list-shifts',
  permission: AttendancePermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.shifts.all(transaction);

      return success(found.map(shiftView));
    }),
});

export interface ListSchedules extends Query {
  readonly queryName: 'attendance.list-schedules';
}

export const listSchedulesHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ListSchedules, readonly ScheduleView[]> => ({
  queryName: 'attendance.list-schedules',
  permission: AttendancePermissions.read,

  handle: async () =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.schedules.all(transaction);

      return success(found.map(scheduleView));
    }),
});

export interface ReadRoster extends Query {
  readonly queryName: 'attendance.read-roster';
  readonly from: string;
  readonly to: string;
  readonly employmentId?: string;
}

/**
 * A window of the rota, for one person or for everybody.
 *
 * A window rather than "the roster", because a rota has no present tense: the question is always
 * what applies between two dates, and a read with no bounds would return a table.
 */
export const readRosterHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ReadRoster, readonly RosterEntryView[]> => ({
  queryName: 'attendance.read-roster',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.rosters.between(
        transaction,
        query.from,
        query.to,
        query.employmentId,
      );

      return success(found.map(rosterEntryView));
    }),
});

export interface SearchCorrections extends Query {
  readonly queryName: 'attendance.search-corrections';
  readonly employmentId?: string;
  readonly state?: string;
  readonly kind?: string;
  readonly page?: number;
  readonly size?: number;
}

export interface PagedCorrections {
  readonly items: readonly CorrectionView[];
  readonly page: number;
  readonly size: number;
  readonly total: number;
}

/** The correction queue: who asked for what, who decided it, and what it produced. */
export const searchCorrectionsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<SearchCorrections, PagedCorrections> => ({
  queryName: 'attendance.search-corrections',
  permission: AttendancePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = Math.max(1, query.page ?? 1);
      const size = Math.min(MAX_PAGE_SIZE, Math.max(1, query.size ?? DEFAULT_PAGE_SIZE));
      const found = await dependencies.stores.corrections.search(transaction, {
        limit: size,
        offset: (page - 1) * size,
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
      });

      return success({ items: found.items.map(correctionView), page, size, total: found.total });
    }),
});

export interface ListImports extends Query {
  readonly queryName: 'attendance.list-imports';
  readonly limit?: number;
}

/**
 * What the recent imports did.
 *
 * Its own permission — `attendance.import` — because a batch's counts say how much of a customer's
 * turnstile data landed, and the operator who runs imports is not always the one who reads days.
 */
export const listImportsHandler = (
  dependencies: AttendanceDependencies,
): QueryHandler<ListImports, readonly ImportBatchView[]> => ({
  queryName: 'attendance.list-imports',
  permission: AttendancePermissions.import,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, query.limit ?? DEFAULT_PAGE_SIZE));
      const found = await dependencies.stores.imports.recent(transaction, limit);

      return success(found.map(importBatchView));
    }),
});
