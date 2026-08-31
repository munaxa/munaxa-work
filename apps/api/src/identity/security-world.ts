import type { Pool } from 'pg';

/**
 * The world the security suites act in: two tenants, four people, and the memberships between
 * them.
 *
 * Its own world rather than a borrowed one, because the shapes a security suite needs are exactly
 * the shapes other suites have no reason to arrange: somebody who belongs to one tenant only, two
 * such people in the *same* tenant, one in another tenant, and one person who genuinely belongs to
 * both. The last is what makes "no grant union" a claim about a real account rather than about two
 * strangers who were never going to share anything.
 */

export const TENANT_A = '01931111-0000-7000-8000-0000000055ee';
export const TENANT_B = '01931111-0000-7000-8000-0000000066ff';

/**
 * The people these suites act as, and why each one exists.
 *
 * Its own world rather than a borrowed one, because the shapes a security suite needs are exactly
 * the shapes other suites have no reason to arrange: somebody who belongs to one tenant only, two
 * such people in the *same* tenant, one in another tenant, and one person who genuinely belongs to
 * both. The last is what makes "no grant union" a claim about a real account rather than about two
 * strangers who were never going to share anything.
 */
export const WORKFORCE_USERS = {
  member: '01931111-0000-7000-8000-00000000a001',
  otherMember: '01931111-0000-7000-8000-00000000a002',
  bMember: '01931111-0000-7000-8000-00000000a003',
  dual: '01931111-0000-7000-8000-00000000a004',
} as const;

/** One membership in tenant A, and the person behind it belongs to nothing else. */
export const MEMBER = '01931111-0000-7000-8000-00000000b001';
/** A second person in tenant A, so one membership's grant can be shown not to reach another. */
export const OTHER_MEMBER = '01931111-0000-7000-8000-00000000b002';
/** Tenant B's own person. */
export const B_MEMBER = '01931111-0000-7000-8000-00000000c003';
/** One person, two tenants, two memberships. Nothing they hold in one reaches the other. */
export const DUAL_IN_A = '01931111-0000-7000-8000-00000000b004';
export const DUAL_IN_B = '01931111-0000-7000-8000-00000000c004';

const WORLD: readonly {
  readonly membershipId: string;
  readonly tenantId: string;
  readonly workforceUserId: string;
}[] = [
  { membershipId: MEMBER, tenantId: TENANT_A, workforceUserId: WORKFORCE_USERS.member },
  { membershipId: OTHER_MEMBER, tenantId: TENANT_A, workforceUserId: WORKFORCE_USERS.otherMember },
  { membershipId: B_MEMBER, tenantId: TENANT_B, workforceUserId: WORKFORCE_USERS.bMember },
  { membershipId: DUAL_IN_A, tenantId: TENANT_A, workforceUserId: WORKFORCE_USERS.dual },
  { membershipId: DUAL_IN_B, tenantId: TENANT_B, workforceUserId: WORKFORCE_USERS.dual },
];

/** The Platform account behind a workforce user. The `sub` a token carries. */
export const platformUserFor = (workforceUserId: string): string => `platform:${workforceUserId}`;

const AUDIT_COLUMNS = 'created_at, created_by, updated_at, updated_by, version';
const AUDIT = `now(), 'system:security-fixture', now(), 'system:security-fixture', 1`;

/**
 * Identity's rows, written as the **owner**.
 *
 * `workforce_user`'s policy admits a user only once a membership points at it and
 * `tenant_membership` is forced-RLS as well, so the unprivileged role these suites assert through
 * cannot bootstrap either — correctly, because in production Identity's own commands create them.
 * Seeding another module's world is fixture work; no security claim is made here, and every
 * assertion still runs through the unprivileged role.
 */
export const seedSecurityWorld = async (owner: Pool): Promise<void> => {
  for (const workforceUserId of Object.values(WORKFORCE_USERS)) {
    await owner.query(
      `insert into workforce_user (id, platform_user_id, status, ${AUDIT_COLUMNS})
       values ($1, $2, 'active', ${AUDIT}) on conflict (id) do nothing`,
      [workforceUserId, platformUserFor(workforceUserId)],
    );
  }
  for (const entry of WORLD) {
    await owner.query(
      `insert into tenant_membership
         (id, tenant_id, workforce_user_id, status, joined_at, ${AUDIT_COLUMNS})
       values ($1, $2, $3, 'active', now(), ${AUDIT}) on conflict (id) do nothing`,
      [entry.membershipId, entry.tenantId, entry.workforceUserId],
    );
  }
};

/** The workforce user behind a membership, for minting that person's token. */
export const personBehind = (membershipId: string): string => {
  const entry = WORLD.find((candidate) => candidate.membershipId === membershipId);

  if (entry === undefined) throw new Error(`No membership ${membershipId} in the fixture world.`);
  return entry.workforceUserId;
};
