import type { Pool } from 'pg';

/**
 * The world the cross-module suites act in: two tenants, the people in each, and the instant
 * everything happens at.
 *
 * In its own file because both the harness and the seed helpers need it, and neither should have to
 * import the other to get at a constant.
 */

export const TENANT_A = '01930000-0000-7000-8000-0000000055ee';
export const TENANT_B = '01930000-0000-7000-8000-0000000066ff';

/**
 * The memberships, and why there are two sets of them.
 *
 * A membership is *a person in one tenant*: `tenant_membership` is keyed `(tenant_id,
 * workforce_user_id)` and a membership identifier belongs to exactly one tenant. So "the same deputy
 * in both tenants" is not a thing that can exist, and a suite that pretended otherwise would be
 * asserting isolation against a shape the product cannot produce.
 *
 * Which makes the cross-tenant test sharper rather than weaker. Workflow stores an approver as an
 * **opaque value with no foreign key** to Identity (ADR-0042), so an approval in tenant A can name
 * tenant B's approver — and tenant B's deputy, who genuinely holds a delegation from that approver
 * *in tenant B*, can then try to use it in tenant A. If Identity's answer ever crossed a tenant, that
 * is the request that would succeed.
 */
export const APPROVER = '01930000-0000-7000-8000-00000000b001';
export const DEPUTY = '01930000-0000-7000-8000-00000000b003';
export const REQUESTER = '01930000-0000-7000-8000-00000000b004';
/** Somebody in tenant A with no relationship to the step at all. */
export const OUTSIDER = '01930000-0000-7000-8000-00000000b009';

/** Tenant B's own people. Different memberships, because a membership belongs to one tenant. */
export const B_APPROVER = '01930000-0000-7000-8000-00000000c001';
export const B_DEPUTY = '01930000-0000-7000-8000-00000000c003';
export const B_REQUESTER = '01930000-0000-7000-8000-00000000c004';

/** Who belongs where, so the seed and the assertions cannot drift apart. */
export const MEMBERSHIPS: Readonly<Record<string, readonly string[]>> = {
  [TENANT_A]: [APPROVER, DEPUTY, REQUESTER, OUTSIDER],
  [TENANT_B]: [B_APPROVER, B_DEPUTY, B_REQUESTER],
};

export const ADMIN_ACTOR = 'user:workflow-admin';
export const SUBJECT_TYPE = 'recruitment.requisition';

/** The instant every decision in the suite is made at, and every delegation period is set around. */
export const NOW = new Date('2026-08-15T09:00:00.000Z');

/** Workflow's own permission name — the scope a delegation must carry to be honoured here. */
export const DECIDE_SCOPE = 'workflow.approval.decide';

export const AUDIT_COLUMNS = 'created_at, created_by, updated_at, updated_by, version';

export const AUDIT = `now(), '${ADMIN_ACTOR}', now(), '${ADMIN_ACTOR}', 1`;

/**
 * Every membership the suites act as, and the workforce user behind each.
 *
 * A membership identifier is what an approval is addressed to and what a delegation is keyed on, so
 * both tenants' people have to exist in Identity's own tables before any of it means anything. The
 * rows go in through the real columns and the real foreign keys — `delegation` references
 * `tenant_membership`, which references `workforce_user` — so a delegation in these suites is a
 * delegation between two people who exist.
 */
export const seedIdentityWorld = async (admin: Pool): Promise<void> => {
  for (const [tenantId, memberships] of Object.entries(MEMBERSHIPS)) {
    for (const membershipId of memberships) {
      // The same identifier with its person marker: `…b001` names a membership, `…a001` the
      // workforce user behind it. Derived rather than listed so the two can never drift apart.
      const workforceUserId = `${membershipId.slice(0, -4)}a${membershipId.slice(-3)}`;

      await admin.query(
        `insert into workforce_user (id, platform_user_id, status, ${AUDIT_COLUMNS})
         values ($1, $2, 'active', ${AUDIT})
         on conflict (id) do nothing`,
        [workforceUserId, `platform:${membershipId}`],
      );
      await admin.query(
        `insert into tenant_membership
           (id, tenant_id, workforce_user_id, status, joined_at, ${AUDIT_COLUMNS})
         values ($1, $2, $3, 'active', now(), ${AUDIT})
         on conflict (id) do nothing`,
        [membershipId, tenantId, workforceUserId],
      );
    }
  }
};
