import { ConcurrencyException, currentTenantId, type Transaction } from '@work/kernel';

import type { BusinessProfileState } from '../domain/business-profile.js';
import type { DelegationState } from '../domain/delegation.js';
import type { EmploymentLinkState } from '../domain/employment-link.js';
import type { InvitationState } from '../domain/invitation.js';
import type { PortalAssignmentState } from '../domain/portal-assignment.js';
import type { TenantMembershipState } from '../domain/tenant-membership.js';
import type { UserPreferenceState } from '../domain/user-preference.js';
import type { WorkforceUserState } from '../domain/workforce-user.js';

import type { IdentityStores } from './identity-ports.js';

/**
 * In-memory stores for the application-service tests.
 *
 * They keep the two guarantees the real repositories make and a naive fake would drop, because a
 * fake that is more permissive than production is worse than no fake — every test passes and the
 * difference shows up in production:
 *
 * - **Tenant scoping.** Every read filters by the tenant in context, exactly as both the query
 *   predicate and the row-level security policy do. A use case that leaked across tenants would
 *   fail here as well as against a database.
 * - **Optimistic concurrency.** A write asserting a stale version throws, so the concurrency
 *   tests are real tests rather than assertions about a mock.
 *
 * They live in `src` rather than a test folder so that the module's own tests and any consumer's
 * can use them, and so they are typechecked by the same configuration as the code they stand in
 * for. They are exported from the package's test surface, never from its runtime surface.
 */

interface Stored {
  readonly id: string;
  readonly tenantId?: string;
  readonly version: number;
}

class Table<TState extends Stored> {
  private readonly rows = new Map<string, TState>();

  public constructor(private readonly name: string) {}

  public all(): readonly TState[] {
    const tenantId = currentTenantId();
    return [...this.rows.values()].filter((row) => row.tenantId === tenantId);
  }

  /** Rows regardless of tenant. Only the deliberately tenant-less user table uses this. */
  public every(): readonly TState[] {
    return [...this.rows.values()];
  }

  public byId(id: string): TState | undefined {
    return this.all().find((row) => row.id === id);
  }

  /**
   * Stores at version 1, exactly as `auditForInsert` does in the real repositories.
   *
   * A fresh aggregate carries version 0 — it has never been written — and the row it becomes
   * carries 1. A fake that stored 0 would make every first update in every test pass a version
   * production would reject, which is the class of difference that makes a fake worse than none.
   */
  public insert(state: TState): void {
    this.rows.set(state.id, { ...state, version: 1 });
  }

  public update(state: TState, expected: number): void {
    const existing = this.rows.get(state.id);

    if (existing === undefined || existing.version !== expected) {
      throw new ConcurrencyException(this.name, expected, existing?.version ?? -1);
    }
    this.rows.set(state.id, { ...state, version: expected + 1 });
  }
}

const page = <TState>(
  items: readonly TState[],
  limit: number,
  offset: number,
): { readonly items: readonly TState[]; readonly total: number } => ({
  items: items.slice(offset, offset + limit),
  total: items.length,
});

const matchesStatus = <TState extends { status: string }>(
  items: readonly TState[],
  status: string | undefined,
): readonly TState[] => (status === undefined ? items : items.filter((i) => i.status === status));

/**
 * A full set of stores. Each call is an isolated database, so no test inherits another's rows.
 *
 * One factory per store rather than one large object literal: the whole point of these is to
 * behave like the repositories they stand in for, and a reader checking that has to be able to
 * see one of them at a time.
 */
export const inMemoryIdentityStores = (): IdentityStores => {
  // The two tables `activeForEmployment` joins, built before the stores so both can see them. The
  // repository resolves that question in one SQL join; a fake that could not reach both tables
  // would have to answer it some other way, and would then be testing something else.
  const memberships = new Table<TenantMembershipState>('tenant_membership');
  const employmentLinks = new Table<EmploymentLinkState>('employment_link');

  return {
    users: userStore(new Table<WorkforceUserState & Stored>('workforce_user')),
    memberships: membershipStore(memberships, employmentLinks),
    invitations: invitationStore(new Table<InvitationState>('invitation')),
    portals: portalStore(new Table<PortalAssignmentState>('portal_assignment')),
    employmentLinks: employmentLinkStore(employmentLinks),
    delegations: delegationStore(new Table<DelegationState>('delegation')),
    profiles: profileStore(new Table<BusinessProfileState>('business_profile')),
    preferences: preferenceStore(new Table<UserPreferenceState>('user_preference')),
  };
};

/** Tenant-less by design (ADR-0033), so this one and only this one reads across tenants. */
const userStore = (rows: Table<WorkforceUserState & Stored>): IdentityStores['users'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.every().find((row) => row.id === id)),
  byPlatformUserId: (_: Transaction, platformUserId) =>
    Promise.resolve(rows.every().find((row) => row.platformUserId === platformUserId)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const membershipStore = (
  rows: Table<TenantMembershipState>,
  links: Table<EmploymentLinkState>,
): IdentityStores['memberships'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  // Both predicates, exactly as the repository applies them: a live link *and* a membership that
  // may act. Sorted by identifier so two calls agree, and never narrowed to one.
  activeForEmployment: (_: Transaction, employmentId) =>
    Promise.resolve(
      links
        .all()
        .filter((link) => link.employmentId === employmentId && link.status === 'linked')
        .flatMap((link) => {
          const membership = rows.byId(link.membershipId);

          return membership === undefined || membership.status !== 'active' ? [] : [membership];
        })
        .sort((left, right) => left.id.localeCompare(right.id)),
    ),
  byUser: (_: Transaction, workforceUserId) =>
    Promise.resolve(rows.all().find((row) => row.workforceUserId === workforceUserId)),
  list: (_: Transaction, query) =>
    Promise.resolve(page(matchesStatus(rows.all(), query.status), query.limit, query.offset)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const invitationStore = (rows: Table<InvitationState>): IdentityStores['invitations'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  // Case-insensitive, matching the partial unique index rather than merely resembling it.
  pendingForEmail: (_: Transaction, email) =>
    Promise.resolve(
      rows
        .all()
        .find(
          (row) =>
            row.status === 'pending' &&
            row.email.trim().toLowerCase() === email.trim().toLowerCase(),
        ),
    ),
  list: (_: Transaction, query) =>
    Promise.resolve(page(matchesStatus(rows.all(), query.status), query.limit, query.offset)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const portalStore = (rows: Table<PortalAssignmentState>): IdentityStores['portals'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forMembershipAndPortal: (_: Transaction, membershipId, portal) =>
    Promise.resolve(
      rows.all().find((row) => row.membershipId === membershipId && row.portal === portal),
    ),
  forMembership: (_: Transaction, membershipId) =>
    Promise.resolve(rows.all().filter((row) => row.membershipId === membershipId)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const employmentLinkStore = (
  rows: Table<EmploymentLinkState>,
): IdentityStores['employmentLinks'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  forMembership: (_: Transaction, membershipId) =>
    Promise.resolve(rows.all().filter((row) => row.membershipId === membershipId)),
  primaryFor: (_: Transaction, membershipId) =>
    Promise.resolve(
      rows
        .all()
        .find(
          (row) => row.membershipId === membershipId && row.isPrimary && row.status === 'linked',
        ),
    ),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const delegationStore = (rows: Table<DelegationState>): IdentityStores['delegations'] => ({
  byId: (_: Transaction, id) => Promise.resolve(rows.byId(id)),
  // Filtered by the period, not the status, exactly as the repository does — so a sweep that has
  // not run cannot make a lapsed delegation look live.
  forDelegate: (_: Transaction, membershipId, atInstant) =>
    Promise.resolve(
      rows
        .all()
        .filter(
          (row) =>
            row.delegateMembershipId === membershipId &&
            row.status !== 'revoked' &&
            row.effectiveFrom.getTime() <= atInstant.getTime() &&
            row.effectiveTo.getTime() > atInstant.getTime(),
        ),
    ),
  forDelegator: (_: Transaction, membershipId) =>
    Promise.resolve(rows.all().filter((row) => row.delegatorMembershipId === membershipId)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const profileStore = (rows: Table<BusinessProfileState>): IdentityStores['profiles'] => ({
  forMembership: (_: Transaction, membershipId) =>
    Promise.resolve(rows.all().find((row) => row.membershipId === membershipId)),
  search: (_: Transaction, term, limit) =>
    Promise.resolve(
      rows
        .all()
        .filter((row) =>
          Object.values(row.displayName).some((name) =>
            name.toLowerCase().includes(term.toLowerCase()),
          ),
        )
        .slice(0, limit),
    ),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});

const preferenceStore = (rows: Table<UserPreferenceState>): IdentityStores['preferences'] => ({
  forMembership: (_: Transaction, membershipId) =>
    Promise.resolve(rows.all().find((row) => row.membershipId === membershipId)),
  insert: (_: Transaction, state) => Promise.resolve(rows.insert(state)),
  update: (_: Transaction, state, expected) => Promise.resolve(rows.update(state, expected)),
});
