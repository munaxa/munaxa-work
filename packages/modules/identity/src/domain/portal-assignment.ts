import { uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { PortalAssignmentStatus, PortalKey } from './identity-vocabulary.js';

/**
 * Which of the product's portals a tenant has opened to one of its members.
 *
 * This is business configuration, not authentication and not authorization (AD-007). It answers
 * "does this company expect this person to use the manager portal", and answers nothing about
 * whether they may approve a particular leave request — that is a permission, and permissions
 * come from Platform's RBAC.
 *
 * The distinction is worth holding onto because it is the one people collapse. Revoking the
 * manager portal does not revoke the ability to approve; it removes an application from a
 * person's home screen. A product that conflated the two would let a UI change alter what
 * somebody is allowed to do.
 */

export interface PortalAssignmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly portal: PortalKey;
  readonly status: PortalAssignmentStatus;
  readonly grantedAt: Date;
  readonly revokedAt?: Date;
  readonly version: number;
}

export class PortalAssignment extends TenantScopedAggregate {
  /**
   * One state object rather than a parameter per field.
   *
   * It is what `rehydrate` already receives and what `snapshot` already returns, so passing it
   * whole removes the two places where a field could be threaded into the wrong position — and
   * a positional mix-up between two `Date`s or two `string`s is a mistake the compiler cannot
   * catch.
   */
  private constructor(private state: PortalAssignmentState) {
    super(state.id, state.tenantId, state.version, 'PortalAssignment');
  }

  public static grant(
    request: {
      readonly tenantId: string;
      readonly membershipId: string;
      readonly portal: PortalKey;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): PortalAssignment {
    const assignment = new PortalAssignment({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      membershipId: request.membershipId,
      portal: request.portal,
      status: 'granted',
      grantedAt: occurredAt,
      version: 0,
    });

    assignment.record(IdentityEvents.portalGranted, {}, origin, occurredAt);
    return assignment;
  }

  public static rehydrate(state: PortalAssignmentState): PortalAssignment {
    return new PortalAssignment(state);
  }

  public get membershipId(): string {
    return this.state.membershipId;
  }

  public get portal(): PortalKey {
    return this.state.portal;
  }

  public get currentStatus(): PortalAssignmentStatus {
    return this.state.status;
  }

  public get isOpen(): boolean {
    return this.state.status === 'granted';
  }

  /**
   * Withdraws the portal. The row survives, revoked: "who could reach the admin portal last
   * March" is a question a security review asks, and a deleted row answers it with silence.
   */
  public revoke(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<PortalAssignmentStatus> {
    if (this.state.status !== 'granted') {
      return refuse('portal_assignment_not_granted', { status: this.state.status });
    }
    this.state = { ...this.state, status: 'revoked', revokedAt: occurredAt };
    this.record(IdentityEvents.portalRevoked, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  /** Re-opens a revoked portal, as a returning secondment or a reversed decision does. */
  public reinstate(origin: EventOrigin, occurredAt: Date): IdentityResult<PortalAssignmentStatus> {
    if (this.state.status !== 'revoked') {
      return refuse('portal_assignment_not_revoked', { status: this.state.status });
    }
    const { revokedAt: _revoked, ...rest } = this.state;

    this.state = { ...rest, status: 'granted' };
    this.record(IdentityEvents.portalGranted, { reinstated: true }, origin, occurredAt);
    return accept(this.state.status);
  }

  public snapshot(): PortalAssignmentState {
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
      {
        assignmentId: this.id,
        membershipId: this.state.membershipId,
        portal: this.state.portal,
        ...payload,
      },
      origin,
      occurredAt,
    );
  }
}
