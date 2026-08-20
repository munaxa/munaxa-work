import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { serviceLevelState } from './service-level.js';
import type { WorkflowHistoryEvent } from './workflow-vocabulary.js';
import type { WorkflowInstanceState, WorkflowStepState } from './instance.js';

/**
 * Telling an approver that their step has taken longer than somebody said it should.
 *
 * **It is a message and nothing else** (D-16E-10). No approver is added, no status moves, no decision
 * is written, no branch changes and no denominator shifts — so `assignedOf`, the threshold,
 * `outstanding` and `unresolved` are not merely left alone, they are *unreachable* from here: this
 * function returns who to tell, and the command above it writes one history row. There is no code
 * path from a reminder to a step.
 *
 * **The condition stays derived** (D-16E-05, as amended). Nothing is stored to say a step is overdue,
 * because `serviceLevelState` answers it exactly from two columns and an instant, every time it is
 * asked. A `breached` flag would need something to maintain it, and ADR-0070 has the last word on
 * flags nothing maintains.
 *
 * **The recipient is read, never chosen.** It is the membership already on the step. That is the
 * difference between this and the automatic escalation that was declined as the first automatic
 * action: escalation must *pick* somebody, and no approved mechanism picks anybody (D-16D-16). A
 * reminder picks nobody, which is most of why it is safe to be first.
 *
 * **Not expiry.** A passed service level is a target that passed. Nothing ends, nothing is refused,
 * and D-16E-06 keeps expiry derived and unexecuted.
 */

/**
 * The history this act writes.
 *
 * Typed against the closed vocabulary rather than as a bare string, so the value here and the
 * database's `workflow_history_event_check` cannot drift: if it were ever removed from the list, this
 * stops compiling, and the parity suite fails if the constraint and the list disagree.
 */
export const REMINDER_EVENT: WorkflowHistoryEvent = 'step-reminded';

/** Who to tell, and about which step. Everything a reminder is. */
export interface DueReminder {
  readonly stepId: string;
  readonly instanceId: string;
  readonly ordinal: number;
  /** The membership already named on the step. Read from the row; never selected, never resolved. */
  readonly approverMembershipId: string;
}

/**
 * Whether this step's approver should be reminded **at this instant**, or which refusal says why not.
 *
 * The instant is a parameter and never a clock this function reads — the rule the whole module
 * follows, and the reason the same question asked twice in one millisecond cannot answer differently.
 *
 * **Every refusal is also the stale-execution answer.** A reminder decided at one moment and executed
 * at another is the same question asked again with newer rows: if the approval was answered
 * meanwhile, `reminder-step-not-awaiting` refuses it; if the approval ended, `reminder-instance-not-
 * running` does. So the caller needs no separate notion of staleness, and cannot forget to check for
 * it — re-asking *is* the check.
 *
 * The order is the order that makes each message true: an approval that has ended is not a step
 * problem, and a step nobody is waiting on has no target worth discussing.
 */
export const reminderDue = (
  instance: WorkflowInstanceState,
  step: WorkflowStepState,
  asAt: Date,
): WorkflowResult<DueReminder> => {
  if (instance.status !== 'running') return refuse('reminder-instance-not-running');

  // Belt and braces, and it has caught a real class of mistake elsewhere in this module: a caller
  // holding a step from one instance and an instance from another would otherwise be told something
  // true about a pair that does not exist.
  if (step.instanceId !== instance.instanceId) return refuse('reminder-step-not-on-instance');

  if (step.status !== 'awaiting') return refuse('reminder-step-not-awaiting');

  // A step with no target has no due time at all, which is a different thing from a due time that has
  // not arrived — and the two get different refusals so an administrator is told which one it is.
  if (step.serviceLevel === undefined) return refuse('reminder-step-has-no-service-level');

  // `awaitingAt` is written when a step becomes awaiting and nothing restarts it. Its absence on an
  // awaiting step would be a persistence defect rather than a business state, so it refuses rather
  // than being treated as "due now" — which is what an `undefined` reaching arithmetic would become.
  if (step.awaitingAt === undefined) return refuse('reminder-step-has-no-clock');

  // Strictly `>`: due exactly on the boundary is `within`, exactly as every other reader of this
  // target sees it. A reminder at the instant the target is met would contradict the screen.
  if (serviceLevelState(step.serviceLevel, step.awaitingAt, asAt) !== 'overdue') {
    return refuse('reminder-not-yet-due');
  }

  return accept({
    stepId: step.stepId,
    instanceId: step.instanceId,
    ordinal: step.ordinal,
    // Read from the step, not chosen. There is no branch here, no group, no routing and no candidate
    // list — the person to tell is the person already being asked.
    approverMembershipId: step.approverMembershipId,
  });
};

/**
 * What makes two reminders the same one.
 *
 * **A step, in a tenant** — not the instant, not the job, and not the attempt. A step's clock starts
 * once when it becomes awaiting and nothing restarts it, and a step never returns to `awaiting`, so a
 * step crosses its target exactly once and one reminder per step is the whole of the identity.
 *
 * **This names the identity; it does not enforce it.** Two concurrent executions each read a step
 * with no reminder recorded and each conclude there is one to send. ADR-0071 settles it: *"a `select`
 * followed by an `insert` is not idempotent under concurrency"*, so the guarantee is the partial
 * unique index on the history row, and this is what that index must be unique **on**.
 */
export const reminderIdentity = (tenantId: string, stepId: string): string =>
  `${tenantId}:${stepId}`;
