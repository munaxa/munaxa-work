import type { FilledHeadcountPort } from './organization-ports.js';

/**
 * How many employment assignments exist against a position in a unit: none, because Employment
 * does not exist yet.
 *
 * This is the honest adapter, not a stub. Organization must never count employees itself
 * (AD-002), so the number has to come from outside; Phase 5 owns assignments and will supply the
 * implementation that counts them. Until then there genuinely are no assignments, so zero is the
 * *correct* answer rather than a placeholder — and the establishment projection stays right when
 * the real adapter replaces this one, because nothing about the arithmetic changes.
 *
 * Named for what it asserts rather than for what it is. `NullFilledHeadcount` would read as
 * something forgotten; `NoAssignmentsYet` reads as the fact it encodes.
 */
export class NoAssignmentsYet implements FilledHeadcountPort {
  public filledFor(): Promise<number> {
    return Promise.resolve(0);
  }
}
