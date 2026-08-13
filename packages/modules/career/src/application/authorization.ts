import type { CareerDependencies } from './career-dependencies.js';
import { CareerPermissions } from './career-permissions.js';

/**
 * How wide a read is, decided by what the caller holds and never by what they asked for.
 *
 * Three outcomes and no fourth:
 *
 * **`all`** — the caller holds the module's read permission. HR reading the organization's
 * succession position. Every filter they supply is honoured, because they were already entitled to
 * all of it.
 *
 * **`bounded`** — reserved for a caller whose reads must be confined to a set of employments this
 * module resolved. Nothing produces it yet, for the reason below, and the shape exists so the query
 * layer is already written to apply a bound rather than being retrofitted with one later.
 *
 * **`none`** — the caller holds something narrower, and reads nothing.
 *
 * **`read-team` currently reads nothing, whatever the caller names.** Resolving a manager's team
 * requires knowing which employment the caller *is*, and this repository has no
 * principal-to-employment resolution (ADR-0032). The alternative — trusting a `managerEmploymentId`
 * from the request — would let anybody read anybody's readiness assessment by changing a number in
 * a URL, which is an IDOR wearing a permission's name. In this module that is the more serious
 * version of the same defect Learning avoided: a training record is sensitive, and "your manager
 * has recorded that you are not ready" is more so.
 *
 * So the permission is declared, the port that would answer it exists and is bounded, and the scope
 * is `none` until the platform can say who is asking. That is `NOT VERIFIED`, stated rather than
 * approximated.
 *
 * **`read-own` is the same case**, and is enforced nowhere for the same reason.
 */

export type ReadScope =
  | { readonly kind: 'all' }
  | { readonly kind: 'bounded'; readonly employmentIds: readonly string[] }
  | { readonly kind: 'none' };

export const ALL: ReadScope = { kind: 'all' };
export const NONE: ReadScope = { kind: 'none' };

/**
 * The scope for a read of records about named people — plans, memberships, assessments,
 * development plans, recommendations.
 *
 * The wide permission is checked **first**, because a caller holding both should get the wider one;
 * a resolver that checked the narrower permission first would silently downgrade HR.
 */
export const personScopeFor = async (
  dependencies: CareerDependencies,
  wide: string,
): Promise<ReadScope> => {
  if (await dependencies.permissions.holds(wide)) return ALL;
  if (await dependencies.permissions.holds(CareerPermissions.planReadTeam)) {
    // A `read-team` caller reads nothing, whatever they name. See the note above: without
    // principal-to-employment resolution, honouring a caller-supplied manager identifier would be
    // an IDOR, and honouring nothing is the only correct answer available.
    return NONE;
  }
  return NONE;
};

/**
 * The scope applied to a read of one named employment's records.
 *
 * Returns whether the caller may see that employment at all. A `bounded` caller may see only the
 * employments in their bound — never one they named that happens to exist.
 */
export const mayRead = (scope: ReadScope, employmentId: string): boolean => {
  if (scope.kind === 'all') return true;
  if (scope.kind === 'none') return false;
  return scope.employmentIds.includes(employmentId);
};

/**
 * The employment bound a store filter carries, where the scope has one.
 *
 * `undefined` for `all` — no bound is applied because none is needed. A `none` scope never reaches a
 * store: the query returns an empty page before it gets there, so an empty `employmentIdsIn` cannot
 * be mistaken for "no filter" by a store that treats an empty array as absent.
 */
export const boundOf = (scope: ReadScope): readonly string[] | undefined =>
  scope.kind === 'bounded' ? scope.employmentIds : undefined;
