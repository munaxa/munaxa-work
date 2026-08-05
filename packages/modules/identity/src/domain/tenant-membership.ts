import { uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { MembershipStatus } from './identity-vocabulary.js';

/**
 * One person's membership of one tenant — and the aggregate the whole product's tenant
 * isolation now rests on.
 *
 * Before this existed, the API believed an `x-tenant-id` header, which meant any caller could
 * claim any tenant. What replaced it is this row: a tenant admitted this person, at this time,
 * and that admission is a fact the product stored rather than a claim the caller made. Every
 * request now resolves its tenant by finding a membership, so a forged header can at most name
 * a tenant the person is already in.
 *
 * A person may hold many of these, one per tenant (AD-005), and they are independent: suspended
 * here does not mean suspended there, and ending one leaves the others and the workforce user
 * untouched.
 */

export interface TenantMembershipState {
  readonly id: string;
  readonly tenantId: string;
  readonly workforceUserId: string;
  readonly status: MembershipStatus;
  /** When an invitation for this person was accepted, if admission came that way. */
  readonly invitedAt?: Date;
  readonly joinedAt?: Date;
  readonly endedAt?: Date;
  readonly version: number;
}

export class TenantMembership extends TenantScopedAggregate {
  private constructor(private state: TenantMembershipState) {
    super(state.id, state.tenantId, state.version, 'TenantMembership');
  }

  /**
   * Admits a person to the tenant. Reached two ways — an accepted invitation, or an
   * administrator adding somebody whose Platform account is already known — and the audit
   * distinction between them is preserved by the event's payload rather than flattened away.
   */
  public static admit(
    tenantId: string,
    workforceUserId: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): TenantMembership {
    const membership = new TenantMembership({
      id: uuidV7(occurredAt.getTime()),
      tenantId,
      workforceUserId,
      status: 'active',
      joinedAt: occurredAt,
      version: 0,
    });

    membership.record(IdentityEvents.membershipGranted, { status: 'active' }, origin, occurredAt);
    return membership;
  }

  public static rehydrate(state: TenantMembershipState): TenantMembership {
    return new TenantMembership(state);
  }

  public get workforceUserId(): string {
    return this.state.workforceUserId;
  }

  public get currentStatus(): MembershipStatus {
    return this.state.status;
  }

  /**
   * Whether this membership may resolve a request's tenant.
   *
   * Only `active`. A suspended member has been told to stop and an ended member has left;
   * neither may open a request, and treating "not ended" as sufficient is how a suspended
   * administrator keeps working.
   */
  public get maySelectTenant(): boolean {
    return this.state.status === 'active';
  }

  /** Readmits somebody who had left. History is kept: the same membership row, revived. */
  public rejoin(origin: EventOrigin, occurredAt: Date): IdentityResult<MembershipStatus> {
    if (this.state.status !== 'ended') {
      return refuse('membership_not_rejoinable', { status: this.state.status });
    }
    const { endedAt: _ended, ...rest } = this.state;

    this.state = { ...rest, status: 'active', joinedAt: occurredAt };
    this.record(IdentityEvents.membershipActivated, { rejoined: true }, origin, occurredAt);
    return accept(this.state.status);
  }

  public suspend(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<MembershipStatus> {
    if (this.state.status !== 'active') {
      return refuse('membership_not_suspendable', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'suspended' };
    this.record(IdentityEvents.membershipSuspended, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  public reinstate(origin: EventOrigin, occurredAt: Date): IdentityResult<MembershipStatus> {
    if (this.state.status !== 'suspended') {
      return refuse('membership_not_reinstatable', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'active' };
    this.record(IdentityEvents.membershipReinstated, {}, origin, occurredAt);
    return accept(this.state.status);
  }

  /**
   * The person has left this tenant. Inert everywhere else: their workforce user, their other
   * memberships and this tenant's record of what they did all survive it.
   *
   * Portal assignments and delegations that hang off this membership are revoked in response to
   * the event rather than inside this method — they are separate aggregates, and reaching across
   * a consistency boundary to mutate one is how a transaction grows until it deadlocks.
   */
  public end(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<MembershipStatus> {
    if (this.state.status === 'ended') {
      return refuse('membership_already_ended', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'ended', endedAt: occurredAt };
    this.record(IdentityEvents.membershipEnded, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  public snapshot(): TenantMembershipState {
    return { ...this.state, version: this.version };
  }

  private record<TPayload extends object>(
    eventName: IdentityEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(
      eventName,
      { membershipId: this.id, workforceUserId: this.state.workforceUserId, ...payload },
      origin,
      occurredAt,
    );
  }
}
