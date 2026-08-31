import { hasPermission } from '@munaxa/rbac';
import { unsafeId, type TenantId, type UserId } from '@munaxa/types';
import {
  currentContext,
  isMachineContext,
  isSystemContext,
  type PermissionChecker,
} from '@work/kernel';

import type { EffectiveGrants } from './authorization.js';
import { toPlatformPermission } from './permission-vocabulary.js';

/**
 * Authorization comes from Platform (AD-002, ADR-0001). This is the seam it plugs into, and every
 * way through it that does not end in the platform saying yes ends in a refusal.
 *
 * Four gates, in this order, and each one denies on its own:
 *
 * - **No authenticated context → no permission.** A request that never resolved a principal holds
 *   nothing, so every command and query the pipeline routes is refused before it is validated.
 * - **No membership → no permission.** The subject of a grant is a membership, and a context
 *   without one names nobody to resolve grants for. This is what a machine or system context
 *   reaches, and it is why neither can borrow a person's authority.
 * - **No representable permission → no permission.** A declaration the vocabulary seam cannot
 *   translate is refused rather than passed through, so an unmappable permission is a locked door
 *   and never an open one.
 * - **The platform decides.** `hasPermission` is the resolver's own matcher — wildcards, scopes
 *   and segment rules included. Munaxa Work does not reimplement it, does not pre-filter the
 *   grant set and does not second-guess the answer.
 *
 * Grants are resolved on each call rather than memoised for the request. That is the approved
 * revocation guarantee taken literally: there is no interval during which a withdrawn grant still
 * answers yes, not even the length of one request.
 */
export class PlatformPermissionChecker implements PermissionChecker {
  public constructor(private readonly grants: EffectiveGrants) {}

  public async holds(permission: string): Promise<boolean> {
    const context = currentContext();

    // A machine context is excluded here rather than at the membership gate below, because it
    // carries a tenant and no membership: narrowing it away is what lets the compiler prove that
    // the only context reaching a grant lookup is a person's.
    if (context === undefined || isSystemContext(context) || isMachineContext(context)) {
      return false;
    }

    const membershipId = context.membershipId;

    if (membershipId === undefined) return false;

    const required = toPlatformPermission(permission);

    if (required === undefined) return false;

    const granted = await this.grants.forMembership(
      unsafeId<TenantId>(context.tenantId),
      unsafeId<UserId>(membershipId),
    );

    return hasPermission(granted, required);
  }
}
