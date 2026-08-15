import type { Command, HandlerFailure, Query, Result } from '@work/kernel';

/**
 * Asking *and* telling — the capability the one cross-module **write** in Phase 16A needs.
 *
 * Deliberately separate from `Asking`, and deliberately not the `Dispatcher` class. Workflow's
 * delegation adapter reads and takes `Asking`; only the adapter that applies a terminal decision to
 * the module that asked for it takes this, and the difference between the two types is what makes
 * "Workflow writes into exactly one place" a fact about the code rather than a promise in a comment.
 *
 * It is still narrower than a dispatcher: no registration, no handler list, no module registry, no
 * event publication. Two methods, both of which go through the pipeline's permission check — so a
 * command sent through it is refused unless a bounded service grant is open that names the exact
 * permission (ADR-0043).
 */
export interface Sending {
  ask<TResult>(query: Query): Promise<Result<TResult, HandlerFailure>>;
  send<TResult>(command: Command): Promise<Result<TResult, HandlerFailure>>;
}
