/**
 * What a caller must hold — nine grants, and no tenth.
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
 * **Conducting an inquiry is separate from filing a report** (D-5.2-18, approved 2026-08-23). Until
 * Checkpoint 3 the two commands rode on `relations.violation.record`, which meant anyone who could
 * file an allegation could also conclude the inquiry into it. Those are different acts: an
 * allegation is a claim an investigation can refute, whereas a conclusion is what a penalty is later
 * justified by.
 *
 * **Reading an inquiry's findings is separate from reading that it exists.** This is Documents'
 * distinction applied where it was always meant to apply — its own permission file justifies
 * `document.read-sensitive` by Phase 4.1 AD-007, *"seeing an employee never implies seeing their
 * medical or **disciplinary** attachments"*. `relations.violation.read` reaches a case, its history
 * and an inquiry's existence; the investigator's account of what a colleague did needs a second
 * grant, additive and never instead.
 *
 * **Nothing is declared for a capability that does not exist.** There is no `relations.manage`, no
 * `relations.admin`, no wildcard, and no permission for actions, warnings, grievances or appeals —
 * those arrive with the checkpoints that build them (D-5.2-04). A permission that names an absent
 * capability is a grant somebody can hold over nothing, and the day it starts meaning something,
 * they hold it already. **There is deliberately no `relations.investigation.read`**: an inquiry's
 * existence is part of the case, and a third investigation grant would be the fifth permission
 * D-5.2-18 refused in advance.
 *
 * **The ladder is configuration and is separated from the case, exactly as the catalogue is.**
 * Reading which rules a tenant configured names nobody; reading what somebody was actually issued is
 * a disciplinary disclosure and rides on `relations.violation.read`. **There is no
 * `relations.action.read`**: an issued action is part of the case, and a caller who may read the
 * case may see what it produced.
 */
export const RelationsPermissions = {
  /** The tenant's violation catalogue. Configuration; names nobody. */
  categoryRead: 'relations.category.read',
  categoryManage: 'relations.category.manage',

  /** A recorded violation. **Every read under this permission writes an access event** (AD-007). */
  violationRead: 'relations.violation.read',
  violationRecord: 'relations.violation.record',

  /** Opening and concluding an inquiry, and correcting a concluded one. Never grants findings. */
  investigationConduct: 'relations.investigation.conduct',
  /**
   * Any payload carrying `findings` or `recommendation`. **Additional to `violationRead`, never
   * instead of it**, and a caller without it meets `not_found` rather than a distinguishable
   * refusal — because "forbidden" on an inquiry confirms that findings exist about somebody, which
   * in this domain is itself the disclosure.
   */
  investigationReadFindings: 'relations.investigation.read-findings',

  /** The tenant's disciplinary ladder. Configuration; names nobody. */
  ladderRead: 'relations.ladder.read',
  ladderManage: 'relations.ladder.manage',
  /**
   * Issuing a disciplinary action — **the most consequential act in this module**.
   *
   * Its own grant, and deliberately not `relations.violation.record`: filing an allegation and
   * deciding what somebody is disciplined for are not the same authority, and the module has already
   * separated conducting an inquiry from filing one (D-5.2-18). It does **not** imply reading
   * findings, and reading findings does not imply it.
   */
  actionIssue: 'relations.action.issue',
} as const;

export type RelationsPermission = (typeof RelationsPermissions)[keyof typeof RelationsPermissions];

export const ALL_RELATIONS_PERMISSIONS: readonly string[] = Object.values(RelationsPermissions);
