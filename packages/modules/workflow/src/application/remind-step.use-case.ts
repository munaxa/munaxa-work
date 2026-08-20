import {
  currentContext,
  isMachineContext,
  success,
  uuidV7,
  type Command,
  type CommandHandler,
  type HandlerFailure,
  type NotificationPort,
  type Result,
} from '@work/kernel';

import { reminderDue } from '../domain/reminder.js';
import { reminderHistory, type ExecutionProvenance } from '../domain/history.js';

import { WorkflowPermissions } from './workflow-permissions.js';
import { notFound, refuseWith, refusedBy } from './workflow-context.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Telling one approver that their step has passed its service level.
 *
 * **The only automatic action in this product** (D-16E-10), and the shape of it is the argument for
 * it being first: it emits one message and changes nothing. No step is written, no status moves, no
 * decision is recorded, and the tally is not merely left alone — this handler holds no step store
 * write and no instance store write, so there is no line of code from here to any of them.
 *
 * ---
 *
 * **The order is claim, then commit, then send** (D-16E-13), and the alternative was considered and
 * rejected by the owner. Sending inside the transaction risks a *duplicate* reminder if the commit
 * then fails; sending after it risks a *lost* one if the send fails. Neither can be eliminated
 * without an outbox, and there is none — dispatch in this product is post-commit, in-process and
 * at-most-once by design (ADR-0053, ADR-0064). So the guarantee is stated rather than hedged:
 *
 * > **at-most-once reminder intent dispatch.**
 *
 * If the send fails after the commit, the history row and the claim remain and no second reminder is
 * generated. That is the accepted cost, and it is acceptable here precisely because a missed reminder
 * changes no business state — the approval is exactly where it was.
 *
 * **The claim and the audit record are one insert.** The history row *is* the idempotency record, so
 * the two cannot disagree: there is no state in which a reminder was recorded but not claimed, or
 * claimed but not recorded. `workflow_history_reminder_idx` arbitrates, and a loser's unique
 * violation aborts its whole transaction before it can reach the send.
 *
 * **Re-evaluated inside the transaction, from rows read inside it.** A job decided at one instant and
 * delivered at another asks the same question again with newer rows, and every stale case is one of
 * the domain's named refusals. There is no separate staleness check to forget.
 *
 * **It refuses a human.** The provenance is required, and only a machine context can supply it — so a
 * person who somehow held the permission would be refused rather than recorded as having sent a
 * reminder, and the database's own constraint refuses the row in any case.
 */

export interface RemindStep extends Command {
  readonly commandName: 'workflow.remind-step';
  readonly instanceId: string;
  readonly stepId: string;
}

/**
 * The execution behind this run, taken from the ambient context and never from the command.
 *
 * A field on the command would let whoever enqueued the job name the execution — and therefore write
 * the audit trail of a run they did not perform. The infrastructure sets the context; nothing a
 * caller can reach sets this.
 */
const executionOfCurrentRun = (): ExecutionProvenance | undefined => {
  const context = currentContext();

  if (context === undefined || !isMachineContext(context)) return undefined;
  return {
    executionIdentity: context.executionIdentity,
    correlationId: context.correlationId,
    ...(context.jobId === undefined ? {} : { jobId: context.jobId }),
    ...(context.attempt === undefined ? {} : { attempt: context.attempt }),
  };
};

export const remindStepHandler = (
  dependencies: WorkflowDependencies & { readonly notifications: NotificationPort },
): CommandHandler<RemindStep, { readonly reminded: boolean }> => ({
  commandName: 'workflow.remind-step',
  permission: WorkflowPermissions.reminderExecute,

  handle: async (command) => {
    const execution = executionOfCurrentRun();

    // Not `forbidden`: the pipeline already decided who may run this. This is the narrower statement
    // that whoever is running it is not a machine, so there is no execution to attribute the entry
    // to — and an entry nothing accounts for is the one row this timeline must never contain.
    if (execution === undefined) return refuseWith('reminder-execution-unknown');

    type Claimed = { readonly reminded: boolean; readonly recipientMembershipId: string };

    const claimed = await dependencies.unitOfWork.execute<Result<Claimed, HandlerFailure>>(
      async (transaction) => {
        const instance = await dependencies.stores.instances.byId(transaction, command.instanceId);

        // Not found rather than forbidden, for an approval in another tenant exactly as for one that
        // does not exist — the same reasoning every other handler here follows.
        if (instance === undefined) return notFound<Claimed>('workflow-instance');

        const steps = await dependencies.stores.steps.forInstance(transaction, command.instanceId);
        const step = steps.find((candidate) => candidate.stepId === command.stepId);

        if (step === undefined) return notFound<Claimed>('workflow-step');

        // The whole condition, re-derived from rows read in this transaction. Every stale case is
        // one of the six named refusals, so a job that arrived late is refused by name rather than
        // by a check somebody had to remember to add.
        const due = reminderDue(instance, step, dependencies.clock.now());

        if (!due.ok) return refusedBy<Claimed>(due.error);

        // The claim and the audit record, in one insert. A duplicate delivery loses here, on the
        // partial unique index, and its transaction aborts before the send below.
        await dependencies.stores.history.insert(
          transaction,
          reminderHistory(due.value, dependencies.clock.now(), uuidV7(), execution),
        );

        return success<Claimed>({
          reminded: true,
          recipientMembershipId: due.value.approverMembershipId,
        });
      },
    );

    if (!claimed.ok) return claimed;

    // ---- committed ----------------------------------------------------------------------------
    //
    // Everything above is durable. What follows is at-most-once and is allowed to fail: the reminder
    // may be lost, and no second one will be generated, because the claim is committed and history is
    // immutable. That is the approved trade (D-16E-13) and it is not concealed by a retry here.
    const recipient = await dependencies.reminderRecipient.recipient(
      claimed.value.recipientMembershipId,
    );

    await dependencies.notifications.notify({
      // What happened, never how to say it: the channel is the recipient's preference and the
      // tenant's configuration, and a domain that named one would be taking a decision that is not
      // its to take.
      templateKey: 'workflow.step.reminder',
      recipients: [{ userId: recipient.workforceUserId }],
      // The minimum a template needs to identify the approval. No decision content, no comment, and
      // nothing about the subject the approval is *about* — that is the requesting module's to say.
      variables: { instanceId: command.instanceId, stepId: command.stepId },
      correlationId: execution.correlationId,
      // The same identity the database claimed, so a repeat is suppressed at the port as well.
      idempotencyKey: `${command.stepId}:step-reminded`,
    });

    return success({ reminded: true });
  },
});
