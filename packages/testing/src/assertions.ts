import type { DomainEvent, HandlerFailure, Result } from '@work/kernel';

/**
 * Shared assertions.
 *
 * They exist to make a failing test say what is wrong rather than that `false` was not `true`.
 * A test whose failure message is "expected false to be true" costs the reader the same
 * investigation every time.
 */

export const expectedEvent = (
  events: readonly DomainEvent[],
  eventName: string,
): DomainEvent | undefined => events.find((event) => event.eventName === eventName);

/** Asserts an event was raised, naming what was raised instead when it was not. */
export const assertEventRaised = (
  events: readonly DomainEvent[],
  eventName: string,
): DomainEvent => {
  const found = expectedEvent(events, eventName);

  if (found === undefined) {
    const raised = events.map((event) => event.eventName);
    throw new Error(
      `Expected ${eventName} to be raised. Raised: ${raised.length === 0 ? 'nothing' : raised.join(', ')}.`,
    );
  }
  return found;
};

export const assertNoEventRaised = (events: readonly DomainEvent[], eventName: string): void => {
  if (expectedEvent(events, eventName) !== undefined) {
    throw new Error(`Expected ${eventName} not to be raised, but it was.`);
  }
};

/** Asserts a handler refused for a specific reason, naming the reason it gave instead. */
export const assertFailedWith = <TValue>(
  result: Result<TValue, HandlerFailure>,
  kind: HandlerFailure['kind'],
): HandlerFailure => {
  if (result.ok) {
    throw new Error(`Expected a ${kind} failure, but the operation succeeded.`);
  }
  if (result.error.kind !== kind) {
    throw new Error(`Expected a ${kind} failure, got ${result.error.kind}.`);
  }
  return result.error;
};

/** Asserts success, surfacing the failure rather than a bare undefined. */
export const assertSucceeded = <TValue>(result: Result<TValue, HandlerFailure>): TValue => {
  if (!result.ok) {
    throw new Error(`Expected success, got ${result.error.kind}: ${JSON.stringify(result.error)}.`);
  }
  return result.value;
};
