/**
 * What a caller must hold — seven grants, and no eighth.
 *
 * **Per resource, per capability**, which is what every module in this repository does and what this
 * checkpoint's plan approved. Reading the catalogue tells you what kinds of thing a tenant issues;
 * reading the inventory tells you what it owns and where each item is. A storekeeper who maintains
 * the list of categories is not necessarily a person who may enumerate every laptop in the company,
 * and one grant covering both would make that distinction unexpressible.
 *
 * **Issuing custody is separated from returning it, and the asymmetry is the point.** A false
 * *return* is the more dangerous direction: it makes an outstanding laptop disappear from the register
 * that offboarding clearance will read, whereas a false issue leaves an obligation somebody can see.
 * Relations separated `investigation.conduct` from `violation.record`, and `action.issue` again, on
 * exactly this reasoning. `assets.asset.manage` is deliberately **not** reused for either: maintaining
 * an inventory and creating an obligation for a named person are different authorities.
 *
 * **`assets.custody.read` is separate from `assets.asset.read`**, which is why the custody view is not
 * folded into the asset read: a custody row names an employment, and reading the inventory must not
 * imply reading who holds what.
 *
 * **Nothing is declared for a capability that does not exist.** There is no `assets.admin`, no
 * `assets.manage`, no `assets.write-all`, no wildcard — and **no permission for transfer,
 * acknowledgement, correction, incidents, waivers, approvals or payroll**. Those arrive with the checkpoints that
 * build them. A permission that names an absent capability is a grant somebody can hold over nothing,
 * and the day it starts meaning something, they hold it already: Phase 5.2 recorded that at D-5.2-04
 * and this module inherits the rule rather than rediscovering it.
 *
 * **There is deliberately no `assets.read-own`.** Ten modules declare a `read-own` and none enforces
 * one, because ADR-0032 resolves a principal to a tenant membership rather than to an employment.
 * Declaring an eleventh that also resolves to nothing would add a grant that looks like self-service
 * and is not. Checkpoint 2 makes this *more* pointed rather than less: there is now a custodian to be
 * the "own", and the platform still cannot tell a signed-in principal that they are that employment.
 * Self-service custody stays `NOT VERIFIED` and unbuilt.
 */
export const AssetsPermissions = {
  /** The tenant's asset catalogue. Configuration; names nobody and holds no item. */
  categoryRead: 'assets.category.read',
  categoryManage: 'assets.category.manage',

  /** The inventory: the individual items, their identifiers and their in-service status. */
  assetRead: 'assets.asset.read',
  assetManage: 'assets.asset.manage',

  /** Who holds what, and who held it before. Names an employment, so it is its own grant. */
  custodyRead: 'assets.custody.read',
  /** Issuing an asset to an employment — creating an obligation for a named person. */
  custodyAssign: 'assets.custody.assign',
  /** Recording a return — discharging one. Separate from `assign`, for the reason above. */
  custodyReturn: 'assets.custody.return',
} as const;

export type AssetsPermission = (typeof AssetsPermissions)[keyof typeof AssetsPermissions];

export const ALL_ASSETS_PERMISSIONS: readonly string[] = Object.values(AssetsPermissions);
