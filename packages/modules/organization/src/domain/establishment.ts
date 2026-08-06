import { Timeline, uuidV7, type EventOrigin } from '@work/kernel';

import { OrganizationAggregate } from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import type { EstablishmentStatus } from './organization-vocabulary.js';

/**
 * The approved establishment: how many of a position an organizational unit is budgeted to
 * have, from a date.
 *
 * This is manpower planning, and it is the one place in Organization that comes close to
 * counting people — so the line is worth stating exactly. Organization owns the **budgeted**
 * number. It never owns the **filled** number: filled is a count of employment assignments,
 * Employment owns those, and Organization counting them itself would be the duplicated
 * ownership the master instructions exist to prevent (AD-002).
 *
 * `vacant` is therefore a *projection*, computed as budgeted minus a filled count supplied by
 * Employment's assignment events (Phase 5). Until that module exists there are no assignments to
 * count, so filled is zero and vacant equals budgeted — which is arithmetic on an empty set,
 * not a placeholder, and it stays correct when the events start arriving.
 *
 * Establishment is effective dated because headcount budgets change at known dates and the old
 * one must remain answerable: "how many did we approve for this branch last year" is the
 * question an audit asks, and a mutable number cannot answer it.
 */

export interface EstablishmentState {
  readonly id: string;
  readonly tenantId: string;
  readonly positionId: string;
  readonly unitId: string;
  readonly budgetedHeadcount: number;
  readonly status: EstablishmentStatus;
  readonly approvedAt?: Date;
  readonly approvedBy?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface SetEstablishment {
  readonly tenantId: string;
  readonly positionId: string;
  readonly unitId: string;
  readonly budgetedHeadcount: number;
  readonly effectiveFrom: Date;
}

const HEADCOUNT_CEILING = 1_000_000;

export class Establishment extends OrganizationAggregate {
  private constructor(private state: EstablishmentState) {
    super(state.id, state.tenantId, state.version, 'Establishment');
  }

  public static set(
    request: SetEstablishment,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<Establishment> {
    if (!Number.isInteger(request.budgetedHeadcount) || request.budgetedHeadcount < 0) {
      return refuse('headcount_not_a_whole_number');
    }
    if (request.budgetedHeadcount > HEADCOUNT_CEILING) {
      return refuse('headcount_implausible', { limit: String(HEADCOUNT_CEILING) });
    }

    const line = new Establishment({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      positionId: request.positionId,
      unitId: request.unitId,
      budgetedHeadcount: request.budgetedHeadcount,
      status: 'draft',
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    line.raise(
      OrganizationEvents.establishmentSet,
      {
        establishmentId: line.id,
        positionId: request.positionId,
        unitId: request.unitId,
        budgetedHeadcount: request.budgetedHeadcount,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(line);
  }

  public static rehydrate(state: EstablishmentState): Establishment {
    return new Establishment(state);
  }

  public get positionId(): string {
    return this.state.positionId;
  }

  public get unitId(): string {
    return this.state.unitId;
  }

  public get budgetedHeadcount(): number {
    return this.state.budgetedHeadcount;
  }

  public get currentStatus(): EstablishmentStatus {
    return this.state.status;
  }

  public get isOpen(): boolean {
    return this.state.effectiveTo === undefined && this.state.status !== 'withdrawn';
  }

  /**
   * Approves the line, which is what makes it binding.
   *
   * A recruitment requisition is validated against the approved establishment (Phase 6), so a
   * draft that recruitment could already recruit against would make approval decorative.
   */
  public approve(
    approver: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<EstablishmentStatus> {
    if (this.state.status !== 'draft') {
      return refuse('establishment_not_draft', { status: this.state.status });
    }

    this.state = {
      ...this.state,
      status: 'approved',
      approvedAt: occurredAt,
      approvedBy: approver,
    };
    this.raise(
      OrganizationEvents.establishmentApproved,
      {
        establishmentId: this.id,
        positionId: this.state.positionId,
        unitId: this.state.unitId,
        budgetedHeadcount: this.state.budgetedHeadcount,
      },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  /** Ends this line's period, which a superseding line does to the one it replaces. */
  public closeAt(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<Date> {
    if (this.state.effectiveTo !== undefined) return refuse('establishment_already_closed');
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('establishment_closed_before_it_opened');
    }

    this.state = { ...this.state, effectiveTo };
    this.raise(
      OrganizationEvents.establishmentWithdrawn,
      { establishmentId: this.id, effectiveTo },
      origin,
      occurredAt,
    );
    return accept(effectiveTo);
  }

  public snapshot(): EstablishmentState {
    return { ...this.state, version: this.version };
  }
}

/**
 * One position-and-unit's establishment history, as the kernel's `Timeline`.
 *
 * Built the same way placements are, and for the same reason: two budgets in force at once is
 * two answers to "how many are approved here", and `Timeline.from` makes that state
 * unrepresentable rather than merely unlikely.
 */
export const establishmentTimeline = (
  states: readonly EstablishmentState[],
): Timeline<EstablishmentState> =>
  Timeline.from(
    states.map((state) => ({
      value: state,
      effectiveFrom: state.effectiveFrom,
      ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
      version: state.version,
    })),
  );

/**
 * Approved, filled and vacant for a position in a unit on a date.
 *
 * `filled` arrives from outside this module. The parameter exists so the projection is honest
 * about where the number comes from rather than inventing one — and so the shape does not have
 * to change when Employment starts supplying it.
 */
export interface EstablishmentPosture {
  readonly approved: number;
  readonly filled: number;
  readonly vacant: number;
}

export const posture = (approved: number, filled: number): EstablishmentPosture => ({
  approved,
  filled,
  // Over-establishment is real — an approved reduction with people still in post — and it is
  // reported as zero vacancies rather than as a negative one, which nothing downstream expects.
  vacant: Math.max(0, approved - filled),
});
