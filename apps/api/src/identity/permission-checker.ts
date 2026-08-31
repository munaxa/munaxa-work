import { currentContext, isSystemContext, type PermissionChecker } from '@work/kernel';

import { currentGrants } from './request-grants.js';

/**
 * Authorization comes from Platform (AD-002, ADR-0001), in Work's own vocabulary (ADR-0076).
 *
 * Three behaviours, and the last two are the ones that matter:
 *
 * - **No authenticated context → no permission.** A request that never resolved a principal holds
 *   nothing, so every command and query the pipeline routes is refused before it is even validated.
 * - **A caller holds what this request was granted, and nothing else.** The set is established once
 *   per request by the tenancy middleware, from the verified `perms` claim, after the grant adapter
 *   has reduced it to exact Work permissions. A deployment with no Platform authentication resolves
 *   no principal, enters no grant scope, and therefore serves 403 to everything — which is noticed
 *   on the first request, rather than granting everything, which is noticed by an auditor.
 * - **The match is exact, and stays exact.** `Set.has`, on a name. There is no pattern, no prefix
 *   and no wildcard: Platform's grant language has all three and none of them crosses the boundary,
 *   because a grant that covers permissions it does not name is a grant nobody can audit.
 *
 * Munaxa Work will never implement a role engine or a permission engine. What it does is *declare*
 * the permissions its handlers require, so that Platform has something to grant.
 */
export class PlatformPermissionChecker implements PermissionChecker {
  public holds(permission: string): Promise<boolean> {
    const context = currentContext();

    if (context === undefined || isSystemContext(context)) return Promise.resolve(false);

    return Promise.resolve(currentGrants().has(permission));
  }
}
