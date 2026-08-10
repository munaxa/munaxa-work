import type { Transaction } from '@work/kernel';

import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import { closed, type RecurringState } from '../domain/recurring.js';
import { compensationChange, snapshotOf, type StateSnapshot } from '../domain/change-log.js';
import type { ChangeKind, CompensationSource } from '../domain/compensation-vocabulary.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The write mechanics every recurring compensation change shares: closing the period it supersedes,
 * inserting the new one, translating the database's overlap refusal, and recording the history row.
 *
 * Four behaviours here are load-bearing.
 *
 * **The exclusion violation is translated, not propagated.** Two administrators assigning the same
 * component to one employment concurrently both read, both find nothing in the way, and both write.
 * The read happened before either wrote, so only the database can settle it — and a `23P01`
 * reaching the edge would be reported as a server fault rather than as the ordinary mistake it is.
 * The application check above it is convenience; the constraint is the guarantee (D-4).
 *
 * **Closing writes an end date and nothing else.** No value column on a superseded row is ever
 * touched, which is what lets a payroll re-run for a closed period produce that period's figure.
 *
 * **A history row is written for every change**, in the same transaction. A change without its
 * history, or a history row without its change, cannot exist.
 *
 * **The version is re-read after insert.** The repository stamps `version` to 1 while the state
 * built in the domain still carries 0, and an amendment that used the stale number would be
 * refused for a concurrency conflict that never happened.
 */

/** PostgreSQL's exclusion violation. Recognised by code so `pg` need not be imported here. */
const EXCLUSION_VIOLATION = '23P01';

/** PostgreSQL's unique violation — what an import's idempotency index raises under concurrency. */
const UNIQUE_VIOLATION = '23505';

export const isExclusionViolation = (cause: unknown): boolean =>
  hasCode(cause, EXCLUSION_VIOLATION);

export const isUniqueViolation = (cause: unknown): boolean => hasCode(cause, UNIQUE_VIOLATION);

const hasCode = (cause: unknown, code: string): boolean =>
  typeof cause === 'object' &&
  cause !== null &&
  'code' in cause &&
  (cause as { readonly code?: unknown }).code === code;

/**
 * Inserts a recurring period, translating a concurrent overlap into a business refusal.
 *
 * Returns the state **as persisted**, with the version the repository stamped.
 */
export const insertRecurring = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  state: RecurringState,
): Promise<CompensationResult<RecurringState>> => {
  try {
    await dependencies.stores.recurring.insert(transaction, state);
  } catch (cause) {
    if (isExclusionViolation(cause)) {
      return refuse('component_already_assigned', {
        componentId: state.componentId,
        effectiveFrom: state.effectiveFrom,
      });
    }
    if (isUniqueViolation(cause)) {
      return refuse('compensation_already_recorded', { componentId: state.componentId });
    }
    throw cause;
  }

  const persisted = await dependencies.stores.recurring.byId(transaction, state.id);

  return accept(persisted ?? state);
};

/**
 * Closes the period a change supersedes, at the change's own effective date.
 *
 * Half-open: the closed period ends on the day the new one begins, so the two do not overlap and
 * the exclusion constraint is satisfied by construction rather than by luck.
 */
export const closePeriod = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  superseded: RecurringState,
  effectiveTo: string,
): Promise<CompensationResult<RecurringState>> => {
  const ended = closed(superseded, effectiveTo);

  if (!ended.ok) return ended;

  await dependencies.stores.recurring.update(transaction, ended.value, superseded.version);
  return accept(ended.value);
};

export interface ChangeRecord {
  readonly employmentId: string;
  readonly componentId?: string;
  readonly subjectKind: 'recurring' | 'one_time' | 'adjustment';
  readonly subjectId: string;
  readonly changeKind: ChangeKind;
  readonly previous?: object;
  readonly next?: object;
  readonly effectiveFrom?: string;
  readonly actor: string;
  readonly reasonCode?: string;
  readonly source?: CompensationSource;
}

/**
 * Records what happened, beside what is now true.
 *
 * The snapshots are **full** rather than deltas, because a delta needs the schema it was written
 * against to stay interpretable and a compensation record has to be readable years after a column
 * was renamed. `bigint` becomes an exact decimal string on the way in, so nothing is rounded by
 * JSON.
 */
export const recordChange = async (
  dependencies: CompensationDependencies,
  transaction: Transaction,
  tenantId: string,
  record: ChangeRecord,
): Promise<CompensationResult<void>> => {
  const built = compensationChange(
    {
      tenantId,
      employmentId: record.employmentId,
      subjectKind: record.subjectKind,
      subjectId: record.subjectId,
      changeKind: record.changeKind,
      actor: record.actor,
      ...optional('componentId', record.componentId),
      ...optional('effectiveFrom', record.effectiveFrom),
      ...optional('reasonCode', record.reasonCode),
      ...optional('source', record.source),
      ...snapshot('previousState', record.previous),
      ...snapshot('newState', record.next),
    },
    dependencies.clock.now(),
  );

  if (!built.ok) return built;

  await dependencies.stores.changes.insert(transaction, built.value);
  return accept(undefined);
};

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

const snapshot = (key: string, value: object | undefined): Record<string, StateSnapshot> =>
  value === undefined ? {} : { [key]: snapshotOf(value) };

/**
 * Runs one step inside a savepoint, so a refused row does not abandon the whole transaction.
 *
 * PostgreSQL aborts a transaction on any statement error, including a constraint violation — every
 * statement after it fails with `current transaction is aborted` until a rollback. A bulk load that
 * hit one overlapping row would therefore lose the ninety-nine that were fine, which is the
 * opposite of the bounded, resumable behaviour an import is meant to have.
 *
 * A savepoint per row costs a round trip and buys a batch that reports what actually happened.
 * Nothing outside the import loop needs it: a single command that refuses simply returns, and the
 * aborted transaction is rolled back by the unit of work.
 */
export const withSavepoint = async <TValue>(
  transaction: Transaction,
  name: string,
  step: () => Promise<TValue>,
  onFailure: (cause: unknown) => TValue,
): Promise<TValue> => {
  await transaction.execute(`savepoint ${name}`);

  try {
    const value = await step();

    await transaction.execute(`release savepoint ${name}`);
    return value;
  } catch (cause) {
    await transaction.execute(`rollback to savepoint ${name}`);
    return onFailure(cause);
  }
};
