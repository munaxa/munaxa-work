import { uuidV7, type EventOrigin } from '@work/kernel';

import { IdentityAggregate } from './identity-aggregate.js';
import { IdentityEvents, type IdentityEventName } from './identity-events.js';
import { accept, refuse, type IdentityResult } from './identity-rejection.js';
import type { WorkforceUserStatus } from './identity-vocabulary.js';

/**
 * The business identity of one authenticated Platform user.
 *
 * There is exactly one of these per Platform account, spanning every tenant that person belongs
 * to (AD-005). That is why it is the only aggregate in this module without a tenant: a row that
 * belonged to a tenant could not be the same row in the second tenant, and then a consultant
 * working for two customers would be two people with two unrelated histories.
 *
 * What it deliberately does *not* hold is anything a tenant would consider its own. A display
 * name, a business email, a job title and a preference are all tenant-specific — the same person
 * is "Sara Haddad, Finance" to one customer and "S. Haddad, Contractor" to another — so they
 * live in `BusinessProfile` and `UserPreference`, which are tenant-scoped and isolated by
 * row-level security. This aggregate holds the Platform identifier and the account's lifecycle,
 * and nothing else, which is what makes a tenant-less table defensible (ADR-0033).
 *
 * It holds no credential of any kind. There is no password field, no token, no secret and no
 * place to put one (AD-003).
 */

export interface WorkforceUserState {
  readonly id: string;
  readonly platformUserId: string;
  readonly status: WorkforceUserStatus;
  readonly version: number;
}

export class WorkforceUser extends IdentityAggregate {
  private constructor(
    id: string,
    /** Immutable for the life of the account (AD-004). Nothing in this class can change it. */
    public readonly platformUserId: string,
    private status: WorkforceUserStatus,
    version: number,
  ) {
    super(id, version, 'WorkforceUser');
  }

  /**
   * Creates a user Munaxa Work knows about but no tenant has yet admitted.
   *
   * This never creates a Platform account (AD-009). It records that a Platform account which
   * already exists — or which the person will create through Platform — is the one a tenant
   * means when it invites them.
   */
  public static provision(
    platformUserId: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): WorkforceUser {
    const user = new WorkforceUser(uuidV7(occurredAt.getTime()), platformUserId, 'provisioned', 0);

    user.record(IdentityEvents.userProvisioned, { platformUserId }, origin, occurredAt);
    return user;
  }

  /** Rebuilds from storage. No event is raised: nothing happened, we merely read it. */
  public static rehydrate(state: WorkforceUserState): WorkforceUser {
    return new WorkforceUser(state.id, state.platformUserId, state.status, state.version);
  }

  public get currentStatus(): WorkforceUserStatus {
    return this.status;
  }

  /** True when the account itself permits acting. A membership still decides *where*. */
  public get isUsable(): boolean {
    return this.status === 'active' || this.status === 'provisioned';
  }

  /** The first tenant to admit them activates the account. Activating an active one is a no-op. */
  public activate(origin: EventOrigin, occurredAt: Date): IdentityResult<WorkforceUserStatus> {
    if (this.status === 'active') return accept(this.status);
    if (this.status !== 'provisioned') {
      return refuse('workforce_user_not_activatable', { status: this.status });
    }
    this.status = 'active';
    this.record(IdentityEvents.userActivated, {}, origin, occurredAt);
    return accept(this.status);
  }

  /**
   * Bars the person from every tenant at once. Reversible, and it changes no membership: when
   * the suspension lifts they are exactly as they were, in the tenants they were already in.
   */
  public suspend(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<WorkforceUserStatus> {
    if (this.status !== 'active') {
      return refuse('workforce_user_not_suspendable', { status: this.status });
    }
    this.status = 'suspended';
    this.record(IdentityEvents.userSuspended, { reason }, origin, occurredAt);
    return accept(this.status);
  }

  public reinstate(origin: EventOrigin, occurredAt: Date): IdentityResult<WorkforceUserStatus> {
    if (this.status !== 'suspended') {
      return refuse('workforce_user_not_reinstatable', { status: this.status });
    }
    this.status = 'active';
    this.record(IdentityEvents.userReinstated, {}, origin, occurredAt);
    return accept(this.status);
  }

  /**
   * Terminal. It deletes nothing — the employments, delegations and audit rows that reference
   * this person are evidence, and a system that erased them could not answer for itself later
   * (AD-008).
   */
  public deactivate(
    reason: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): IdentityResult<WorkforceUserStatus> {
    if (this.status === 'deactivated') {
      return refuse('workforce_user_already_deactivated', { status: this.status });
    }
    this.status = 'deactivated';
    this.record(IdentityEvents.userDeactivated, { reason }, origin, occurredAt);
    return accept(this.status);
  }

  public snapshot(): WorkforceUserState {
    return {
      id: this.id,
      platformUserId: this.platformUserId,
      status: this.status,
      version: this.version,
    };
  }

  /** Every identity event carries the user it is about, so a consumer never has to join. */
  private record<TPayload extends object>(
    eventName: IdentityEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.raise(eventName, { workforceUserId: this.id, ...payload }, origin, occurredAt);
  }
}
