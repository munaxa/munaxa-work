import { success, type Query, type QueryHandler } from '@work/kernel';

import { notFound } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import { custodyView } from './assets-views.js';
import { pagedFrom, type PageRequest } from './paging.js';
import type { AssetsDependencies } from './assets-dependencies.js';
import type { AssetCustodyView, CustodyPageView } from '../contracts/views.js';

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
 */

export interface ReadAssetCustody extends Query, PageRequest {
  readonly queryName: 'assets.asset-custody';
  readonly assetId: string;
}

export const readAssetCustodyHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadAssetCustody, AssetCustodyView> => ({
  queryName: 'assets.asset-custody',
  permission: AssetsPermissions.custodyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
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
        history: { items: history.items.map(custodyView), total: history.total },
        ...(current === undefined ? {} : { current: custodyView(current) }),
      });
    }),
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
}

export const readEmploymentCustodyHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadEmploymentCustody, CustodyPageView> => ({
  queryName: 'assets.employment-custody',
  permission: AssetsPermissions.custodyRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.custodies.forEmployment(
        transaction,
        query.employmentId,
        query.openOnly === undefined ? {} : { openOnly: query.openOnly },
        pagedFrom(query),
      );

      return success({ items: found.items.map(custodyView), total: found.total });
    }),
});
