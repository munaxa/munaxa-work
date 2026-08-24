import { success, type Query, type QueryHandler } from '@work/kernel';

import { outstandingSince } from '../domain/custody-ageing.js';
import { asAtFrom } from './as-at.js';
import { refusedBy } from './assets-context.js';
import { AssetsPermissions } from './assets-permissions.js';
import type { AssetsDependencies } from './assets-dependencies.js';
import type { OutstandingCustody } from './assets-ports.js';
import type { AssetClearanceView, CustodyBlockerView } from '../contracts/views.js';

/**
 * What Assets contributes to an offboarding clearance — AD-006, and the last of Phase 5.3.
 *
 * **Assets does not own clearance and this read does not pretend to.** Offboarding (Phase 11.2) owns
 * it; Employment says so in its own words (*"deliberately not offboarding: no exit interview, no
 * clearance, no asset return, no final settlement"*), and that module does not exist yet. So this
 * publishes the bounded fact this module owns and stops there — which is why the field is
 * `assetsClear` rather than `clear`.
 *
 * **The rule is D-5.3-01, approved as option (a):** *"An employment ending does not automatically
 * close, cancel, transfer, or alter an open asset custody period. The custody remains an `open` period
 * until an authorized human explicitly returns the asset."* So the Assets-side truth is two lines and
 * invents nothing:
 *
 * ```
 * open custody      →  outstanding
 * returned custody  →  not outstanding
 * ```
 *
 * There is no employment-ended flag, no `closed_reason` and no persisted `outstanding`. **Nothing here
 * asks Employment anything**, which is what makes the answer independent of whether the employment has
 * ended — and what keeps D-5.3-11 intact: Assets is asked, it never subscribes.
 *
 * **This read decides nothing and writes nothing.** It never marks an employment cleared, never closes
 * a custody, never returns an asset and never infers that something was recovered. A blocker is
 * resolved by a person returning the asset through `assets.return-custody`.
 */

/**
 * How many blockers one response will name.
 *
 * An unbounded read is against this module's conventions, and an employment holding more items than
 * this is an inventory problem somebody should look at rather than a page to scroll. The bound is safe
 * because `assetsClear` is decided by the **count**, never by this list — see below.
 */
const MAXIMUM_BLOCKERS = 200;

export interface ReadEmploymentClearance extends Query {
  readonly queryName: 'assets.employment-clearance';
  readonly employmentId: string;
  readonly asAt?: string;
}

export const readEmploymentClearanceHandler = (
  dependencies: AssetsDependencies,
): QueryHandler<ReadEmploymentClearance, AssetClearanceView> => ({
  queryName: 'assets.employment-clearance',
  // Deliberately not a permission of its own. This is a projection of custody rows and nothing else,
  // and a permission named for the word "clearance" would be one minted for a capability rather than
  // for an authority.
  permission: AssetsPermissions.custodyRead,

  handle: async (query) => {
    const asAt = asAtFrom(query.asAt, dependencies);

    if (!asAt.ok) return refusedBy<AssetClearanceView>(asAt.error);

    return dependencies.unitOfWork.execute(async (transaction) => {
      const outstanding = await dependencies.stores.custodies.outstandingForEmployment(
        transaction,
        query.employmentId,
        MAXIMUM_BLOCKERS,
      );

      return success({
        employmentId: query.employmentId,
        asAt: asAt.value,
        // From the count, never from `blockers.length`. If the bound truncated the list — or if the
        // join behind it ever dropped a row — the count is still larger and clearance stays blocked.
        // The failure direction is the safe one: a truncated list cannot report somebody as clear.
        assetsClear: outstanding.total === 0,
        outstandingCount: outstanding.total,
        blockers: outstanding.items.map((item) => blockerView(item, asAt.value)),
      });
    });
  },
});

/**
 * One blocker, named well enough to act on and no further.
 *
 * The employment is already the subject of the request, so it is not repeated per row; the tenant is
 * never published; and no note, no status and no person appears. The tag is here because "return asset
 * `019a3f…`" is not an instruction anybody can follow.
 */
const blockerView = (item: OutstandingCustody, asAt: string): CustodyBlockerView => ({
  assetCustodyId: item.assetCustodyId,
  assetId: item.assetId,
  assetTag: item.assetTag,
  assetCategoryId: item.assetCategoryId,
  issuedOn: item.issuedOn,
  ...outstandingSince(item.issuedOn, asAt),
});
