import { success, type Query, type QueryHandler } from '@work/kernel';

import { approvalChainView, requestView } from './leave-views.js';
import { notFound } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type {
  LeaveApprovalChainView,
  LeaveCalendarEntryView,
  LeaveRequestView,
} from '../contracts/views.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * Reading requests, their approval chain, and who is away.
 *
 * Every collection is paginated and bounded. The register and the calendar are the two reads an
 * administrator lives in, and an unbounded one of either is a request that never returns on a
 * tenant of any size.
 *
 * The day rows for a page of requests are read **once, with one `= any(...)`** rather than per
 * request. An N+1 here would be fifty round trips per screen.
 */

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const paged = (query: { readonly limit?: number; readonly offset?: number }) => ({
  limit: Math.min(MAX_PAGE, Math.max(1, query.limit ?? DEFAULT_PAGE)),
  offset: Math.max(0, query.offset ?? 0),
});

export interface SearchRequests extends Query {
  readonly queryName: 'leave.requests';
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly state?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface RequestsView {
  readonly items: readonly LeaveRequestView[];
  readonly total: number;
}

export const searchRequestsHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<SearchRequests, RequestsView> => ({
  queryName: 'leave.requests',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.requests.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.leaveTypeId === undefined ? {} : { leaveTypeId: query.leaveTypeId }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });
      const days = await dependencies.stores.requestDays.forRequests(
        transaction,
        page.items.map((one) => one.id),
      );

      return success({
        items: page.items.map((request) =>
          requestView(
            request,
            days.filter((day) => day.leaveRequestId === request.id),
          ),
        ),
        total: page.total,
      });
    }),
});

export interface ReadRequest extends Query {
  readonly queryName: 'leave.request';
  readonly leaveRequestId: string;
}

export const readRequestHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadRequest, LeaveRequestView> => ({
  queryName: 'leave.request',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, query.leaveRequestId);

      if (found === undefined) return notFound<LeaveRequestView>('leave request');

      const days = await dependencies.stores.requestDays.forRequest(transaction, found.id);

      return success(requestView(found, days));
    }),
});

export interface ReadApprovalChain extends Query {
  readonly queryName: 'leave.approval-chain';
  readonly leaveRequestId: string;
}

/**
 * The approval chain, in `ApprovalPort`'s shape.
 *
 * Published from this phase, as the specification requires — but sourced from Leave's own decision
 * table rather than from `ApprovalPort`, because the only adapter in this repository approves
 * everything automatically (ADR-0045). When Phase 16 lands, the source changes and this contract
 * does not.
 *
 * A request under a policy requiring no approval returns **no steps** and `approvalRequired: false`.
 */
export const readApprovalChainHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadApprovalChain, LeaveApprovalChainView> => ({
  queryName: 'leave.approval-chain',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.requests.byId(transaction, query.leaveRequestId);

      if (found === undefined) return notFound<LeaveApprovalChainView>('leave request');

      const decisions = await dependencies.stores.decisions.forRequest(transaction, found.id);

      return success(approvalChainView(found, decisions));
    }),
});

export interface ReadCalendar extends Query {
  readonly queryName: 'leave.calendar';
  readonly from: string;
  readonly to: string;
  readonly employmentId?: string;
  readonly limit?: number;
}

export interface CalendarView {
  readonly from: string;
  readonly to: string;
  readonly entries: readonly LeaveCalendarEntryView[];
}

/**
 * Who is away, over a date range.
 *
 * Approved leave only, and **no reason text**: this is a list of absences for planning, not a file
 * on anybody. Somebody planning a rota needs to know a person is away; they do not need to know it
 * is because of a hospital appointment (§30).
 */
export const readCalendarHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadCalendar, CalendarView> => ({
  queryName: 'leave.calendar',
  permission: LeavePermissions.read,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.requests.search(transaction, {
        state: 'approved',
        fromDate: query.from,
        toDate: query.to,
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        limit: Math.min(MAX_PAGE, Math.max(1, query.limit ?? MAX_PAGE)),
        offset: 0,
      });
      const days = await dependencies.stores.requestDays.forRequests(
        transaction,
        page.items.map((one) => one.id),
      );
      const byRequest = new Map(page.items.map((one) => [one.id, one]));

      return success({
        from: query.from,
        to: query.to,
        entries: days
          .filter((day) => day.onDate >= query.from && day.onDate <= query.to)
          .map((day) => {
            const request = byRequest.get(day.leaveRequestId);

            return {
              employmentId: day.employmentId,
              onDate: day.onDate,
              portion: day.portion,
              minutes: day.minutes,
              leaveTypeId: request?.leaveTypeId ?? '',
              leaveRequestId: day.leaveRequestId,
              state: request?.state ?? 'approved',
            };
          }),
      });
    }),
});
