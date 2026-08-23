import { accept, refuse, type RelationsResult } from './relations-rejection.js';
import { INITIAL_CASE_STATE, permitsTransition, type CaseState } from './relations-vocabulary.js';

/**
 * One accepted movement of a disciplinary case, and the history that is made of them.
 *
 * **The current state is derived from these rows and stored nowhere** (D-5.2-16). It is the
 * `toState` of the highest-numbered event, and a case with no events is `reported`. There is no
 * `current_state` column on the violation, on the investigation, or on a projection: a second copy is
 * a second thing that can disagree with the first, which is what ADR-0070 means by *"a stored flag
 * that nothing maintains is worse than no flag"*. The derivation costs one indexed row.
 *
 * **`sequence` is the concurrency arbiter, not a display ordinal** (D-5.2-17). It is unique per case
 * at the database, so two requests that read the same current state compute the same next number and
 * exactly one of them commits. That is ADR-0071 applied to a lifecycle: a `select` followed by an
 * `insert` is not idempotent under concurrency, so the index decides rather than the read. A version
 * column on a violation could not do this job, because the violation row is immutable and never
 * updated.
 *
 * **`actor` and `occurredAt` are never supplied by a request.** The actor is the authenticated
 * caller from the execution context and the timestamp comes from the clock port. A transition
 * attributable to whoever asked for it is not an audit trail, and a recording time a client chooses
 * is a recording time a client can backdate.
 *
 * **`reason` is required and has no default.** The specification wants every transition audited with
 * a reason, and a defaulted reason is an absent one wearing a label.
 *
 * The row is immutable at the database unconditionally — update and delete both raise.
 */
export interface CaseEventState {
  readonly caseEventId: string;
  readonly violationId: string;
  readonly sequence: number;
  readonly fromState: CaseState;
  readonly toState: CaseState;
  readonly reason: string;
  /** The authenticated caller. Never supplied by one. */
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  /** The investigation this movement belongs to, where one does. */
  readonly investigationId?: string;
}

export const REASON_LIMIT = 2000;

export interface RecordTransitionRequest {
  readonly caseEventId: string;
  readonly violationId: string;
  /**
   * The events already recorded for this case, as read from authoritative persisted data.
   *
   * The caller passes history, **not a claimed current state**. A command that accepted a `from`
   * state and trusted it would let a caller name a state the case is not in and have the server
   * validate the transition it wanted rather than the one available.
   */
  readonly history: readonly CaseEventState[];
  readonly toState: CaseState;
  readonly reason: string;
  readonly actor: string;
  readonly occurredAt: Date;
  readonly correlationId: string;
  readonly investigationId?: string;
}

/**
 * Where the case is now, from its history alone.
 *
 * Defensive about ordering rather than trusting the query: the repository reads ordered, and a
 * derivation that silently returns the wrong state when an ordering changes is a derivation that
 * fails quietly. Reducing over the maximum costs nothing at these sizes.
 */
export const currentCaseState = (history: readonly CaseEventState[]): CaseState =>
  history.reduce<{ sequence: number; state: CaseState }>(
    (latest, event) =>
      event.sequence > latest.sequence
        ? { sequence: event.sequence, state: event.toState }
        : latest,
    { sequence: 0, state: INITIAL_CASE_STATE },
  ).state;

/** The number the next event must claim. One more than the highest so far; 1 for a case with none. */
export const nextSequence = (history: readonly CaseEventState[]): number =>
  history.reduce((highest, event) => Math.max(highest, event.sequence), 0) + 1;

export const recordTransition = (
  request: RecordTransitionRequest,
): RelationsResult<CaseEventState> => {
  const fromState = currentCaseState(request.history);

  if (!permitsTransition(fromState, request.toState)) {
    // Refused by name, with both states, so the caller learns what the case is actually in rather
    // than that "something was wrong". Neither value says anything about the person.
    return refuse('transition_not_permitted', { from: fromState, to: request.toState });
  }

  const reason = request.reason.trim();

  if (reason === '') return refuse('transition_reason_missing', { field: 'reason' });
  if (reason.length > REASON_LIMIT)
    return refuse('transition_reason_too_long', { field: 'reason' });
  if (request.actor.trim() === '') return refuse('transition_actor_unknown', { field: 'actor' });

  return accept({
    caseEventId: request.caseEventId,
    violationId: request.violationId,
    sequence: nextSequence(request.history),
    fromState,
    toState: request.toState,
    reason,
    actor: request.actor,
    occurredAt: request.occurredAt,
    correlationId: request.correlationId,
    ...(request.investigationId === undefined ? {} : { investigationId: request.investigationId }),
  });
};
