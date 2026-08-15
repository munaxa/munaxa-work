import { ConcurrencyException } from '@work/kernel';

import type { Page, Paged } from './workflow-ports.js';

/**
 * The rules every in-memory store here keeps, and the reasons they are exactly these.
 *
 * **The optimistic version is checked on every update**, exactly as a real
 * `update ... where version = $expected` affects zero rows on a mismatch, and these fakes raise the
 * same `ConcurrencyException` a repository would rather than quietly succeeding. That is what makes
 * a stale write testable before any database exists.
 *
 * **A fake more permissive than the database hides the defects these suites exist to find**, so
 * every partial unique index the schema has is enforced here too: one running approval per subject,
 * one decision per step, one definition per code, one version number per definition, one group code
 * per tenant and one membership per group.
 *
 * **A fake stricter than the database is just as wrong**, and Phase 16B is where that bit. Three
 * rules were dropped from these stores because the schema dropped them: an ordinal is now a branch,
 * so several templates and several steps share one, and every step of the open branch is `awaiting`
 * at once. A fake still refusing those would have refused the feature while every schema test said
 * it was permitted — and the suites resting on it would have been about a database nobody has.
 *
 * The partial-ness matters for the rules that remain. A *full* unique index on the subject would
 * refuse a second approval after the first was rejected — which the schema deliberately permits, and
 * which is how a corrected request is raised. Each predicate below mirrors its index's `where`
 * clause exactly.
 *
 * **What these stores do not prove**, stated rather than implied by a green suite: they are a single
 * process with no concurrency, so they demonstrate the *rule* and not the *race*. Two callers
 * arriving at the same instant is PostgreSQL's arbitration, and Checkpoint 3 already tested it
 * across two real connections. Nothing here claims to have re-proven that, and nothing here proves
 * atomicity either — `InMemoryUnitOfWork` does not roll back.
 *
 * **`workflow_decision` and `workflow_history` have no update and no remove**, matching their
 * production stores and the two triggers behind them. A correction is a new approval.
 */

export const paged = <TState>(items: readonly TState[], page: Paged): Page<TState> => ({
  items: items.slice(page.offset, page.offset + page.limit),
  total: items.length,
});

/**
 * The optimistic check, raising exactly what `Repository.updateRow` raises.
 *
 * `ConcurrencyException` rather than a quiet failure, because that is what the real repository
 * throws when its `where version = $expected` matches no row — and every module since Phase 2 lets
 * it travel to the edge, where it becomes a 409. A fake that returned a quiet failure instead would
 * let a losing writer look like a successful one.
 */
export const expectVersion = (
  table: string,
  held: { readonly version: number },
  expected: number,
): void => {
  if (held.version !== expected) throw new ConcurrencyException(table, expected, held.version);
};

export const bumped = <TState extends { readonly version: number }>(state: TState): TState => ({
  ...state,
  version: state.version + 1,
});

/** Reads the row an update targets, refusing the same way a vanished row would. */
export const heldOr = <TState>(table: string, candidate: TState | undefined): TState => {
  if (candidate === undefined) throw new ConcurrencyException(table, -1, -1);
  return candidate;
};

/**
 * A partial unique index, as a guard.
 *
 * Raised as a `ConcurrencyException` rather than returned, because that is what a repository does
 * when PostgreSQL refuses a duplicate: the exception travels to the edge and becomes a 409. A fake
 * that returned a value would let a handler treat a collision as an ordinary outcome and diverge
 * from production the first time two callers collided.
 */
export const refuseDuplicate = (index: string, exists: boolean): void => {
  if (exists) throw new ConcurrencyException(index, -1, -1);
};

/**
 * Deterministic ordering by the row's own identifier — the tie-break every paged read needs.
 *
 * Takes an accessor rather than a key name so it works on the domain's interfaces, which carry no
 * index signature. Identifiers are UUIDv7, so ordering by them is ordering by creation time, and two
 * rows written in the same millisecond still page in a stable order.
 */
export const byIdentifier =
  <TState>(keyOf: (state: TState) => string) =>
  (left: TState, right: TState): number =>
    keyOf(left).localeCompare(keyOf(right));
