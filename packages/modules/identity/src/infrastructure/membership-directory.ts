import type { Pool } from 'pg';

import type {
  ResolvedMembership,
  TenantMembershipDirectory,
} from '../contracts/membership-directory.js';
import type { MembershipStatus } from '../domain/identity-vocabulary.js';

/**
 * The directory the request pipeline consults before every request, and the thing that makes a
 * forged tenant header worthless.
 *
 * It reads across tenants, which nothing else in this product does, and that is not an oversight
 * — it is the one query that *must*, because its whole job is to answer "which tenants may this
 * person act in" before any tenant is in context. There is no tenant to scope it to yet; that is
 * the question.
 *
 * Three properties make that safe:
 *
 * 1. **It is keyed only by an authenticated `platformUserId`.** Nothing a caller sends reaches
 *    this query. A caller cannot ask it about somebody else, because the only input is who
 *    Platform said they are.
 * 2. **It returns identifiers, never data.** Tenant, membership, user. No name, no email, no
 *    profile — nothing that would be a disclosure if the answer were somehow wrong.
 * 3. **It is one named function, not a privileged connection.** `app_memberships_of` is a
 *    security-definer function created by the migration; the application role holds no
 *    row-level security bypass of its own. The alternative — a second pool that could bypass
 *    every policy — would open a general hole to solve one specific problem, and would then be
 *    available to every query written afterwards by somebody who was not present for this
 *    decision.
 *
 * The active-only filter lives inside that function rather than here. A suspended member is
 * still a member, and putting the predicate in application code is exactly the omission
 * row-level security exists to survive — except that here there is no policy to fall back on,
 * so the predicate is the control and belongs where it cannot be forgotten.
 */
export class PostgresMembershipDirectory implements TenantMembershipDirectory {
  public constructor(private readonly pool: Pool) {}

  public async activeMembershipsOf(platformUserId: string): Promise<readonly ResolvedMembership[]> {
    const result = await this.pool.query<{
      tenant_id: string;
      membership_id: string;
      workforce_user_id: string;
      platform_user_id: string;
      status: string;
    }>('select * from app_memberships_of($1::varchar)', [platformUserId]);

    return result.rows.map((row) => ({
      tenantId: row.tenant_id,
      membershipId: row.membership_id,
      workforceUserId: row.workforce_user_id,
      platformUserId: row.platform_user_id,
      status: row.status as MembershipStatus,
    }));
  }
}
