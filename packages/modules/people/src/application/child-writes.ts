import type { DomainEvent, EventOrigin, Transaction } from '@work/kernel';

import { accept, type PeopleResult } from '../domain/people-rejection.js';
import { supersessionAt, type VersionedChildState } from '../domain/versioned-child.js';

import type { ChildStore } from './people-ports.js';

/**
 * The write half of the Versioned Child Entity pattern, in one place.
 *
 * Recording a new address, name, contact or preference is the same five steps every time: work out
 * which period the new one supersedes, close that period at the effective date, bound the new one
 * if a later period already exists, insert it, and collect both aggregates' events. Written out
 * per use case that is five chances to forget the bound — and forgetting it produces two records
 * in force at once, which is precisely the state this pattern exists to make unrepresentable.
 *
 * The bound matters most for a **back-dated correction**. Recording a March address on somebody
 * who also moved in June must close March's predecessor at March and end the new record at June,
 * rather than running it straight through the June move and silently discarding a change somebody
 * deliberately entered.
 */

/** What this helper needs of an aggregate. Every versioned child in the module satisfies it. */
export interface Closeable<TState> {
  snapshot(): TState;
  pullEvents(): readonly DomainEvent[];
  closeAt(effectiveTo: Date, origin: EventOrigin, occurredAt: Date): PeopleResult<Date>;
}

/**
 * Where a new record effective from a date fits among its siblings.
 *
 * Called *before* the aggregate is built, because the bound is a constructor argument: a record
 * that was created open and closed afterwards would be briefly representable in the overlapping
 * state, and "briefly" is long enough when the close is what fails.
 */
export const placementOf = <TState extends VersionedChildState>(
  siblings: readonly TState[],
  effectiveFrom: Date,
): { readonly superseded?: TState; readonly effectiveTo?: Date } => {
  const plan = supersessionAt(siblings, effectiveFrom);

  return {
    ...(plan.superseded === undefined ? {} : { superseded: plan.superseded }),
    ...(plan.boundedAt === undefined ? {} : { effectiveTo: plan.boundedAt }),
  };
};

/** Closes the period a new record supersedes. A no-op when the new record is the first. */
export interface Supersede<TState extends VersionedChildState> {
  readonly store: ChildStore<TState>;
  readonly superseded: TState | undefined;
  rehydrate(state: TState): Closeable<TState>;
  /** The instant the superseded period is closed at: the new record's effective date. */
  readonly at: Date;
  readonly origin: EventOrigin;
  readonly occurredAt: Date;
}

export const closeSuperseded = async <TState extends VersionedChildState>(
  transaction: Transaction,
  request: Supersede<TState>,
): Promise<PeopleResult<undefined>> => {
  if (request.superseded === undefined) return accept(undefined);

  const previous = request.rehydrate(request.superseded);
  const closed = previous.closeAt(request.at, request.origin, request.occurredAt);

  if (!closed.ok) return closed;

  await request.store.update(transaction, previous.snapshot(), request.superseded.version);
  transaction.collect(previous.pullEvents());
  return accept(undefined);
};

/** Inserts a newly built child and hands its events to the transaction. */
export const insertChild = async <TState>(
  transaction: Transaction,
  store: ChildStore<TState>,
  created: Closeable<TState>,
): Promise<void> => {
  await store.insert(transaction, created.snapshot());
  transaction.collect(created.pullEvents());
};
