import { DateRange, uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { DelegationStatus } from './identity-vocabulary.js';

/**
 * One member acting on another's behalf, for a stated period and a stated scope.
 *
 * It lives here rather than in Workflow (AD-010) because delegation is a statement about
 * identity — *who may act as whom* — and Workflow, Leave, Payroll and Self Service will each
 * need the answer. Building it inside Workflow would make four other domains depend on the
 * approvals engine to find out who a person's deputy is.
 *
 * Phase 2 owns the fact. Phase 16 consumes it: when Workflow routes an approval it asks this
 * module who is acting for the absent approver, and this module answers from a period that was
 * agreed in advance rather than from a rule invented at routing time.
 *
 * `scope` is an opaque key — `leave.approve`, `*`, whatever the consuming domain agrees. It is
 * not interpreted here: this module would have to know what every future domain's operations
 * are to interpret it, and that is precisely the coupling that keeps the delegation foundation
 * generic.
 */

export interface DelegationState {
  readonly id: string;
  readonly tenantId: string;
  readonly delegatorMembershipId: string;
  readonly delegateMembershipId: string;
  readonly scope: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date;
  readonly status: DelegationStatus;
  readonly reason: string;
  readonly version: number;
}

export class Delegation extends TenantScopedAggregate {
  private constructor(private state: DelegationState) {
    super(state.id, state.tenantId, state.version, 'Delegation');
  }

  /**
   * Creates a delegation.
   *
   * Three refusals, each of which is a real mistake rather than a hypothetical one:
   *
   * - **Delegating to yourself** is a no-op that looks like a control. Somebody reading the
   *   register would conclude cover was arranged when it was not.
   * - **A period that has already ended** creates a delegation nobody can use and nobody
   *   notices is useless until the approval it was meant to cover is stuck.
   * - **An inverted period** is a typo, and one that `DateRange` would otherwise have to
   *   tolerate to be constructible.
   */
  public static create(
    request: {
      readonly tenantId: string;
      readonly delegatorMembershipId: string;
      readonly delegateMembershipId: string;
      readonly scope: string;
      readonly effectiveFrom: Date;
      readonly effectiveTo: Date;
      readonly reason: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<Delegation> {
    if (request.delegatorMembershipId === request.delegateMembershipId) {
      return refuse('delegation_to_self');
    }
    if (request.effectiveTo.getTime() <= request.effectiveFrom.getTime()) {
      return refuse('delegation_period_inverted');
    }
    if (request.effectiveTo.getTime() <= occurredAt.getTime()) {
      return refuse('delegation_period_already_elapsed');
    }

    const delegation = new Delegation({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      delegatorMembershipId: request.delegatorMembershipId,
      delegateMembershipId: request.delegateMembershipId,
      scope: request.scope,
      effectiveFrom: request.effectiveFrom,
      effectiveTo: request.effectiveTo,
      status: request.effectiveFrom.getTime() <= occurredAt.getTime() ? 'active' : 'scheduled',
      reason: request.reason,
      version: 0,
    });

    delegation.record(
      IdentityEvents.delegationCreated,
      {
        delegatorMembershipId: request.delegatorMembershipId,
        delegateMembershipId: request.delegateMembershipId,
        scope: request.scope,
        effectiveFrom: request.effectiveFrom,
        effectiveTo: request.effectiveTo,
      },
      origin,
      occurredAt,
    );
    return accept(delegation);
  }

  public static rehydrate(state: DelegationState): Delegation {
    return new Delegation(state);
  }

  public get delegatorMembershipId(): string {
    return this.state.delegatorMembershipId;
  }

  public get delegateMembershipId(): string {
    return this.state.delegateMembershipId;
  }

  public get scope(): string {
    return this.state.scope;
  }

  public get currentStatus(): DelegationStatus {
    return this.state.status;
  }

  public get effectiveFrom(): Date {
    return this.state.effectiveFrom;
  }

  public get effectiveTo(): Date {
    return this.state.effectiveTo;
  }

  /** Half-open: inclusive at the start, exclusive at the end, so two periods never overlap. */
  private get period(): DateRange {
    return DateRange.of(this.state.effectiveFrom, this.state.effectiveTo);
  }

  /**
   * Whether the delegate may act at this instant — the question every consuming domain asks.
   *
   * It is computed from the period rather than read from the status, because a status is only
   * as fresh as the last job that updated it, and an approval routed from a stale "active" is
   * an approval given by somebody whose cover ended yesterday.
   */
  public isInForceAt(instant: Date): boolean {
    if (this.state.status === 'revoked') return false;
    return this.period.contains(instant);
  }

  /** Withdrawn before its end — the delegator returned early, or the arrangement changed. */
  public revoke(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<DelegationStatus> {
    if (this.state.status === 'revoked') return refuse('delegation_already_revoked');
    if (this.state.status === 'expired') return refuse('delegation_already_expired');

    this.state = { ...this.state, status: 'revoked' };
    this.record(IdentityEvents.delegationRevoked, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  /** Recorded when the period elapses, so the register reads as what it is rather than stale. */
  public expire(origin: EventOrigin, occurredAt: Date): IdentityResult<DelegationStatus> {
    if (this.state.status === 'revoked' || this.state.status === 'expired') {
      return refuse('delegation_not_expirable', { status: this.state.status });
    }
    if (this.period.contains(occurredAt)) return refuse('delegation_still_in_force');

    this.state = { ...this.state, status: 'expired' };
    this.record(IdentityEvents.delegationExpired, {}, origin, occurredAt);
    return accept(this.state.status);
  }

  /** Promotes a scheduled delegation whose start has arrived. Idempotent by refusal. */
  public activate(origin: EventOrigin, occurredAt: Date): IdentityResult<DelegationStatus> {
    if (this.state.status !== 'scheduled') {
      return refuse('delegation_not_scheduled', { status: this.state.status });
    }
    if (!this.period.contains(occurredAt)) return refuse('delegation_not_yet_in_force');

    this.state = { ...this.state, status: 'active' };
    this.record(IdentityEvents.delegationCreated, { activated: true }, origin, occurredAt);
    return accept(this.state.status);
  }

  public snapshot(): DelegationState {
    return { ...this.state, version: this.version };
  }

  private record<TPayload extends object>(
    eventName: IdentityEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(eventName, { delegationId: this.id, ...payload }, origin, occurredAt);
  }
}
