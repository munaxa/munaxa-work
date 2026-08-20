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
export const MANAGER = '01930000-0000-7000-8000-00000000b002';
export const OUTSIDER = '01930000-0000-7000-8000-00000000b009';

/** Tenant B's own people. Different memberships, because a membership belongs to one tenant. */
export const B_APPROVER = '01930000-0000-7000-8000-00000000c001';
export const B_DEPUTY = '01930000-0000-7000-8000-00000000c003';
export const B_REQUESTER = '01930000-0000-7000-8000-00000000c004';

/** Who belongs where, so the seed and the assertions cannot drift apart. */
export const MEMBERSHIPS: Readonly<Record<string, readonly string[]>> = {
  [TENANT_A]: [APPROVER, MANAGER, DEPUTY, REQUESTER, OUTSIDER],
  [TENANT_B]: [B_APPROVER, B_DEPUTY, B_REQUESTER],
};

export const ADMIN_ACTOR = 'user:workflow-admin';
export const SUBJECT_TYPE = 'recruitment.requisition';

/** The instant every decision in the suite is made at, and every delegation period is set around. */
export const NOW = new Date('2026-08-15T09:00:00.000Z');

/**
 * A subject type **no adapter owns**, for suites that are not about the seam.
 *
 * A terminal decision about a `recruitment.requisition` is carried into Recruitment, so a delegation
 * or tenancy suite using one would depend on a requisition existing and on Recruitment's own
 * lifecycle — two things it is not asking about. `leave.request` is a real subject type nothing
 * routes, so the decision completes inside Workflow and each assertion stays about the one question
 * its test came for. The seam itself is proved in its own suites.
 */
export const UNADOPTED = 'leave.request';

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

/** The employments the manager chain runs over: the requester's, and their manager's. */
export const REQUESTER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e001';
export const MANAGER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e002';
export const B_REQUESTER_EMPLOYMENT = '01930000-0000-7000-8000-00000000e003';

/**
 * A reporting line, and the two employments and two links that make it mean something.
 *
 * Seeded as the owner, exactly as the memberships above are and for the same reason: another
 * module's world is fixture work, and every assertion still runs through the unprivileged role.
 * What is deliberately **real** here is the shape — a person is linked to an employment in Identity,
 * that employment reports to another in Employment, and that one is linked back to a person. The
 * manager chain has three links and this seeds all three, so a suite that passes is passing over the
 * columns the adapter actually reads.
 *
 * `line` is optional: an employment with no reporting line is how "this requester has no manager"
 * is arranged, and it is arranged by leaving a row out rather than by stubbing an answer.
 */
export const seedReportingLine = async (
  admin: Pool,
  chain: {
    readonly tenantId: string;
    readonly requesterMembershipId: string;
    readonly requesterEmploymentId: string;
    readonly line?: {
      readonly managerEmploymentId: string;
      readonly managerMembershipIds: readonly string[];
      readonly lineType?: 'primary' | 'functional';
      readonly effectiveFrom?: string;
      readonly effectiveTo?: string;
    };
  },
): Promise<void> => {
  await seedEmployments(admin, chain.tenantId, [
    chain.requesterEmploymentId,
    ...(chain.line === undefined ? [] : [chain.line.managerEmploymentId]),
  ]);
  await linkEmployment(
    admin,
    chain.tenantId,
    chain.requesterMembershipId,
    chain.requesterEmploymentId,
    true,
  );

  if (chain.line === undefined) return;

  await admin.query(
    `insert into employment_reporting_line
       (id, tenant_id, employment_id, manager_employment_id, line_type, effective_from,
        effective_to, ${AUDIT_COLUMNS})
     values (gen_random_uuid(), $1, $2, $3, $4, $5::timestamptz, $6::timestamptz, ${AUDIT})`,
    [
      chain.tenantId,
      chain.requesterEmploymentId,
      chain.line.managerEmploymentId,
      chain.line.lineType ?? 'primary',
      chain.line.effectiveFrom ?? '2026-01-01T00:00:00Z',
      chain.line.effectiveTo ?? null,
    ],
  );

  for (const membershipId of chain.line.managerMembershipIds) {
    // Primary for everybody except the requester, who already holds their own employment as their
    // primary — `employment_link_one_primary_key` is unique per membership and would refuse a
    // second. A requester who *also* holds their manager's employment is exactly the self-manager
    // case, and it is representable precisely because `is_primary` is not what this query filters on.
    await linkEmployment(
      admin,
      chain.tenantId,
      membershipId,
      chain.line.managerEmploymentId,
      membershipId !== chain.requesterMembershipId,
    );
  }
};

/**
 * The employments themselves, and the people they reference.
 *
 * An employment carries a real foreign key to a person, so one has to exist. The person is
 * incidental to the manager chain — nothing on this path reads a name — but seeding it through the
 * real column is what keeps the employment rows legal rather than contrived.
 */
const seedEmployments = async (
  admin: Pool,
  tenantId: string,
  employmentIds: readonly string[],
): Promise<void> => {
  for (const [index, employmentId] of employmentIds.entries()) {
    const personId = `${employmentId.slice(0, -4)}d${employmentId.slice(-3)}`;

    await admin.query(
      `insert into person
         (id, tenant_id, person_number, status, metadata, ${AUDIT_COLUMNS})
       values ($1, $2, $3, 'active', '{}'::jsonb, ${AUDIT})
       on conflict (id) do nothing`,
      [personId, tenantId, `P-${employmentId.slice(-4)}-${String(index)}`],
    );
    await admin.query(
      `insert into employment
         (id, tenant_id, person_id, employment_number, status, employment_type_code,
          original_hire_date, start_date, metadata, ${AUDIT_COLUMNS})
       values ($1, $2, $3, $4, 'active', 'permanent',
               date '2026-01-01', date '2026-01-01', '{}'::jsonb, ${AUDIT})
       on conflict (id) do nothing`,
      [employmentId, tenantId, personId, `E-${employmentId.slice(-4)}-${String(index)}`],
    );
  }
};

/**
 * One employment link, primary and live.
 *
 * `is_primary` is per **membership**, so two people may each hold the same employment as their
 * primary — which is exactly the ambiguity the manager chain has to refuse rather than resolve, and
 * seeding it truthfully is what lets a suite reach that case at all.
 */
const linkEmployment = async (
  admin: Pool,
  tenantId: string,
  membershipId: string,
  employmentId: string,
  isPrimary: boolean,
): Promise<void> => {
  await admin.query(
    `insert into employment_link
       (id, tenant_id, membership_id, employment_id, is_primary, status, linked_at, ${AUDIT_COLUMNS})
     values (gen_random_uuid(), $1, $2, $3, $4, 'linked', now(), ${AUDIT})
     on conflict (tenant_id, membership_id, employment_id) do nothing`,
    [tenantId, membershipId, employmentId, isPrimary],
  );
};
