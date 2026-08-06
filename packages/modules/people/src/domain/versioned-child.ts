import { Timeline, type EventOrigin, type TimelineEntry } from '@work/kernel';

import { PeopleAggregate } from './people-aggregate.js';
import type { PeopleEventName } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';

/**
 * The **Versioned Child Entity** pattern the master instructions make mandatory, implemented once
 * for the four things in this module that change over a person's life and whose *past* values
 * stay answerable: their legal name, their contact points, their addresses and their preferences.
 *
 * The rule it encodes: a change never edits. Moving house closes the period the old address had
 * and opens a new one, so "where did this person live when that letter was posted" has exactly
 * one answer forever. That is not bookkeeping — an address on a terminated employee's final
 * settlement, a name on a contract, and a bank-notification address in a wage-protection file are
 * all questions asked about a *date*, long after the value changed.
 *
 * The non-overlap invariant is the kernel's `Timeline`, used rather than reimplemented, because a
 * module that grew its own effective dating would be the module whose history disagreed with
 * everybody else's.
 *
 * Two rules live in `closeAt`, and both exist so the timeline answers exactly once. They are the
 * ones Phase 3 arrived at the expensive way, so they are inherited here rather than rediscovered:
 *
 * - Ending at or before the start produces a period of no duration, and a timeline containing one
 *   answers "what applied on that date" with a period nothing is in.
 * - A period that is already bounded may be **shortened but never extended**. Extending it pushes
 *   its end past the start of whatever follows, and two periods in force at once is the state this
 *   design exists to make unrepresentable. Shortening is ordinary — it is what a back-dated
 *   correction does to the period it splits.
 */

export interface VersionedChildState {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export abstract class VersionedChild<TState extends VersionedChildState> extends PeopleAggregate {
  protected constructor(
    protected state: TState,
    aggregateType: string,
    private readonly closedEvent: PeopleEventName,
  ) {
    super(state.id, state.tenantId, state.version, aggregateType);
  }

  public get personId(): string {
    return this.state.personId;
  }

  public get effectiveFrom(): Date {
    return this.state.effectiveFrom;
  }

  public get isOpen(): boolean {
    return this.state.effectiveTo === undefined;
  }

  public closeAt(effectiveTo: Date, origin: EventOrigin, occurredAt: Date): PeopleResult<Date> {
    const existingEnd = this.state.effectiveTo;

    if (existingEnd !== undefined && effectiveTo.getTime() >= existingEnd.getTime()) {
      return refuse('period_already_closed');
    }
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('period_ends_before_it_begins', { field: 'effectiveTo' });
    }

    this.state = { ...this.state, effectiveTo };
    this.raise(
      this.closedEvent,
      { recordId: this.id, personId: this.state.personId, effectiveTo },
      origin,
      occurredAt,
    );
    return accept(effectiveTo);
  }

  public snapshot(): TState {
    return { ...this.state, version: this.version };
  }
}

/**
 * One child's history as the kernel's `Timeline`.
 *
 * Building it is itself a check: `Timeline.from` throws `timeline_overlap` if two periods are in
 * force at once, so a database that had somehow acquired overlapping rows fails loudly here
 * rather than answering "what was their address in March" with whichever row the planner returned
 * first.
 */
export const childTimeline = <TState extends VersionedChildState>(
  states: readonly TState[],
): Timeline<TState> =>
  Timeline.from(
    states.map((state) => ({
      value: state,
      effectiveFrom: state.effectiveFrom,
      ...(state.effectiveTo === undefined ? {} : { effectiveTo: state.effectiveTo }),
      version: state.version,
    })),
  );

/** The record in force on a date — the question every consumer actually asks. */
export const inForceOn = <TState extends VersionedChildState>(
  states: readonly TState[],
  instant: Date,
): TimelineEntry<TState> | undefined => childTimeline(states).at(instant);

/**
 * The period that a new record effective from a date supersedes, and the bound the new record
 * takes.
 *
 * A back-dated correction is the case this exists for. Recording a March address on a person who
 * also moved in June must close March's *predecessor* at March and bound the new record at June —
 * not run it through the June move and silently discard it. The kernel's `Timeline.change` drops
 * later entries, which is right for a salary and wrong for a record whose later value somebody
 * deliberately entered, so this module supersedes explicitly rather than delegating. Phase 3
 * reached the same conclusion for placements, and the reasoning is identical.
 */
export interface Supersession<TState extends VersionedChildState> {
  /** The record in force at the effective date, which must be closed there. */
  readonly superseded?: TState;
  /** Where the new record must end, when a later period already exists. */
  readonly boundedAt?: Date;
}

export const supersessionAt = <TState extends VersionedChildState>(
  states: readonly TState[],
  effectiveFrom: Date,
): Supersession<TState> => {
  const inForce = inForceOn(states, effectiveFrom)?.value;
  const next = states
    .filter((state) => state.effectiveFrom.getTime() > effectiveFrom.getTime())
    .sort((left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime())[0];

  return {
    ...(inForce === undefined ? {} : { superseded: inForce }),
    ...(next === undefined ? {} : { boundedAt: next.effectiveFrom }),
  };
};
