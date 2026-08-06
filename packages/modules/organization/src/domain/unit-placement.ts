import { Timeline, uuidV7, type EventOrigin, type TimelineEntry } from '@work/kernel';

import { OrganizationAggregate } from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';

/**
 * Where one unit sat, and from when.
 *
 * This is the aggregate that makes historical reorganizations answerable. A placement is never
 * edited: moving a department closes the period it had and opens a new one, so "which branch was
 * this department under on 12 Rajab" has exactly one answer forever, and re-running last year's
 * cost allocation produces last year's answer rather than today's.
 *
 * The non-overlap invariant is not this file's invention — it is `Timeline` from the kernel,
 * used rather than reimplemented, because a module that grew its own effective-dating would be
 * the module whose history disagreed with everybody else's. `placementTimeline` below is how a
 * caller asks it a question; `assertPlaceable` is how a caller asks whether a change is legal
 * before making it.
 *
 * A placement with no parent is a *root*: the top of this tenant's structure. It is a real
 * placement rather than an absent one, because "this company became a root on 1 January" and
 * "nobody has ever said where this company sits" are different facts, and only the first is a
 * structure.
 */

export interface UnitPlacementState {
  readonly id: string;
  readonly tenantId: string;
  readonly unitId: string;
  /** Absent means the unit is a root of the tenant's structure for this period. */
  readonly parentUnitId?: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

/** What a timeline entry carries: which row it is, and which parent it names. */
export interface PlacedUnder {
  readonly placementId: string;
  readonly parentUnitId?: string;
}

export class UnitPlacement extends OrganizationAggregate {
  private constructor(private state: UnitPlacementState) {
    super(state.id, state.tenantId, state.version, 'UnitPlacement');
  }

  public static open(
    request: {
      readonly tenantId: string;
      readonly unitId: string;
      readonly parentUnitId?: string;
      readonly effectiveFrom: Date;
      /**
       * Bounded at creation only when a later period already exists — which happens when a
       * correction is back-dated in front of a move that was recorded earlier. Ordinary
       * placements are open-ended.
       */
      readonly effectiveTo?: Date;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): UnitPlacement {
    const placement = new UnitPlacement({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      unitId: request.unitId,
      ...(request.parentUnitId === undefined ? {} : { parentUnitId: request.parentUnitId }),
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    placement.raise(
      OrganizationEvents.unitPlaced,
      {
        placementId: placement.id,
        unitId: request.unitId,
        parentUnitId: request.parentUnitId ?? null,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return placement;
  }

  public static rehydrate(state: UnitPlacementState): UnitPlacement {
    return new UnitPlacement(state);
  }

  public get unitId(): string {
    return this.state.unitId;
  }

  public get parentUnitId(): string | undefined {
    return this.state.parentUnitId;
  }

  public get isOpen(): boolean {
    return this.state.effectiveTo === undefined;
  }

  /**
   * Ends this period, which is what a move or a detachment does to the placement it supersedes.
   *
   * Two refusals, and both exist to keep the timeline answering exactly once:
   *
   * Ending at or before the start would produce a period of no duration, and a timeline
   * containing one answers "what applied on that date" with a period nothing is in.
   *
   * A period that is *already* bounded may only be shortened, never extended. Extending it would
   * push its end past the start of whatever period follows, and two periods in force at once is
   * the state this whole design exists to make unrepresentable. Shortening is legitimate and
   * ordinary: it is what a back-dated correction does to the period it splits.
   */
  public closeAt(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<Date> {
    const existingEnd = this.state.effectiveTo;

    if (existingEnd !== undefined && effectiveTo.getTime() >= existingEnd.getTime()) {
      return refuse('placement_already_closed');
    }
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('placement_closed_before_it_opened');
    }

    this.state = { ...this.state, effectiveTo };
    this.raise(
      OrganizationEvents.unitDetached,
      { placementId: this.id, unitId: this.state.unitId, effectiveTo },
      origin,
      occurredAt,
    );
    return accept(effectiveTo);
  }

  public snapshot(): UnitPlacementState {
    return { ...this.state, version: this.version };
  }
}

/**
 * One unit's placement history as the kernel's `Timeline`.
 *
 * Building it is itself a check: `Timeline.from` throws `timeline_overlap` if two periods are
 * in force at once, so a database that had somehow acquired overlapping rows fails loudly here
 * rather than answering a structure query with whichever row the planner returned first.
 */
export const placementTimeline = (states: readonly UnitPlacementState[]): Timeline<PlacedUnder> =>
  Timeline.from(
    states.map((state) => ({
      value: {
        placementId: state.id,
        ...(state.parentUnitId === undefined ? {} : { parentUnitId: state.parentUnitId }),
      },
      effectiveFrom: state.effectiveFrom,
      ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
      version: state.version,
    })),
  );

/** The parent in force on a date, or `undefined` for a root — or for a unit not yet placed. */
export const parentOn = (
  states: readonly UnitPlacementState[],
  instant: Date,
): TimelineEntry<PlacedUnder> | undefined => placementTimeline(states).at(instant);

/**
 * Whether a unit may be placed under a parent from a date, given the parent's own history.
 *
 * The rule this enforces is the one an administration screen cannot: a unit may not become its
 * own ancestor. A cycle in an organizational hierarchy is not a data-quality problem, it is a
 * structure query that never terminates, and the recursive walk that answers "everything under
 * this branch" is exactly what would hang.
 *
 * It is checked *as of the effective date* rather than as of today, because a back-dated move
 * that was legal in March must not be refused because of a placement made in June — and a
 * forward-dated move that would create a cycle in June must be refused now, not discovered then.
 */
export const wouldCreateCycle = (
  unitId: string,
  parentUnitId: string,
  ancestorsOfParent: readonly string[],
): boolean => parentUnitId === unitId || ancestorsOfParent.includes(unitId);
