import { currentContext, isSystemContext, type PermissionChecker } from '@work/kernel';

/**
 * Authorization comes from Platform (AD-002, ADR-0001). This is the seam it plugs into, and
 * until it does, the seam refuses.
 *
 * Two behaviours, and the second is the one that matters:
 *
 * - **No authenticated context → no permission.** A request that never resolved a principal
 *   holds nothing, so every command and query the pipeline routes is refused before it is even
 *   validated.
 * - **An authenticated context holds only what this deployment was configured to grant.** The
 *   set is empty unless a deployment supplies Platform's checker, so a deployment that forgets
 *   to wire authorization serves 403 to everything — which is noticed on the first request,
 *   rather than granting everything, which is noticed by an auditor.
 *
 * Munaxa Work will never implement a role engine or a permission engine. What it does is
 * *declare* the permissions its handlers require, so that Platform has something to grant.
 */
export class PlatformPermissionChecker implements PermissionChecker {
  public constructor(private readonly granted: ReadonlySet<string> = new Set()) {}

  public holds(permission: string): Promise<boolean> {
    const context = currentContext();

    if (context === undefined || isSystemContext(context)) return Promise.resolve(false);

    return Promise.resolve(this.granted.has(permission));
  }
}
