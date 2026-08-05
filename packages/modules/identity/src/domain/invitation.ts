import { uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { InvitationStatus, PortalKey } from './identity-vocabulary.js';

/**
 * A tenant's request that a person join it.
 *
 * An invitation creates a Workforce User and a membership. It never creates a Platform account,
 * never issues a credential and never carries one (AD-009). There is no token field here, and
 * that is a design decision rather than an omission: an invitation token is a bearer credential,
 * and a bearer credential in this repository would be authentication, which belongs to Platform.
 *
 * So acceptance works the other way round. The invited person creates or signs into their
 * Platform account through Platform, and then — already authenticated — accepts this invitation
 * by its identifier. Munaxa Work learns who they are from the authenticated principal, never
 * from the invitation. An intercepted invitation link is therefore worth nothing on its own:
 * whoever follows it still has to be somebody Platform vouched for, and the address they were
 * invited at is checked against the account that turned up.
 *
 * `email` is personal data. It is the address a tenant typed, retained because an invitation
 * that cannot say who it was sent to cannot be audited or resent, and it is redacted from logs.
 */

export interface InvitationState {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly portals: readonly PortalKey[];
  readonly status: InvitationStatus;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt?: Date;
  readonly acceptedByWorkforceUserId?: string;
  readonly version: number;
}

/** Normalized for comparison only. The address as typed is what is stored and shown. */
const comparable = (email: string): string => email.trim().toLowerCase();

export class Invitation extends TenantScopedAggregate {
  private constructor(private state: InvitationState) {
    super(state.id, state.tenantId, state.version, 'Invitation');
  }

  /**
   * Issues an invitation. The validity period is configuration, not a constant here: a tenant
   * with a slow onboarding process and one that expects same-day acceptance are both ordinary,
   * and hardcoding either would make the other wrong.
   */
  public static issue(
    request: {
      readonly tenantId: string;
      readonly email: string;
      readonly portals: readonly PortalKey[];
      readonly expiresAt: Date;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<Invitation> {
    if (request.expiresAt.getTime() <= occurredAt.getTime()) {
      return refuse('invitation_expiry_not_in_future');
    }
    const invitation = new Invitation({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      email: request.email.trim(),
      portals: [...new Set(request.portals)],
      status: 'pending',
      issuedAt: occurredAt,
      expiresAt: request.expiresAt,
      version: 0,
    });

    invitation.record(
      IdentityEvents.invitationIssued,
      {
        email: invitation.email,
        portals: invitation.portals,
        expiresAt: request.expiresAt,
      },
      origin,
      occurredAt,
    );
    return accept(invitation);
  }

  public static rehydrate(state: InvitationState): Invitation {
    return new Invitation(state);
  }

  public get email(): string {
    return this.state.email;
  }

  public get portals(): readonly PortalKey[] {
    return this.state.portals;
  }

  public get expiresAt(): Date {
    return this.state.expiresAt;
  }

  public get currentStatus(): InvitationStatus {
    return this.state.status;
  }

  public hasExpiredBy(instant: Date): boolean {
    return this.state.expiresAt.getTime() <= instant.getTime();
  }

  /**
   * Accepts, on behalf of an authenticated person whose address matches the one invited.
   *
   * The address check is not security — the authenticated principal is what makes this safe —
   * but it stops the ordinary mistake of a shared link being followed by the wrong colleague,
   * which would otherwise silently give them a colleague's intended access.
   */
  public acceptBy(
    acceptor: { readonly workforceUserId: string; readonly email: string },
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<InvitationStatus> {
    if (this.state.status !== 'pending') {
      return refuse('invitation_not_pending', { status: this.state.status });
    }
    if (this.hasExpiredBy(occurredAt)) return refuse('invitation_expired');

    if (comparable(acceptor.email) !== comparable(this.state.email)) {
      return refuse('invitation_addressed_to_someone_else');
    }
    this.state = {
      ...this.state,
      status: 'accepted',
      acceptedAt: occurredAt,
      acceptedByWorkforceUserId: acceptor.workforceUserId,
    };
    this.record(
      IdentityEvents.invitationAccepted,
      { workforceUserId: acceptor.workforceUserId, portals: this.state.portals },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /** Withdrawn by the tenant. Only a pending invitation can be withdrawn. */
  public revoke(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<InvitationStatus> {
    if (this.state.status !== 'pending') {
      return refuse('invitation_not_pending', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'revoked' };
    this.record(IdentityEvents.invitationRevoked, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  /**
   * Marks an elapsed invitation expired.
   *
   * Expiry is recorded rather than inferred at read time, because an invitation that is
   * *treated* as expired but still says "pending" is an invitation somebody will re-send,
   * re-approve and wonder about. The scheduled job that calls this is idempotent: an already
   * expired invitation refuses rather than raising a second event.
   */
  public expire(origin: EventOrigin, occurredAt: Date): IdentityResult<InvitationStatus> {
    if (this.state.status !== 'pending') {
      return refuse('invitation_not_pending', { status: this.state.status });
    }
    if (!this.hasExpiredBy(occurredAt)) return refuse('invitation_not_yet_expired');

    this.state = { ...this.state, status: 'expired' };
    this.record(IdentityEvents.invitationExpired, {}, origin, occurredAt);
    return accept(this.state.status);
  }

  public snapshot(): InvitationState {
    return { ...this.state, version: this.version };
  }

  private record<TPayload extends object>(
    eventName: IdentityEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(eventName, { invitationId: this.id, ...payload }, origin, occurredAt);
  }
}
