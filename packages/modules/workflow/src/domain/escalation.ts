import { branchAt, branchOf } from './branch.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { definedOf } from './defined.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * Bringing somebody else in when an approval is stuck.
 *
 * **It adds an approver and does nothing else** (D-16D-02). Nobody is replaced, nobody is removed, no
 * recorded decision is touched, no clock restarts, and the target the branch was given is the target
 * it keeps. What comes out is one new step for a branch that is already being asked — the same shape
 * as any other step somebody is asked to answer, because that is what it is.
 *
 * **It is a human's act.** Nothing here fires on elapsed time, and there is no scheduler in this
 * repository to fire it. The function is deterministic and takes its instant as a parameter, so a
 * future runner could invoke the command above it unchanged — which is the whole of what "safe for a
 * scheduler" means, and is a property of the semantics rather than of any infrastructure.
 *
 * ---
 *
 * **Why `unanimous` is refused, and why that is not a reinterpretation.**
 *
 * A branch's threshold comes from the denominator, and for `unanimous` the threshold *is* the
 * denominator: every approver the instance snapshotted must approve. Adding an approver to such a
 * branch leaves exactly two possibilities, and the approval rejected both:
 *
 * - count the newcomer's approval toward the threshold, and the branch can complete while an assigned
 *   approver has never answered — their agreement stopped being necessary, which is not what
 *   "unanimous" means and is a replacement in everything but name;
 * - raise the threshold, and the denominator has moved — the locked 16B rule the marker on the step
 *   exists to protect.
 *
 * So escalation on a `unanimous` branch **refuses, by name**, before anything is created. It is a
 * different failure from a branch nobody is waiting on and from asking the same person twice, and
 * collapsing them would tell an administrator to fix the wrong thing (D-16D-08, option (iii)).
 *
 * `majority` and `first-response` have no such difficulty: their thresholds are `floor(n/2) + 1` and
 * `1`, both fixed by the snapshot, and an escalated approval counts toward a number that does not
 * move. A wider pool answering a fixed threshold is exactly what escalating a stuck approval should
 * mean.
 */

/**
 * The history this act would write, named here and **not yet in the closed vocabulary**.
 *
 * `WORKFLOW_HISTORY_EVENTS` is checked against `workflow_history_event_check` by the parity suite, and
 * the constraint is the schema's. Adding the value to the domain list before Checkpoint 3 widens the
 * constraint would make the domain and the database disagree, and the parity suite would say so —
 * correctly. So the name lives here until the two can move together.
 *
 * It is a value rather than a comment because Checkpoint 3 needs the exact string, and because the
 * one thing this event must never be is a decision: an escalation is **not** `step-approved`,
 * `step-rejected` or `step-skipped`, and recording it as any of those would put an answer in the
 * timeline that nobody gave.
 */
export const ESCALATION_EVENT = 'step-escalated';

/** Who is being brought in, to which branch, and when. */
export interface EscalateBranchRequest {
  /** The new step's identifier, supplied by the caller as every other step identifier is. */
  readonly stepId: string;
  /** The branch. A branch is an ordinal, and an ordinal is the only way to name one. */
  readonly ordinal: number;
  readonly approverMembershipId: string;
  readonly at: Date;
}

/**
 * Adds one approver to a branch that is currently being asked, or refuses by name.
 *
 * The five refusals are five different situations for five different people to act on, and each is
 * checked in the order that makes its message true: an approval that has ended is not a branch
 * problem, and a branch nobody is waiting on is not a rule problem.
 */
export const escalateBranch = (
  instance: WorkflowInstanceState,
  steps: readonly WorkflowStepState[],
  request: EscalateBranchRequest,
): WorkflowResult<WorkflowStepState> => {
  if (instance.status !== 'running') return refuse('escalation-instance-not-running');

  const branch = branchAt(steps, request.ordinal);
  const [first] = branch;

  // A branch nobody is waiting on cannot be escalated, and that covers an ordinal with no steps, one
  // whose condition skipped it, and one already approved or rejected (D-16D-04). Asking whether a
  // step is `awaiting` answers all four without enumerating them.
  if (first === undefined || !branch.some((step) => step.status === 'awaiting')) {
    return refuse('escalation-branch-not-awaiting');
  }
  if (branchOf(first).rule === 'unanimous') return refuse('escalation-branch-is-unanimous');

  const held = branch.filter((step) => step.approverMembershipId === request.approverMembershipId);

  // Already snapshotted into this branch: they are assigned, they may answer, and there is nothing to
  // add. Distinct from the case below because the fix is different — this one is "you already asked
  // them", and asking twice would give one person two votes.
  if (held.some((step) => step.escalatedAt === undefined)) {
    return refuse('escalation-approver-already-assigned');
  }
  // Already escalated onto this branch. **This is the duplicate**, and it is what makes repeating a
  // request safe: the same escalation asked twice refuses the second time rather than adding a second
  // step. See the note below on what this does and does not prove.
  if (held.length > 0) return refuse('escalation-already-escalated');

  return accept({
    stepId: request.stepId,
    instanceId: instance.instanceId,
    ordinal: request.ordinal,
    // A resolved person, exactly as a group member or a manager becomes one. There is no escalation
    // approver kind: at the moment somebody is asked there is only ever a membership.
    approverKind: 'membership',
    approverMembershipId: request.approverMembershipId,
    status: 'awaiting',
    escalatedAt: request.at,
    // Their own clock, starting now (P-5). No other step's `awaitingAt` is read or written here, so
    // the original approvers' targets are exactly where they were.
    awaitingAt: request.at,
    // The branch's own configuration, copied from a step already in it. The rule and the quorum
    // decide the branch rather than the step, so a step carrying different ones would be a second
    // answer to the same question; the condition is what admitted this branch and is equally the
    // branch's. The target is copied for the same reason every other step in the branch carries it —
    // an escalated approver is expected to take as long as anybody else was.
    ...definedOf({
      branchRule: first.branchRule,
      quorum: first.quorum,
      condition: first.condition,
      serviceLevel: first.serviceLevel,
    }),
    version: 1,
  });
};

/**
 * What makes two escalations the same one.
 *
 * A duplicate is **the same membership, on the same branch, of the same instance** — not the same
 * request identifier, because a retry is a new request about the same intent, and not the same
 * instant, because two people escalating the same person a second apart mean one thing and not two.
 *
 * **This defines the identity; it does not enforce it.** The check inside `escalateBranch` reads the
 * steps it was given, and two concurrent transactions each read a branch without the other's step and
 * each conclude there is nothing to add. ADR-0071 settles the point: *"a `select` followed by an
 * `insert` is not idempotent under concurrency"*, and the guarantee is a partial unique index rather
 * than a read. Checkpoint 3 owns that index; the domain owns what it must be unique **on**, which is
 * exactly the tuple below.
 */
export const escalationIdentity = (
  instanceId: string,
  ordinal: number,
  approverMembershipId: string,
): string => `${instanceId}:${String(ordinal)}:${approverMembershipId}`;
