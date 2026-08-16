import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';

/**
 * The requester's manager, as an approver.
 *
 * **Every word of that sentence is an approved parameter, not a reading this module chose.** A
 * `manager` step means the manager of the person who raised the approval (P-1), through their
 * primary active employment (P-2), along the `primary` reporting line (P-3), exactly one level up
 * (P-4), as at the instant the approval started (D-16C-11), converted to a civil date in UTC (P-6).
 * None of those is configurable, and none may be widened here without a new approval.
 *
 * **This file queries nothing.** Resolving a manager crosses two module boundaries — Identity holds
 * which employment a membership has and which membership an employment belongs to, Employment holds
 * the reporting line — and a domain function that reached for either would be the coupling ADR-0023
 * exists to prevent. So the shape is exactly the one 16B used for groups: the **application** does
 * the reading and hands the answer in, and this decides what the answer means.
 *
 * **The answer is a value with four ways of being absent, and they are four refusals.** A missing
 * manager is not an empty list and never a skipped step (P-4, and constraint 5 of the parameter
 * approval): an approval configured to ask somebody's manager, that cannot find one, must stop and
 * say which link broke. That is 16B's `branch-group-empty` rule arriving by another road — a branch
 * nobody was asked to decide would complete instantly while looking like a process.
 *
 * The refusals are deliberately **four rather than one**, because they are four different mistakes
 * somebody has to go and fix: nobody linked the requester to an employment, nobody gave that
 * employment a manager, the manager's employment belongs to nobody who can sign in, or the requester
 * holds employments and none of them is primary. A single "manager unresolved" would send all four
 * to the same person, and three of them are not that person's to fix.
 */

/**
 * What the application found when it followed the chain, or where the chain ended.
 *
 * A discriminated union rather than an optional membership, so a caller cannot hand in "nothing
 * found" without saying **which** link was missing. The domain then has a fact to refuse with rather
 * than an absence to guess about.
 *
 * `resolved` carries the whole chain, not only its answer. The employment identifiers are provenance
 * — the audit's version of "why was I asked?" — and the application stores the manager's membership
 * on the step exactly as it stores a group's identifier today.
 */
export type ManagerResolution =
  | {
      readonly outcome: 'resolved';
      /** The requester's primary active employment. */
      readonly employmentId: string;
      /** The manager's employment, in force on the resolution date along the primary line. */
      readonly managerEmploymentId: string;
      /** The active membership that employment belongs to. This is who gets asked. */
      readonly managerMembershipId: string;
    }
  /** The requester's membership has no active primary employment (P-2). */
  | { readonly outcome: 'no-primary-employment' }
  /** That employment has no manager on the primary reporting line on the resolution date (P-3). */
  | { readonly outcome: 'no-manager' }
  /** The manager's employment resolves to no active membership — nobody who could be asked. */
  | { readonly outcome: 'manager-not-a-member' };

/** The one approver a `manager` template resolves to. Exactly one, or none at all. */
export interface ResolvedManager {
  readonly managerMembershipId: string;
  /** The manager's employment, kept for provenance. Nothing routes on it. */
  readonly managerEmploymentId: string;
}

/**
 * The resolution, checked and turned into an approver or a named refusal.
 *
 * The self-approval check is the one rule here that is not simply a translation of the parameters,
 * and it is not an invention either: it is 16A's cycle rule (D-5 — *a step may not name an approver
 * already terminal on the same instance*) meeting the fact that a manager is now resolved rather
 * than typed. Somebody who manages themselves — a founder, a placeholder reporting line, a data
 * error — would otherwise be asked to approve their own request, and the approval would look like a
 * process while being a formality. It refuses rather than skips, for the same reason everything else
 * here refuses.
 */
export const resolveManager = (
  requesterMembershipId: string,
  resolution: ManagerResolution,
): WorkflowResult<ResolvedManager> => {
  if (resolution.outcome === 'no-primary-employment') {
    return refuse('manager-no-primary-employment');
  }
  if (resolution.outcome === 'no-manager') return refuse('manager-not-assigned');
  if (resolution.outcome === 'manager-not-a-member') return refuse('manager-not-a-member');
  if (resolution.managerMembershipId === requesterMembershipId) {
    return refuse('manager-is-the-requester');
  }
  return accept({
    managerMembershipId: resolution.managerMembershipId,
    managerEmploymentId: resolution.managerEmploymentId,
  });
};

/**
 * The civil date the reporting line is read at, from the instant the approval started.
 *
 * **One named function, pinned to UTC** (P-6). Employment's contract takes `asOf` as a civil date
 * string and Workflow holds only instants, so somebody has to choose a day — and the choice is a
 * time zone whether or not anybody writes one down. Left to the server's own zone, the same approval
 * would resolve against a different day depending on where the process happens to run, and an
 * approval raised at 23:30 UTC would find yesterday's manager in Los Angeles and tomorrow's in
 * Riyadh.
 *
 * UTC rather than the tenant's zone is a deliberate cost: the tenant's zone lives in Organization's
 * settings, and D-16C-05 declined to take an Organization dependency for it. A reporting line that
 * changes at midnight local time is therefore read against the UTC day — which is stated here rather
 * than discovered, and is the reason the boundary is tested rather than assumed.
 *
 * `toISOString` is already UTC by definition, so the slice is the whole conversion. Nothing here
 * consults a clock: the instant arrives from the instance.
 */
export const resolutionDateOf = (startedAt: Date): string => startedAt.toISOString().slice(0, 10);
