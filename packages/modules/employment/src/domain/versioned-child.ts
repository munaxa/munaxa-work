import { Timeline, type EventOrigin, type TimelineEntry } from '@work/kernel';

import { EmploymentAggregate } from './employment-aggregate.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import type { EmploymentEventName } from './employment-events.js';

/**
 * The **Versioned Child Entity** pattern the master instructions make mandatory, implemented once
 * for the three things in this module that change over an employment's life and whose *past*
 * values stay answerable: where somebody worked, who they reported to, and what their contract
 * said.
 *
 * The rule it encodes: a change never edits. A transfer closes the period the old assignment had
 * and opens a new one, so "which department did this person belong to when that decision was
 * taken" has exactly one answer forever. That is not bookkeeping. It is the difference between a
 * product that can reconstruct an organization on a date and one that can only show today's.
 *
 * The non-overlap invariant is the kernel's `Timeline`, used rather than reimplemented, because a
 * module that grew its own effective dating would be the module whose history disagreed with
 * everybody else's. Two rules live in `closeAt`, inherited from Phases 3 and 4 rather than
 * rediscovered:
 *
 * - Ending at or before the start produces a period of no duration, and a timeline containing one
 *   answers "what applied on that date" with a period nothing is in.
 * - A period already bounded may be **shortened but never extended**. Extending it pushes its end
 *   past the start of whatever follows, and two periods in force at once is the state this design
 *   exists to make unrepresentable.
 */

export interface VersionedChildState {
  readonly id: string;
  readonly tenantId: string;
  readonly employmentId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export abstract class VersionedChild<
  TState extends VersionedChildState,
> extends EmploymentAggregate {
  protected constructor(
    protected state: TState,
    aggregateType: string,
    private readonly closedEvent: EmploymentEventName,
  ) {
    super(state.id, state.tenantId, state.version, aggregateType);
  }

  public get employmentId(): string {
    return this.state.employmentId;
  }

  public get effectiveFrom(): Date {
    return this.state.effectiveFrom;
  }

  public get isOpen(): boolean {
    return this.state.effectiveTo === undefined;
  }

  public closeAt(effectiveTo: Date, origin: EventOrigin, occurredAt: Date): EmploymentResult<Date> {
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
      { recordId: this.id, employmentId: this.state.employmentId, effectiveTo },
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
 * Building it is itself a check: `Timeline.from` throws if two periods are in force at once, so a
 * database that had somehow acquired overlapping rows fails loudly here rather than answering
 * "which unit was this person in during March" with whichever row the planner returned first.
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
 * The period a new record effective from a date supersedes, and the bound the new record takes.
 *
 * A back-dated correction is the case this exists for. Recording a March transfer for somebody who
 * also moved in June must close March's *predecessor* at March and bound the new record at June —
 * not run it through the June move and silently discard it. The kernel's `Timeline.change` drops
 * later entries, which is right for a salary and wrong for a placement somebody deliberately
 * entered, so this module supersedes explicitly. Phases 3 and 4 reached the same conclusion.
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

/** Every record still open on a date, for the invariants that count simultaneous periods. */
export const openOn = <TState extends VersionedChildState>(
  states: readonly TState[],
  instant: Date,
): readonly TState[] =>
  states.filter(
    (state) =>
      state.effectiveFrom.getTime() <= instant.getTime() &&
      (state.effectiveTo === undefined || state.effectiveTo.getTime() > instant.getTime()),
  );
