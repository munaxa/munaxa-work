import { success, type Query, type QueryHandler } from '@work/kernel';

import { accept, refuse, type AssetsResult } from '../domain/assets-rejection.js';
import { civilDateOf, isCivilDate, wholeDaysBetween } from '../domain/custody-ageing.js';
import { notFound, refusedBy } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import { custodyView } from './assets-views.js';
import { pagedFrom, type PageRequest } from './paging.js';
import type { AssetsDependencies } from './assets-dependencies.js';
import type { AssetCustodyView, CustodyPageView, CustodySummaryView } from '../contracts/views.js';

/**
 * The two custody reads, and the rules both keep.
 *
 * **Bounded, and never tenant-wide.** One takes an asset, the other an employment, and both are paged.
 * There is deliberately no "every custody in this organisation" read: that is a report nobody
 * approved, and it is the read that turns an asset register into a surveillance list.
 *
 * **Nothing here is audited, and there is no access-trail table.** The only two audited-read domains
 * in this repository hold medical documents and disciplinary allegations. Attendance records when
 * people arrive and leave and audits no read; custody records who holds a laptop. Auditing it would be
 * the "audit every query" mechanism D-5.2-05 rejected.
 *
 * **Nothing found rather than forbidden.** An asset in another tenant answers exactly as one that
 * never existed, so an identifier cannot be used as a probe.
 *
 * **The current holder is derived here, never read from a column.** It is the open custody, and the
 * partial unique index is what guarantees there is at most one.
 *
 * **Every read takes an explicit `asAt` and echoes the one it used.** Ageing is arithmetic over dates
 * already on the row, and a figure measured against a date the caller could not see is a figure nobody
 * can reproduce. A malformed `asAt` is refused rather than quietly replaced with today.
 *
 * **No read here asks Employment anything.** A custody held by an employment that has ended ages
 * exactly like one held by an active employment, which is what keeps these reads from answering
 * D-5.3-01 — still open — by accident.
 */

/**
 * The date a read measures against: the caller's if they gave one, otherwise the server's own day.
 *
 * **A future `asAt` is permitted.** "How old will this be at year end" is a fair question, the
 * arithmetic is identical, and nothing is persisted, so no future date can reach a record.
 */
const asAtFrom = (
  asAt: string | undefined,
  dependencies: AssetsDependencies,
): AssetsResult<string> => {
  if (asAt === undefined) return accept(civilDateOf(dependencies.clock.now()));
  return isCivilDate(asAt) ? accept(asAt) : refuse('as_at_malformed', { field: 'asAt' });
};

export interface ReadAssetCustody extends Query, PageRequest {
  readonly queryName: 'assets.asset-custody';
  readonly assetId: string;
  readonly asAt?: string;
}

export const readAssetCustodyHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadAssetCustody, AssetCustodyView> => ({
  queryName: 'assets.asset-custody',
  permission: AssetsPermissions.custodyRead,

  handle: async (query) => {
    const asAt = asAtFrom(query.asAt, dependencies);

    if (!asAt.ok) return refusedBy<AssetCustodyView>(asAt.error);

    return dependencies.unitOfWork.execute(async (transaction) => {
      const asset = await dependencies.stores.assets.byId(transaction, query.assetId);

      // An asset in another tenant reads as absent, so its custody cannot be probed either.
      if (asset === undefined) return notFound<AssetCustodyView>('asset');

      const current = await dependencies.stores.custodies.openFor(transaction, query.assetId);
      const history = await dependencies.stores.custodies.forAsset(
        transaction,
        query.assetId,
        pagedFrom(query),
      );

      return success({
        assetId: query.assetId,
        asAt: asAt.value,
        history: {
          items: history.items.map((custody) => custodyView(custody, asAt.value)),
          asAt: asAt.value,
          total: history.total,
        },
        ...(current === undefined ? {} : { current: custodyView(current, asAt.value) }),
      });
    });
  },
});

/**
 * What one employment holds, and what it held before.
 *
 * `openOnly` narrows to what is still out — the question offboarding clearance will ask when
 * Checkpoint 4 builds it. **This checkpoint publishes the read and computes no clearance from it.**
 *
 * The employment identifier is not verified against Employment here. A read that asked Employment
 * whether an identifier existed would turn this query into an existence oracle for the workforce; an
 * unknown employment simply holds nothing, which is the same answer as one in another tenant.
 */
export interface ReadEmploymentCustody extends Query, PageRequest {
  readonly queryName: 'assets.employment-custody';
  readonly employmentId: string;
  readonly openOnly?: boolean;
  readonly asAt?: string;
}

export const readEmploymentCustodyHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadEmploymentCustody, CustodyPageView> => ({
  queryName: 'assets.employment-custody',
  permission: AssetsPermissions.custodyRead,

  handle: async (query) => {
    const asAt = asAtFrom(query.asAt, dependencies);

    if (!asAt.ok) return refusedBy<CustodyPageView>(asAt.error);

    return dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.custodies.forEmployment(
        transaction,
        query.employmentId,
        query.openOnly === undefined ? {} : { openOnly: query.openOnly },
        pagedFrom(query),
      );

      return success({
        items: found.items.map((custody) => custodyView(custody, asAt.value)),
        asAt: asAt.value,
        total: found.total,
      });
    });
  },
});

/**
 * How much is out across the tenant, and how long the oldest has been out.
 *
 * **This is the one read here that is not narrowed to a subject, and it is what makes that safe:** it
 * publishes a count and two dates, and no identifier of any kind. The tenant-wide custody *listing*
 * this module refuses to build would name every asset and every holder; this names none of them.
 *
 * It exists because ADR-0053 already settled what a module does about a situation nothing is watching
 * for — *"the count is on the administrator's dashboard rather than in an operations script … a number
 * a human can see is a number a human notices growing."* Assets does not learn that an employment has
 * ended (D-5.3-11); this is how the consequence becomes visible anyway.
 *
 * **No 30/60/90-day bucketing.** Those are business thresholds and this module does not invent one.
 *
 * `longestDaysOutstanding` is derived here from `oldestIssuedOn` using the same arithmetic the item
 * reads use, so the summary and a custody's own `daysOutstanding` cannot disagree. It is absent when
 * `asAt` precedes even the oldest issue, for the same reason it is absent on an item.
 */
export interface ReadCustodySummary extends Query {
  readonly queryName: 'assets.custody-summary';
  readonly asAt?: string;
}

export const readCustodySummaryHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadCustodySummary, CustodySummaryView> => ({
  queryName: 'assets.custody-summary',
  permission: AssetsPermissions.custodyRead,

  handle: async (query) => {
    const asAt = asAtFrom(query.asAt, dependencies);

    if (!asAt.ok) return refusedBy<CustodySummaryView>(asAt.error);

    return dependencies.unitOfWork.execute(async (transaction) => {
      const summary = await dependencies.stores.custodies.openSummary(transaction);

      return success({
        asAt: asAt.value,
        openCount: summary.openCount,
        ...(summary.oldestIssuedOn === undefined ? {} : { oldestIssuedOn: summary.oldestIssuedOn }),
        ...longestOutstanding(summary.oldestIssuedOn, asAt.value),
      });
    });
  },
});

const longestOutstanding = (
  oldestIssuedOn: string | undefined,
  asAt: string,
): { readonly longestDaysOutstanding?: number } => {
  if (oldestIssuedOn === undefined) return {};

  const days = wholeDaysBetween(oldestIssuedOn, asAt);

  return days < 0 ? {} : { longestDaysOutstanding: days };
};
