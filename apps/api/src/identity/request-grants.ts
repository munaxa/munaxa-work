import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The Work permissions the current request holds.
 *
 * **Why async local storage rather than a field somewhere.** The permission checker is a singleton
 * that the CQRS pipeline calls deep inside a handler; it has no request, no principal and no way to
 * be given one without threading an argument through every command and query in the product. The
 * kernel already solved the identical problem twice — the tenant context and the bounded service
 * grant (ADR-0043) are both `AsyncLocalStorage` — and this is the third instance of the same shape,
 * deliberately built the same way rather than a fourth mechanism.
 *
 * **Why it is safe under concurrency, which is the property that matters.** The storage is scoped to
 * an async execution context, not to the process. Two requests running concurrently on one Node
 * process each see the set their own `runWithGrants` established, and neither can observe the
 * other's — the same guarantee that makes the tenant context safe under a connection pool. Nothing
 * here is assigned to a module-level variable, so there is no state to leak between requests and
 * none to reset between them: a request that never entered a scope reads the empty set, which is
 * the fail-closed answer.
 *
 * **Why it is separate from the tenant context.** The two answer different questions and fail
 * independently: a caller may hold every permission and no membership, and must then do nothing.
 * Folding grants into `TenantContext` would put authorization inside the kernel's tenancy type and
 * make "authenticated but a member of nothing" harder to express, not easier.
 */

/** Nobody holds anything. The value outside a request, and the value for a caller with no grants. */
const NOTHING: ReadonlySet<string> = new Set();

const storage = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Runs `work` with exactly these Work permissions in force.
 *
 * The set is the adapter's output: already namespaced, already mapped, already checked against the
 * declared catalogue. Nothing downstream interprets it — the checker asks whether a name is in it.
 */
export const runWithGrants = <TResult>(grants: ReadonlySet<string>, work: () => TResult): TResult =>
  storage.run(grants, work);

/** What the current request holds. Empty outside a request, which refuses everything. */
export const currentGrants = (): ReadonlySet<string> => storage.getStore() ?? NOTHING;
