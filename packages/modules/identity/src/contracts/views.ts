import type {
  DelegationStatus,
  EmploymentLinkStatus,
  InvitationStatus,
  MembershipStatus,
  NumeralSystem,
  PortalAssignmentStatus,
  PortalKey,
  WorkforceUserStatus,
} from '../domain/identity-vocabulary.js';

/**
 * The read shapes other modules, the API and the SDK depend on.
 *
 * They are deliberately *not* the aggregates. An aggregate has behaviour and invariants and is
 * loaded to be changed; a view is a flat, serializable answer to a question. Publishing the
 * aggregate instead would mean every consumer holds a reference to something whose internals
 * are free to change, and the boundary would last until the first refactor.
 *
 * Dates are `Date` rather than strings: serialization is the API layer's business, and a
 * contract that pre-formatted them would force one format on every consumer, including the ones
 * rendering Hijri.
 */

export interface WorkforceUserView {
  readonly id: string;
  readonly platformUserId: string;
  readonly status: WorkforceUserStatus;
}

export interface TenantMembershipView {
  readonly id: string;
  readonly tenantId: string;
  readonly workforceUserId: string;
  readonly status: MembershipStatus;
  readonly invitedAt?: Date;
  readonly joinedAt?: Date;
  readonly endedAt?: Date;
}

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly portals: readonly PortalKey[];
  readonly status: InvitationStatus;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt?: Date;
}

export interface PortalAssignmentView {
  readonly id: string;
  readonly membershipId: string;
  readonly portal: PortalKey;
  readonly status: PortalAssignmentStatus;
  readonly grantedAt: Date;
  readonly revokedAt?: Date;
}

export interface EmploymentLinkView {
  readonly id: string;
  readonly membershipId: string;
  /** Employment's identifier, referenced by identity only. Phase 5 owns what it means. */
  readonly employmentId: string;
  readonly isPrimary: boolean;
  readonly status: EmploymentLinkStatus;
  readonly linkedAt: Date;
  readonly unlinkedAt?: Date;
}

export interface DelegationView {
  readonly id: string;
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  readonly scope: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  readonly status: DelegationStatus;
  readonly reason: string;
}

export interface BusinessProfileView {
  readonly id: string;
  readonly membershipId: string;
  /** Language tag to text. Both first-class languages are always present. */
  readonly displayName: Readonly<Record<string, string>>;
  readonly jobTitle?: Readonly<Record<string, string>>;
  readonly businessEmail?: string;
  readonly businessPhone?: string;
}

export interface UserPreferenceView {
  readonly id: string;
  readonly membershipId: string;
  readonly language: string;
  readonly calendar: 'gregorian' | 'hijri';
  readonly timeZone: string;
  readonly numerals: NumeralSystem;
  /** Derived from the language. Included so a client never has to know the RTL list. */
  readonly direction: 'ltr' | 'rtl';
}

/**
 * Whether one membership may act in this tenant right now — and nothing else about them.
 *
 * **One field, and the field is a conclusion rather than a fact.** `isActingMembership` is Identity's
 * rule for what "acting" means, and this view is that rule already applied. Publishing the raw status
 * instead would hand every consumer the job of re-deciding whether `suspended` counts, and the second
 * consumer to answer that differently from the first is the one nobody notices.
 *
 * **The absences are the contract.** No status, no profile, no preferences, no portals, no
 * employments, no delegations, no roles, no organization, no person, no tenant. A caller that needs
 * any of those is asking a different question and has a different query to ask — this one is for a
 * consumer that has a membership identifier and needs to know only whether it can be asked to do
 * something. Widening it would turn a predicate into the member directory this module deliberately
 * does not publish.
 */
export interface MembershipStandingView {
  readonly active: boolean;
}

/**
 * Who a membership is, for the one purpose of addressing them.
 *
 * One field, and the restraint is the contract: a notification is delivered to a *workforce user*
 * because a person holding memberships in three tenants is one person with one set of channel
 * preferences (ADR-0033), while the modules that ask for one address *memberships*. This crosses
 * that boundary and does nothing else.
 *
 * It carries no name, address, locale or channel preference — Communications resolves how to reach
 * somebody; this answers only who. Adding a field here would hand it to every consumer whether or
 * not they needed it, which is the property that ruled out `describe-member` in the first place.
 */
export interface MembershipRecipientView {
  readonly workforceUserId: string;
}
