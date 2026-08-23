/**
 * What a caller must hold — four grants, and no fifth.
 *
 * **AD-007: access is restricted independently of ordinary employee access.** Holding
 * `employee.read`, `employment.read` or any other HR grant opens nothing here. Seeing that somebody
 * works for you must never imply seeing what they have been accused of, and the composition suite
 * asserts that no permission belonging to any other module reaches a `relations` handler.
 *
 * **The catalogue and the record are separated**, because they are different disclosures. Reading
 * the catalogue tells you what a tenant's policy is written in and names nobody; reading a violation
 * tells you what somebody is alleged to have done. A person who maintains the policy is not
 * necessarily a person who may read the case files, and one grant covering both would make that
 * distinction unexpressible.
 *
 * **Recording is separate from reading**, in the direction that matters: an investigator who may
 * file a report is not thereby entitled to browse everyone else's.
 *
 * **Nothing is declared for a capability that does not exist.** There is no `relations.manage`, no
 * `relations.admin`, no wildcard, and no permission for investigations, actions, warnings,
 * grievances or appeals — those arrive with the checkpoints that build them (D-5.2-04). A permission
 * that names an absent capability is a grant somebody can hold over nothing, and the day it starts
 * meaning something, they hold it already.
 */
export const RelationsPermissions = {
  /** The tenant's violation catalogue. Configuration; names nobody. */
  categoryRead: 'relations.category.read',
  categoryManage: 'relations.category.manage',

  /** A recorded violation. **Every read under this permission writes an access event** (AD-007). */
  violationRead: 'relations.violation.read',
  violationRecord: 'relations.violation.record',
} as const;

export type RelationsPermission = (typeof RelationsPermissions)[keyof typeof RelationsPermissions];

export const ALL_RELATIONS_PERMISSIONS: readonly string[] = Object.values(RelationsPermissions);
