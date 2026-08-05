import {
  directionOf,
  pagedResult,
  success,
  type PagedResult,
  type Query,
  type QueryHandler,
} from '@work/kernel';

import type { BusinessProfileState } from '../domain/business-profile.js';
import type { DelegationState } from '../domain/delegation.js';
import type { EmploymentLinkState } from '../domain/employment-link.js';
import type { InvitationState } from '../domain/invitation.js';
import type { PortalAssignmentState } from '../domain/portal-assignment.js';
import type { TenantMembershipState } from '../domain/tenant-membership.js';
import type { UserPreferenceState } from '../domain/user-preference.js';
import type {
  BusinessProfileView,
  DelegationView,
  EmploymentLinkView,
  InvitationView,
  PortalAssignmentView,
  TenantMembershipView,
  UserPreferenceView,
} from '../contracts/views.js';

import { notFound } from './identity-context.js';
import { IdentityPermissions } from './identity-permissions.js';
import type { IdentityDependencies } from './identity-dependencies.js';

/**
 * The read side.
 *
 * Queries return contract views, never aggregates: a caller holding an aggregate holds something
 * whose internals are free to change, and the boundary would last until the first refactor.
 *
 * They read the transactional tables directly, which is correct for this phase and stated as a
 * limitation rather than left implicit — these are small, tenant-scoped, index-covered reads,
 * and there is no projection store yet (Phase 1.1's debt register, carried forward). Reporting
 * and dashboards will read projections when there are projections to read.
 */

const MAXIMUM_PAGE_SIZE = 100;
/**
 * State to view, once each.
 *
 * The mapping is spelled out rather than achieved by spreading the state, so that adding a
 * column to a table does not silently publish it through a contract other modules depend on.
 */
const asMembershipView = (state: TenantMembershipState): TenantMembershipView => ({
  id: state.id,
  tenantId: state.tenantId,
  workforceUserId: state.workforceUserId,
  status: state.status,
  ...(state.invitedAt === undefined ? {} : { invitedAt: state.invitedAt }),
  ...(state.joinedAt === undefined ? {} : { joinedAt: state.joinedAt }),
  ...(state.endedAt === undefined ? {} : { endedAt: state.endedAt }),
});

const asInvitationView = (state: InvitationState): InvitationView => ({
  id: state.id,
  email: state.email,
  portals: state.portals,
  status: state.status,
  issuedAt: state.issuedAt,
  expiresAt: state.expiresAt,
  ...(state.acceptedAt === undefined ? {} : { acceptedAt: state.acceptedAt }),
});

const asProfileView = (state: BusinessProfileState): BusinessProfileView => ({
  id: state.id,
  membershipId: state.membershipId,
  displayName: state.displayName,
  ...(state.jobTitle === undefined ? {} : { jobTitle: state.jobTitle }),
  ...(state.businessEmail === undefined ? {} : { businessEmail: state.businessEmail }),
  ...(state.businessPhone === undefined ? {} : { businessPhone: state.businessPhone }),
});

/** Direction is derived here so no client ever has to know which languages read right to left. */
const asPreferenceView = (state: UserPreferenceState): UserPreferenceView => ({
  id: state.id,
  membershipId: state.membershipId,
  language: state.language,
  calendar: state.calendar,
  timeZone: state.timeZone,
  numerals: state.numerals,
  direction: directionOf(state.language),
});

const asPortalView = (state: PortalAssignmentState): PortalAssignmentView => ({
  id: state.id,
  membershipId: state.membershipId,
  portal: state.portal,
  status: state.status,
  grantedAt: state.grantedAt,
  ...(state.revokedAt === undefined ? {} : { revokedAt: state.revokedAt }),
});

const asEmploymentView = (state: EmploymentLinkState): EmploymentLinkView => ({
  id: state.id,
  membershipId: state.membershipId,
  employmentId: state.employmentId,
  isPrimary: state.isPrimary,
  status: state.status,
  linkedAt: state.linkedAt,
  ...(state.unlinkedAt === undefined ? {} : { unlinkedAt: state.unlinkedAt }),
});

const asDelegationView = (state: DelegationState): DelegationView => ({
  id: state.id,
  delegatorMembershipId: state.delegatorMembershipId,
  delegateMembershipId: state.delegateMembershipId,
  scope: state.scope,
  effectiveFrom: state.effectiveFrom,
  effectiveTo: state.effectiveTo,
  status: state.status,
  reason: state.reason,
});

const clampPageSize = (requested: number): number =>
  Math.min(Math.max(requested, 1), MAXIMUM_PAGE_SIZE);

export interface ListMemberships extends Query {
  readonly queryName: 'identity.list-memberships';
  readonly status?: string;
  readonly page: number;
  readonly pageSize: number;
}

export const listMembershipsHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<ListMemberships, PagedResult<TenantMembershipView>> => ({
  queryName: 'identity.list-memberships',
  permission: IdentityPermissions.membershipRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const pageSize = clampPageSize(query.pageSize);
      const page = Math.max(query.page, 1);
      const found = await dependencies.stores.memberships.list(transaction, {
        ...(query.status === undefined ? {} : { status: query.status }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      return success(
        pagedResult<TenantMembershipView>(
          found.items.map(asMembershipView),
          page,
          pageSize,
          found.total,
        ),
      );
    }),
});

export interface ListInvitations extends Query {
  readonly queryName: 'identity.list-invitations';
  readonly status?: string;
  readonly page: number;
  readonly pageSize: number;
}

export const listInvitationsHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<ListInvitations, PagedResult<InvitationView>> => ({
  queryName: 'identity.list-invitations',
  permission: IdentityPermissions.invitationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const pageSize = clampPageSize(query.pageSize);
      const page = Math.max(query.page, 1);
      const found = await dependencies.stores.invitations.list(transaction, {
        ...(query.status === undefined ? {} : { status: query.status }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });

      return success(
        pagedResult<InvitationView>(found.items.map(asInvitationView), page, pageSize, found.total),
      );
    }),
});

/** Everything a portal needs to render one member's page, in one round trip. */
export interface DescribeMember extends Query {
  readonly queryName: 'identity.describe-member';
  readonly membershipId: string;
}

export interface MemberDescription {
  readonly membership: TenantMembershipView;
  readonly profile?: BusinessProfileView;
  readonly preferences?: UserPreferenceView;
  readonly portals: readonly PortalAssignmentView[];
  readonly employments: readonly EmploymentLinkView[];
  readonly delegations: readonly DelegationView[];
}

export const describeMemberHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<DescribeMember, MemberDescription> => ({
  queryName: 'identity.describe-member',
  permission: IdentityPermissions.membershipRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const membership = await dependencies.stores.memberships.byId(
        transaction,
        query.membershipId,
      );

      if (membership === undefined) return notFound('membership');

      // One round trip's worth of reads, issued together: a member page that made six sequential
      // queries would spend most of its budget waiting rather than working.
      const [profile, preferences, portals, employments, delegations] = await Promise.all([
        dependencies.stores.profiles.forMembership(transaction, query.membershipId),
        dependencies.stores.preferences.forMembership(transaction, query.membershipId),
        dependencies.stores.portals.forMembership(transaction, query.membershipId),
        dependencies.stores.employmentLinks.forMembership(transaction, query.membershipId),
        dependencies.stores.delegations.forDelegator(transaction, query.membershipId),
      ]);

      return success({
        membership: asMembershipView(membership),
        ...(profile === undefined ? {} : { profile: asProfileView(profile) }),
        ...(preferences === undefined ? {} : { preferences: asPreferenceView(preferences) }),
        portals: portals.map(asPortalView),
        employments: employments.map(asEmploymentView),
        delegations: delegations.map(asDelegationView),
      });
    }),
});

/** Name search across every language a profile carries, for the member directory. */
export interface SearchMembers extends Query {
  readonly queryName: 'identity.search-members';
  readonly term: string;
  readonly limit: number;
}

export const searchMembersHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<SearchMembers, readonly BusinessProfileView[]> => ({
  queryName: 'identity.search-members',
  permission: IdentityPermissions.profileRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.profiles.search(
        transaction,
        query.term.trim(),
        clampPageSize(query.limit),
      );

      return success(found.map(asProfileView));
    }),
});

/** Who is currently acting for whom — the question Workflow will ask from Phase 16. */
export interface ActiveDelegationsFor extends Query {
  readonly queryName: 'identity.active-delegations-for';
  readonly delegateMembershipId: string;
  readonly atInstant: Date;
}

export const activeDelegationsForHandler = (
  dependencies: IdentityDependencies,
): QueryHandler<ActiveDelegationsFor, readonly DelegationView[]> => ({
  queryName: 'identity.active-delegations-for',
  permission: IdentityPermissions.delegationRead,

  handle: async (query) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const found = await dependencies.stores.delegations.forDelegate(
        transaction,
        query.delegateMembershipId,
        query.atInstant,
      );

      return success(found.map(asDelegationView));
    }),
});
