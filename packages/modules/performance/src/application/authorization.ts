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
 *   * **`team`** — a manager is named by a caller entitled to name one. The reports are resolved
 *     **from Employment's published contract, as of now**, and the query is then bounded to exactly
 *     those employments.
 *   * **`none`** — nothing is readable, and the query returns an empty page rather than a refusal.
 *
 * **The manager identifier is a claim, and a claim is not a proof.** A caller who supplied an
 * arbitrary manager would receive that manager's reports, which is an IDOR — so the identifier is
 * honoured **only** alongside `review.read-all`, where it narrows a caller who could already read
 * everything and therefore escalates nothing. A caller holding `read-team` and nothing else reads
 * **nothing**, whatever they name. That is not a limitation of this function: it is the only
 * position available until a principal resolves to an employment (ADR-0032), and `read-team` is
 * marked `NOT VERIFIED` in the checkpoint report rather than shipped as a guess.
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
    // **A `read-team` caller reads nothing, whatever they name.** The comment above this line used
    // to say exactly that while the code did the opposite — it resolved whichever manager the
    // caller supplied. Over HTTP that is `?managerEmploymentId=<anyone>` and a whole team's
    // reviews, which is the IDOR this module was written to refuse. Nothing can check the claim
    // until a principal resolves to an employment, so the claim is not accepted.
    return { kind: 'none' };
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
    // Same refusal as `reviewScopeFor`, for the same reason: a supplied manager identifier is a
    // claim, not a proof, and a goal queue is as disclosing as a review queue.
    return { kind: 'none' };
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
