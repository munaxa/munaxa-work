import type { Transaction } from '@work/kernel';

import type { BusinessProfileState } from '../domain/business-profile.js';
import type { DelegationState } from '../domain/delegation.js';
import type { EmploymentLinkState } from '../domain/employment-link.js';
import type { InvitationState } from '../domain/invitation.js';
import type { TenantMembershipState } from '../domain/tenant-membership.js';
import type { PortalAssignmentState } from '../domain/portal-assignment.js';
import type { UserPreferenceState } from '../domain/user-preference.js';
import type { WorkforceUserState } from '../domain/workforce-user.js';
import type { PortalKey } from '../domain/identity-vocabulary.js';

/**
 * What the application layer needs from persistence, stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs, and infrastructure
 * implements it. Declaring these in infrastructure and importing them here would invert that and
 * make the use cases untestable without a database, which is how a test suite ends up needing
 * PostgreSQL to check a state machine.
 *
 * Every method takes the `Transaction`, so a use case cannot accidentally read outside the unit
 * of work it is writing in.
 */

export interface WorkforceUserStore {
  byId(transaction: Transaction, id: string): Promise<WorkforceUserState | undefined>;
  byPlatformUserId(
    transaction: Transaction,
    platformUserId: string,
  ): Promise<WorkforceUserState | undefined>;
  insert(transaction: Transaction, state: WorkforceUserState): Promise<void>;
  update(transaction: Transaction, state: WorkforceUserState, expected: number): Promise<void>;
}

export interface MembershipQuery {
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface TenantMembershipStore {
  byId(transaction: Transaction, id: string): Promise<TenantMembershipState | undefined>;
  byUser(
    transaction: Transaction,
    workforceUserId: string,
  ): Promise<TenantMembershipState | undefined>;
  list(
    transaction: Transaction,
    query: MembershipQuery,
  ): Promise<{ readonly items: readonly TenantMembershipState[]; readonly total: number }>;
  insert(transaction: Transaction, state: TenantMembershipState): Promise<void>;
  update(transaction: Transaction, state: TenantMembershipState, expected: number): Promise<void>;
}

export interface InvitationQuery {
  readonly status?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface InvitationStore {
  byId(transaction: Transaction, id: string): Promise<InvitationState | undefined>;
  pendingForEmail(transaction: Transaction, email: string): Promise<InvitationState | undefined>;
  list(
    transaction: Transaction,
    query: InvitationQuery,
  ): Promise<{ readonly items: readonly InvitationState[]; readonly total: number }>;
  insert(transaction: Transaction, state: InvitationState): Promise<void>;
  update(transaction: Transaction, state: InvitationState, expected: number): Promise<void>;
}

export interface PortalAssignmentStore {
  byId(transaction: Transaction, id: string): Promise<PortalAssignmentState | undefined>;
  forMembershipAndPortal(
    transaction: Transaction,
    membershipId: string,
    portal: PortalKey,
  ): Promise<PortalAssignmentState | undefined>;
  forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<readonly PortalAssignmentState[]>;
  insert(transaction: Transaction, state: PortalAssignmentState): Promise<void>;
  update(transaction: Transaction, state: PortalAssignmentState, expected: number): Promise<void>;
}

export interface EmploymentLinkStore {
  byId(transaction: Transaction, id: string): Promise<EmploymentLinkState | undefined>;
  forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<readonly EmploymentLinkState[]>;
  primaryFor(
    transaction: Transaction,
    membershipId: string,
  ): Promise<EmploymentLinkState | undefined>;
  insert(transaction: Transaction, state: EmploymentLinkState): Promise<void>;
  update(transaction: Transaction, state: EmploymentLinkState, expected: number): Promise<void>;
}

export interface DelegationStore {
  byId(transaction: Transaction, id: string): Promise<DelegationState | undefined>;
  forDelegate(
    transaction: Transaction,
    membershipId: string,
    atInstant: Date,
  ): Promise<readonly DelegationState[]>;
  forDelegator(transaction: Transaction, membershipId: string): Promise<readonly DelegationState[]>;
  insert(transaction: Transaction, state: DelegationState): Promise<void>;
  update(transaction: Transaction, state: DelegationState, expected: number): Promise<void>;
}

export interface BusinessProfileStore {
  forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<BusinessProfileState | undefined>;
  /** Name search, in either language, for the member directory. */
  search(
    transaction: Transaction,
    term: string,
    limit: number,
  ): Promise<readonly BusinessProfileState[]>;
  insert(transaction: Transaction, state: BusinessProfileState): Promise<void>;
  update(transaction: Transaction, state: BusinessProfileState, expected: number): Promise<void>;
}

export interface UserPreferenceStore {
  forMembership(
    transaction: Transaction,
    membershipId: string,
  ): Promise<UserPreferenceState | undefined>;
  insert(transaction: Transaction, state: UserPreferenceState): Promise<void>;
  update(transaction: Transaction, state: UserPreferenceState, expected: number): Promise<void>;
}

/** Everything the module's use cases persist, in one injectable bundle. */
export interface IdentityStores {
  readonly users: WorkforceUserStore;
  readonly memberships: TenantMembershipStore;
  readonly invitations: InvitationStore;
  readonly portals: PortalAssignmentStore;
  readonly employmentLinks: EmploymentLinkStore;
  readonly delegations: DelegationStore;
  readonly profiles: BusinessProfileStore;
  readonly preferences: UserPreferenceStore;
}

/**
 * The tenant's defaults for anything a member may override.
 *
 * Read through a port rather than from a constant because none of it is ours to decide: a
 * tenant in Riyadh and one in Amman disagree about the calendar, and an invitation validity
 * period is a policy each customer sets. Nothing business-specific is hardcoded (00B).
 */
export interface TenantIdentitySettings {
  readonly language: string;
  readonly calendar: 'gregorian' | 'hijri';
  readonly timeZone: string;
  readonly numerals: 'western' | 'arabic-indic';
  readonly invitationValidityDays: number;
  readonly defaultPortals: readonly PortalKey[];
}

export interface TenantSettingsPort {
  settingsFor(tenantId: string): Promise<TenantIdentitySettings>;
}

/** The clock, injected so that expiry, delegation windows and audit instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
