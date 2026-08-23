import { RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Whether this caller may see what an investigation found — D-5.2-18, approved 2026-08-23.
 *
 * One function rather than the same two lines in three handlers, because the rule has to be
 * identical everywhere it applies. It is deliberately the shape of Documents' `hiddenFromCaller`:
 * `relations.violation.read` reaches a case, its history and the fact that an inquiry exists;
 * `relations.investigation.read-findings` is required **in addition** for the investigator's account
 * of what a colleague is said to have done.
 *
 * **Withheld findings are absent, never blanked.** A field present and empty, or a marker saying
 * "redacted", tells the reader that findings exist — and for a manager reading about their own
 * report, knowing an investigator wrote something is most of the disclosure. So the fields are
 * omitted exactly as they are for an inquiry that is still open, and the two are indistinguishable
 * from outside.
 *
 * **A read of one inquiry by identifier is `not_found` when findings are withheld**, decided by the
 * caller rather than here. That is the approved behaviour and Documents' reasoning: *"forbidden" on
 * an identifier confirms that a record of that kind exists for that employee, and in this module
 * that confirmation is itself the disclosure*.
 */
export const mayReadFindings = (dependencies: RelationsDependencies): Promise<boolean> =>
  dependencies.permissions.holds(RelationsPermissions.investigationReadFindings);
