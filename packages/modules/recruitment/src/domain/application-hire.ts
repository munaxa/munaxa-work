import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import type { ApplicationState } from './application-state.js';
import type { HireState } from './recruitment-vocabulary.js';

/**
 * The hire saga's state transitions, as pure functions on the application's state.
 *
 * They live beside the aggregate rather than inside it because each one is the *same shape*: take a
 * state, decide whether the step is permitted, and return the state it becomes. Written as methods
 * they would be five near-identical bodies inside an aggregate that is already the largest in this
 * module; written here they are legible together, which matters because their correctness is a
 * property of the sequence rather than of any one of them (ADR-0046).
 *
 * None of them raises an event or touches persistence. The aggregate does both, which keeps the
 * question "what changed, and what did anybody hear about it" in one place.
 */

export interface HireStep {
  readonly state: ApplicationState;
  readonly reached: HireState;
}

/**
 * Drops the failure reason rather than setting it to `undefined`.
 *
 * The distinction is not pedantry: an absent `hire_failure_reason` is a hire that has not failed, and
 * a stale reason left beside a retried hire would describe the attempt before last.
 */
const withoutFailureReason = ({
  hireFailureReason: _cleared,
  ...rest
}: ApplicationState): Omit<ApplicationState, 'hireFailureReason'> => rest;

/**
 * Opens the saga.
 *
 * Only an application with an accepted offer reaches this, and only once: a second call on an
 * application already past `pending` is the *retry* path, and it returns the state it is in rather
 * than restarting from the beginning.
 */
export const beganHire = (state: ApplicationState): RecruitmentResult<HireStep> => {
  if (state.status === 'hired' && state.hireState === 'completed') {
    return refuse('application_already_hired');
  }
  if (state.status !== 'offered' && state.hireState === undefined) {
    return refuse('application_not_ready_to_hire', { status: state.status });
  }
  if (state.hireState !== undefined && state.hireState !== 'failed') {
    return accept({ state, reached: state.hireState });
  }
  return accept({
    state: { ...withoutFailureReason(state), hireState: 'pending' },
    reached: 'pending',
  });
};

/** The person half completed. Idempotent: the same person twice is the retry path. */
export const personLinked = (state: ApplicationState): RecruitmentResult<HireStep> => {
  const current = state.hireState;

  if (current === undefined) return refuse('hire_not_started');
  if (current !== 'pending' && current !== 'failed') return accept({ state, reached: current });

  return accept({
    state: { ...withoutFailureReason(state), hireState: 'person_linked' },
    reached: 'person_linked',
  });
};

/**
 * The employment half completed.
 *
 * `employmentId` is write-once, and a second employment for the same application is refused rather
 * than replacing the first — the failure mode this guards is a retry creating a second workforce
 * record for one hire.
 */
export const employmentCreated = (
  state: ApplicationState,
  employmentId: string,
): RecruitmentResult<HireStep> => {
  if (state.hireState === undefined) return refuse('hire_not_started');
  if (state.employmentId !== undefined && state.employmentId !== employmentId) {
    return refuse('application_already_has_employment');
  }
  return accept({
    state: { ...withoutFailureReason(state), employmentId, hireState: 'employment_created' },
    reached: 'employment_created',
  });
};
