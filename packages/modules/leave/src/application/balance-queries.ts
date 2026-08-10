import { success, type Query, type QueryHandler } from '@work/kernel';

import { accrue } from '../domain/accrual.js';
import { figuresFrom } from '../domain/balance.js';
import { leaveYearFor } from '../domain/leave-year.js';
import { balanceView, ledgerView } from './leave-views.js';
import { notFound } from './leave-context.js';
import { LeavePermissions } from './leave-permissions.js';
import type {
  LeaveBalanceView,
  LedgerEntryView,
  ProjectedBalanceView,
} from '../contracts/views.js';
import type { LeaveDependencies } from './leave-dependencies.js';

/**
 * The three balance questions the specification requires, and the ledger behind them.
 *
 * They are three genuinely different reads, and building only the first would have been the easy
 * mistake:
 *
 * 1. **As of today** — the projection row. One indexed read.
 * 2. **As of any past date** — a sum over the ledger up to that date. Deterministic, and it
 *    **re-derives the figure independently of the projection**, which is what makes a wrong
 *    projection detectable rather than merely unlikely.
 * 3. **Projected to the end of the leave year** — the projection *plus* the accrual the policy will
 *    produce between now and the year end, computed by the same pure function the run uses. This is
 *    what an employee plans against and what a manager approves against, and it is marked on the
 *    contract as a projection that assumes continued employment and unchanged policy.
 *
 * Behind `leave.balance.read` rather than `leave.read`: a manager working out whether somebody can
 * take next week off needs the number, not the sick-leave justification behind it (§30).
 */

export interface ReadBalances extends Query {
  readonly queryName: 'leave.balances';
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface BalancesView {
  readonly items: readonly LeaveBalanceView[];
  readonly total: number;
}

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

const paged = (query: { readonly limit?: number; readonly offset?: number }) => ({
  limit: Math.min(MAX_PAGE, Math.max(1, query.limit ?? DEFAULT_PAGE)),
  offset: Math.max(0, query.offset ?? 0),
});

export const readBalancesHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadBalances, BalancesView> => ({
  queryName: 'leave.balances',
  permission: LeavePermissions.balanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.balances.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.leaveTypeId === undefined ? {} : { leaveTypeId: query.leaveTypeId }),
        ...(query.leaveYearStart === undefined ? {} : { leaveYearStart: query.leaveYearStart }),
      });

      return success({ items: page.items.map(balanceView), total: page.total });
    }),
});

export interface ReadBalanceAsOf extends Query {
  readonly queryName: 'leave.balance-as-of';
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly onDate: string;
}

export interface BalanceAsOfView {
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly leaveYearStart: string;
  readonly onDate: string;
  readonly availableMinutes: number;
  readonly entryCount: number;
  readonly entriesDigest: string;
  /** How the figure was reached. Always `ledger_sum` — this query never reads the projection. */
  readonly basis: 'ledger_sum';
}

/**
 * The balance on a past date, summed from the ledger.
 *
 * **It does not read the projection at all**, and that is the whole point: it is an independent
 * derivation of the same figure, so a test can assert that the two agree and a dispute can be
 * settled by arithmetic over rows nobody rewrote.
 */
export const readBalanceAsOfHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadBalanceAsOf, BalanceAsOfView> => ({
  queryName: 'leave.balance-as-of',
  permission: LeavePermissions.balanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const policies = await dependencies.stores.policies.forType(transaction, query.leaveTypeId);
      const policy = policies.find((one) => one.status === 'published') ?? policies[0];

      if (policy === undefined) return notFound<BalanceAsOfView>('leave policy');

      const leaveYear = leaveYearFor(policy, query.onDate);
      const entries = await dependencies.stores.ledger.forBucketUpTo(
        transaction,
        {
          employmentId: query.employmentId,
          leaveTypeId: query.leaveTypeId,
          leaveYearStart: leaveYear.start,
        },
        query.onDate,
      );
      const figures = figuresFrom(entries);

      return success({
        employmentId: query.employmentId,
        leaveTypeId: query.leaveTypeId,
        leaveYearStart: leaveYear.start,
        onDate: query.onDate,
        availableMinutes: figures.availableMinutes,
        entryCount: figures.entryCount,
        entriesDigest: figures.entriesDigest,
        basis: 'ledger_sum',
      });
    }),
});

export interface ReadProjectedBalance extends Query {
  readonly queryName: 'leave.projected-balance';
  readonly employmentId: string;
  readonly leaveTypeId: string;
  readonly onDate: string;
}

/**
 * What the balance will be at the end of the leave year, if nothing changes.
 *
 * The projected accrual is computed by **the same pure function the accrual run uses**, so the
 * figure an employee plans against and the figure they eventually receive are produced by one piece
 * of arithmetic rather than two that could drift.
 *
 * `assumesContinuedEmployment` is on the contract and is always true. It is a projection, and
 * saying so is the difference between planning and promising.
 */
export const readProjectedBalanceHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadProjectedBalance, ProjectedBalanceView> => ({
  queryName: 'leave.projected-balance',
  permission: LeavePermissions.balanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const employment = await dependencies.employment.find(query.employmentId, query.onDate);

      if (employment === undefined) return notFound<ProjectedBalanceView>('employment');

      const policies = await dependencies.stores.policies.forType(transaction, query.leaveTypeId);
      const policy = policies.find((one) => one.status === 'published');

      if (policy === undefined) return notFound<ProjectedBalanceView>('leave policy');

      const leaveYear = leaveYearFor(policy, query.onDate);
      const balance = await dependencies.stores.balances.forBucket(transaction, {
        employmentId: query.employmentId,
        leaveTypeId: query.leaveTypeId,
        leaveYearStart: leaveYear.start,
      });

      if (balance === undefined) return notFound<ProjectedBalanceView>('leave balance');

      const remaining = accrue(policy, {
        employmentStartDate: employment.startDate,
        periodStart: query.onDate,
        periodEnd: leaveYear.end,
        leaveYearStart: leaveYear.start,
        leaveYearEnd: leaveYear.end,
      });
      const projected = remaining.ok ? remaining.value.minutes : 0;

      return success({
        ...balanceView(balance),
        projectedAccrualMinutes: projected,
        projectedAvailableMinutes: balance.availableMinutes + projected,
        projectionBasis: policy.accrualMethod,
        assumesContinuedEmployment: true,
      });
    }),
});

export interface ReadLedger extends Query {
  readonly queryName: 'leave.ledger';
  readonly employmentId?: string;
  readonly leaveTypeId?: string;
  readonly leaveYearStart?: string;
  readonly kind?: string;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface LedgerView {
  readonly items: readonly LedgerEntryView[];
  readonly total: number;
}

/** The movements behind a balance — the screen that answers "why is it this number". */
export const readLedgerHandler = (
  dependencies: LeaveDependencies,
): QueryHandler<ReadLedger, LedgerView> => ({
  queryName: 'leave.ledger',
  permission: LeavePermissions.balanceRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const page = await dependencies.stores.ledger.search(transaction, {
        ...paged(query),
        ...(query.employmentId === undefined ? {} : { employmentId: query.employmentId }),
        ...(query.leaveTypeId === undefined ? {} : { leaveTypeId: query.leaveTypeId }),
        ...(query.leaveYearStart === undefined ? {} : { leaveYearStart: query.leaveYearStart }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.fromDate === undefined ? {} : { fromDate: query.fromDate }),
        ...(query.toDate === undefined ? {} : { toDate: query.toDate }),
      });

      return success({ items: page.items.map(ledgerView), total: page.total });
    }),
});
