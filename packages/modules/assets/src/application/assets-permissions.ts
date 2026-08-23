/**
 * What a caller must hold — four grants, and no fifth.
 *
 * **Per resource, per capability**, which is what every module in this repository does and what this
 * checkpoint's plan approved. Reading the catalogue tells you what kinds of thing a tenant issues;
 * reading the inventory tells you what it owns and where each item is. A storekeeper who maintains
 * the list of categories is not necessarily a person who may enumerate every laptop in the company,
 * and one grant covering both would make that distinction unexpressible.
 *
 * **Nothing is declared for a capability that does not exist.** There is no `assets.admin`, no
 * `assets.manage`, no `assets.write-all`, no wildcard — and **no permission for custody,
 * acknowledgement, incidents, waivers, approvals or payroll**. Those arrive with the checkpoints that
 * build them. A permission that names an absent capability is a grant somebody can hold over nothing,
 * and the day it starts meaning something, they hold it already: Phase 5.2 recorded that at D-5.2-04
 * and this module inherits the rule rather than rediscovering it.
 *
 * **There is deliberately no `assets.read-own`.** Ten modules declare a `read-own` and none enforces
 * one, because ADR-0032 resolves a principal to a tenant membership rather than to an employment.
 * Declaring an eleventh that also resolves to nothing would add a grant that looks like self-service
 * and is not — and Checkpoint 1 has no custodian to be the "own" in the first place.
 */
export const AssetsPermissions = {
  /** The tenant's asset catalogue. Configuration; names nobody and holds no item. */
  categoryRead: 'assets.category.read',
  categoryManage: 'assets.category.manage',

  /** The inventory: the individual items, their identifiers and their in-service status. */
  assetRead: 'assets.asset.read',
  assetManage: 'assets.asset.manage',
} as const;

export type AssetsPermission = (typeof AssetsPermissions)[keyof typeof AssetsPermissions];

export const ALL_ASSETS_PERMISSIONS: readonly string[] = Object.values(AssetsPermissions);
