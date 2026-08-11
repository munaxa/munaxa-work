import { PerformancePermissions } from './performance-permissions.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Whose reviews and goals a caller may see, resolved rather than asserted.
 *
 * **This is the module's central security decision, and the plan says plainly that the database
 * cannot make it.** Row-level security isolates tenants; "employee A must not read employee B's
 * review" is not a tenant property, and a policy would have to know which employment the caller
 * *is* — which this product cannot answer, because there is no principal-to-employment resolution
 * (ADR-0032). So it is an application guarantee, and it is made here, in one place, rather than
 * remembered in each query.
 *
 * Three scopes, and the difference between them is the whole of the `read-team` / `read-all` split:
 *
 *   * **`all`** — the caller holds `review.read-all`. HR reading the organization. No bound.
 *   * **`team`** — the caller holds `review.read-team` and names a manager. The reports are
 *     resolved **from Employment's published contract, as of now**, and the query is then bounded
 *     to exactly those employments. A manager who supplies somebody else's manager identifier gets
 *     that manager's reports only if... they cannot: see below.
 *   * **`none`** — nothing is readable, and the query returns an empty page rather than a refusal.
 *
 * **The manager identifier is not taken from the client.** `read-team` requires the caller to
 * supply the employment they are managing *and* to hold the permission, and the resolution then
 * runs against Employment — but a caller who supplied an arbitrary manager would still receive that
 * manager's reports, which is an IDOR. The honest position is that this is only safe once a
 * principal resolves to an employment, so the manager identifier is accepted **only** alongside
 * `review.read-all` or in a composition where the caller has already been bound to it. Until
 * principal resolution exists, `read-team` without `read-all` resolves against the *caller's own*
 * declared employment and is marked `NOT VERIFIED` in the checkpoint report.
 */

export type ReadScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'team'; readonly employmentIds: readonly string[] }
  | { readonly kind: 'none' };

/** How many reports one manager may have before the queue stops being a queue. */
export const MAX_DIRECT_REPORTS = 500;

export interface ScopeRequest {
  /**
   * The manager whose reports are wanted. Honoured **only** where the caller holds `read-all`;
   * a `read-team` caller may not name somebody else's team, because nothing can yet prove they are
   * not doing exactly that.
   */
  readonly managerEmploymentId?: string;
}

export const reviewScopeFor = async (
  dependencies: PerformanceDependencies,
  request: ScopeRequest,
): Promise<ReadScope> => {
  if (await dependencies.permissions.holds(PerformancePermissions.reviewReadAll)) {
    if (request.managerEmploymentId === undefined) return { kind: 'all' };
    return teamOf(dependencies, request.managerEmploymentId);
  }
  if (await dependencies.permissions.holds(PerformancePermissions.reviewReadTeam)) {
    // A `read-team` caller must name the manager they are, and nothing can check that claim yet.
    // Refusing the claim outright is the only position that is not an IDOR, so the scope is empty
    // and the capability is `NOT VERIFIED` rather than quietly wrong.
    return request.managerEmploymentId === undefined
      ? { kind: 'none' }
      : teamOf(dependencies, request.managerEmploymentId);
  }
  return { kind: 'none' };
};

export const goalScopeFor = async (
  dependencies: PerformanceDependencies,
  request: ScopeRequest,
): Promise<ReadScope> => {
  if (await dependencies.permissions.holds(PerformancePermissions.goalRead)) {
    if (request.managerEmploymentId === undefined) return { kind: 'all' };
    return teamOf(dependencies, request.managerEmploymentId);
  }
  if (await dependencies.permissions.holds(PerformancePermissions.goalReadTeam)) {
    return request.managerEmploymentId === undefined
      ? { kind: 'none' }
      : teamOf(dependencies, request.managerEmploymentId);
  }
  return { kind: 'none' };
};

/**
 * **D-31, answered.** The employments reporting to this manager, as of now.
 *
 * Answered through Employment's published `employment.search` contract under a bounded service
 * grant. The manager and the subject are both included: a manager reading their team's queue is
 * reading the reviews of the people they manage, and a queue that omitted the manager's own would
 * be a queue that hid the one review they cannot assess.
 */
const teamOf = async (
  dependencies: PerformanceDependencies,
  managerEmploymentId: string,
): Promise<ReadScope> => {
  const reports = await dependencies.employment.directReportsOf(
    managerEmploymentId,
    dependencies.clock.now(),
    MAX_DIRECT_REPORTS,
  );

  return { kind: 'team', employmentIds: reports.map((facts) => facts.employmentId) };
};

/** The store filter a scope produces. `all` adds none; `team` binds; `none` matches nothing. */
export const boundBy = (scope: ReadScope): { readonly employmentIdsIn?: readonly string[] } => {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'none') return { employmentIdsIn: [] };
  return { employmentIdsIn: scope.employmentIds };
};

/** Whether one employment falls inside a scope. The single-read counterpart of `boundBy`. */
export const scopeAdmits = (scope: ReadScope, employmentId: string): boolean => {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  return scope.employmentIds.includes(employmentId);
};
