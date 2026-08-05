import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * Every fact Workforce Identity publishes.
 *
 * Names are `identity.<aggregate>.<past participle>`, because an event is something that has
 * already happened. `identity.membership.ended`, never `identity.membership.end` — the second
 * reads as an instruction, and an instruction can be refused, which is precisely the confusion
 * that makes a consumer treat an event as a command.
 *
 * Every event is version 1. A payload change that removes or repurposes a field is version 2,
 * published alongside version 1 until consumers have moved. Events outlive the code that wrote
 * them, so the version is on the envelope from the first one.
 */

export const IDENTITY_EVENT_VERSION = 1;

export const IdentityEvents = {
  userProvisioned: 'identity.workforce-user.provisioned',
  userActivated: 'identity.workforce-user.activated',
  userSuspended: 'identity.workforce-user.suspended',
  userReinstated: 'identity.workforce-user.reinstated',
  userDeactivated: 'identity.workforce-user.deactivated',

  membershipGranted: 'identity.tenant-membership.granted',
  membershipActivated: 'identity.tenant-membership.activated',
  membershipSuspended: 'identity.tenant-membership.suspended',
  membershipReinstated: 'identity.tenant-membership.reinstated',
  membershipEnded: 'identity.tenant-membership.ended',

  invitationIssued: 'identity.invitation.issued',
  invitationAccepted: 'identity.invitation.accepted',
  invitationRevoked: 'identity.invitation.revoked',
  invitationExpired: 'identity.invitation.expired',

  portalGranted: 'identity.portal-assignment.granted',
  portalRevoked: 'identity.portal-assignment.revoked',

  employmentLinked: 'identity.employment-link.linked',
  employmentUnlinked: 'identity.employment-link.unlinked',
  primaryEmploymentChanged: 'identity.employment-link.primary-changed',

  delegationCreated: 'identity.delegation.created',
  delegationRevoked: 'identity.delegation.revoked',
  delegationExpired: 'identity.delegation.expired',

  businessProfileUpdated: 'identity.business-profile.updated',
  userPreferenceUpdated: 'identity.user-preference.updated',
} as const;

export type IdentityEventName = (typeof IdentityEvents)[keyof typeof IdentityEvents];

/**
 * Builds an identity event. Wrapping the kernel's factory keeps the version and the aggregate
 * type in one place per aggregate rather than repeated at every `recordEvent` call, where one
 * of them would eventually be wrong.
 */
export const identityEvent = <TPayload>(
  eventName: IdentityEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: IDENTITY_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
