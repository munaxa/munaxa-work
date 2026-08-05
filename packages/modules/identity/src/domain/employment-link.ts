import { uuidV7, type EventOrigin } from '@work/kernel';

import { TenantScopedAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { EmploymentLinkStatus } from './identity-vocabulary.js';

/**
 * The join between "who this person is to the business" and "the job they hold".
 *
 * It exists as its own aggregate because the two are genuinely different lifetimes. A person may
 * hold two jobs at once — a second contract, a secondment, a role at two legal entities of the
 * same group (AD-006) — and a person survives every job they ever leave (AD-008). A foreign key
 * from a user to an employment could express neither.
 *
 * `employmentId` is a reference by identity only. Employment is Phase 5's aggregate and Phase
 * 5's table; this module stores the identifier, never the employment, and has no opinion about
 * its contents. There is deliberately no database foreign key: it would couple this module's
 * schema to another module's, which is exactly the coupling a modular monolith exists to avoid.
 */

export interface EmploymentLinkState {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly employmentId: string;
  readonly isPrimary: boolean;
  readonly status: EmploymentLinkStatus;
  readonly linkedAt: Date;
  readonly unlinkedAt?: Date;
  readonly version: number;
}

export class EmploymentLink extends TenantScopedAggregate {
  private constructor(private state: EmploymentLinkState) {
    super(state.id, state.tenantId, state.version, 'EmploymentLink');
  }

  public static link(
    request: {
      readonly tenantId: string;
      readonly membershipId: string;
      readonly employmentId: string;
      readonly isPrimary: boolean;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): EmploymentLink {
    const link = new EmploymentLink({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      membershipId: request.membershipId,
      employmentId: request.employmentId,
      isPrimary: request.isPrimary,
      status: 'linked',
      linkedAt: occurredAt,
      version: 0,
    });

    link.record(
      IdentityEvents.employmentLinked,
      { employmentId: request.employmentId, isPrimary: request.isPrimary },
      origin,
      occurredAt,
    );
    return link;
  }

  public static rehydrate(state: EmploymentLinkState): EmploymentLink {
    return new EmploymentLink(state);
  }

  public get membershipId(): string {
    return this.state.membershipId;
  }

  public get employmentId(): string {
    return this.state.employmentId;
  }

  public get currentStatus(): EmploymentLinkStatus {
    return this.state.status;
  }

  public get isPrimary(): boolean {
    return this.state.isPrimary;
  }

  public get isActive(): boolean {
    return this.state.status === 'linked';
  }

  /**
   * Detaches the job from the person. The person is untouched — no status changes, no membership
   * ends, nothing is deleted (AD-008). Somebody who leaves one of two concurrent jobs still
   * works here, and somebody who leaves their only job still has a leave balance to be paid out.
   */
  public unlink(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<EmploymentLinkStatus> {
    if (this.state.status !== 'linked') {
      return refuse('employment_link_not_linked', { status: this.state.status });
    }
    this.state = {
      ...this.state,
      status: 'unlinked',
      unlinkedAt: occurredAt,
      // A detached job cannot be the main one, or the partial unique index that guarantees at
      // most one primary would be satisfied by a job nobody holds.
      isPrimary: false,
    };
    this.record(IdentityEvents.employmentUnlinked, { reason }, origin, occurredAt);
    return accept(this.state.status);
  }

  /**
   * Makes this the primary employment.
   *
   * "Exactly one primary per membership" is an invariant across links, not within one, so the
   * application service demotes the incumbent in the same transaction. This method refuses the
   * two cases it *can* see: promoting a detached job, and promoting one that already is primary.
   */
  public makePrimary(origin: EventOrigin, occurredAt: Date): IdentityResult<boolean> {
    if (this.state.status !== 'linked') {
      return refuse('employment_link_not_linked', { status: this.state.status });
    }
    if (this.state.isPrimary) return refuse('employment_link_already_primary');

    this.state = { ...this.state, isPrimary: true };
    this.record(IdentityEvents.primaryEmploymentChanged, { isPrimary: true }, origin, occurredAt);
    return accept(true);
  }

  /** Steps down as primary, so another link may take it. Silent when already secondary. */
  public relinquishPrimary(origin: EventOrigin, occurredAt: Date): void {
    if (!this.state.isPrimary) return;

    this.state = { ...this.state, isPrimary: false };
    this.record(IdentityEvents.primaryEmploymentChanged, { isPrimary: false }, origin, occurredAt);
  }

  public snapshot(): EmploymentLinkState {
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
      { linkId: this.id, membershipId: this.state.membershipId, ...payload },
      origin,
      occurredAt,
    );
  }
}
