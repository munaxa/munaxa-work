import type { DomainEvent } from '../domain/domain-event.js';

/**
 * Read models, and the rebuild that keeps them trustworthy.
 *
 * Reporting, dashboards, AI and compliance all read projections rather than transactional
 * tables. That is only safe if a projection can be thrown away and rebuilt from the events,
 * because a projection that cannot be rebuilt is a second source of truth that drifts silently
 * — and the drift is discovered by a customer disputing a number.
 */

export interface Projection<TState> {
  readonly name: string;
  /** Events this projection consumes. Anything else is ignored, not an error. */
  readonly consumes: readonly string[];
  readonly initial: TState;
  apply(state: TState, event: DomainEvent): TState;
}

export interface ProjectionCheckpoint {
  readonly projection: string;
  readonly lastEventId?: string;
  readonly updatedAt: Date;
}

/**
 * Folds events into a projection's state. Pure and synchronous: the same events in the same
 * order always give the same state, which is what makes a rebuild verifiable against the live
 * projection rather than merely plausible.
 */
export const project = <TState>(
  projection: Projection<TState>,
  events: readonly DomainEvent[],
  from: TState = projection.initial,
): TState =>
  events
    .filter((event) => projection.consumes.includes(event.eventName))
    .reduce((state, event) => projection.apply(state, event), from);

/**
 * Rebuilds from scratch and reports whether the result matches what is stored. Used by the
 * verification phase, and by support when a number is disputed.
 */
export const verifyRebuild = <TState>(
  projection: Projection<TState>,
  events: readonly DomainEvent[],
  stored: TState,
): { readonly matches: boolean; readonly rebuilt: TState } => {
  const rebuilt = project(projection, events);
  return { matches: JSON.stringify(rebuilt) === JSON.stringify(stored), rebuilt };
};
