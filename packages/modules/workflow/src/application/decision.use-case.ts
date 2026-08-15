import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { decide, type DecideRequest, type DecidedStep } from '../domain/decision.js';
import { decisionHistory } from '../domain/history.js';
import { awaitingSteps } from '../domain/instance.js';
import type { BranchVote } from '../domain/branch.js';
import type { ApprovalDecisionKind } from '../domain/workflow-vocabulary.js';
import type { BranchTallyView } from '../contracts/views.js';
import { currentMembership, notFound, refuseWith, refusedBy } from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import { stepsFor } from './decision-authority.js';
import { asTallyView } from './workflow-views.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * An approver answering the step they were asked to answer.
 *
 * **The caller is the membership on the request, and there is no field through which they could name
 * anybody else.** That is the whole of the authorization story for this command: holding
 * `workflow.approval.decide` lets you decide *your own* steps, not any step. A caller-supplied
 * approver would let anybody with the permission approve anything in the tenant.
 *
 * **Delegation is asked, never assumed.** If the caller is not the assigned approver, Identity is
 * asked whether they are currently acting for that approver — at the instant of the decision, from a
 * period agreed in advance (AD-010, D-2). Workflow stores no delegation, keeps no expiry state and
 * runs no expiry job; an expired arrangement simply is not in Identity's answer.
 *
 * **The scope is honoured.** Identity keeps `scope` opaque and says the consuming domain agrees the
 * key, so Workflow honours its own permission name and `*`. A delegation granted for `leave.approve`
 * does not let its holder decide a workflow step — which is the difference between delegating an
 * authority and handing over an account.
 *
 * **Two identities are recorded and never collapsed.** The delegate is the actor; the assigned
 * approver is the authority. Writing the delegator into the actor column would make the record say a
 * director approved something their deputy approved, and that record is what an auditor reads.
 *
 * **A terminal decision reaches the requesting module before Workflow records anything.** The order
 * is deliberate and it is the whole of the seam's honesty: the owning module is asked first, and only
 * if it accepts does Workflow write its decision and commit. A module that refuses leaves no Workflow
 * decision row, no history entry and no completed instance — so there is no state in which Workflow
 * claims an approval succeeded while the module that owns the subject says it did not (D-9).
 *
 * The two writes are **not** in one transaction and this file does not pretend they are: every
 * `UnitOfWork.execute` takes its own connection, so the module commits on its own before Workflow
 * does. The window that leaves — the module committed, Workflow's commit then failed — is closed by
 * reconciliation rather than by a guarantee that does not exist: the retry finds the module already
 * carrying *this* approval identifier and converges. There is no outbox, no retry worker and no
 * scheduler anywhere in this path.
 */

export interface DecideStepCommand extends Command {
  readonly commandName: 'workflow.decide-step';
  readonly instanceId: string;
  readonly decision: ApprovalDecisionKind;
  readonly comment?: string;
  readonly expectedVersion: number;
  /**
   * Which of the caller's own awaiting steps this answers. Optional, and **not an identity**.
   *
   * A caller who is asked once — every 16A approval, and every parallel branch a person appears in
   * once — never sends it: the step is resolved from their membership, as it always was. It exists
   * for the case a branch asks the same person twice, which a version naming somebody individually
   * *and* through a group at one ordinal produces. Naming a step somebody else was asked to decide
   * is refused exactly as it would be without this field: authority is still resolved from the
   * membership on the request and from nothing the command carried.
   */
  readonly stepId?: string;
}

export interface StepDecided {
  readonly decisionId: string;
  readonly instanceStatus: string;
  /** The first step now awaiting a decision, when the approval continues. The 16A shape, kept. */
  readonly awaitingStepId?: string;
  /** Every step now awaiting one. A branch of four opens four; the singular above is the first. */
  readonly awaitingStepIds: readonly string[];
  /** How this branch stood once the decision was counted. The domain's, mapped field for field. */
  readonly tally: BranchTallyView;
}

export const decideStepHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<DecideStepCommand, StepDecided> => ({
  commandName: 'workflow.decide-step',
  permission: WorkflowPermissions.approvalDecide,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const caller = currentMembership();

      if (caller === undefined) return refuseWith('membership-unresolved');

      const instance = await dependencies.stores.instances.byId(transaction, command.instanceId);

      if (instance === undefined) return notFound('workflow-instance');

      const steps = await dependencies.stores.steps.forInstance(transaction, command.instanceId);
      const open = awaitingSteps(steps);

      if (open.length === 0) return refuseWith('instance-has-no-awaiting-step');

      const mine = await stepsFor(dependencies, caller, open, command.stepId);

      if (!mine.ok) return refusedBy(mine.error);

      const { step, authority } = mine.value;
      const request: DecideRequest = {
        decisionId: uuidV7(),
        decision: command.decision,
        decidedByMembershipId: caller,
        authority,
        at: dependencies.clock.now(),
        ...(authority === 'delegated' ? { onBehalfOfMembershipId: step.approverMembershipId } : {}),
        ...(command.comment === undefined ? {} : { comment: command.comment }),
      };
      // Every decision already recorded on this approval. The domain narrows them to the branch it
      // is tallying — passing a subset here would make the caller responsible for arithmetic that
      // decides who is approved.
      const recorded = await dependencies.stores.decisions.forInstance(
        transaction,
        command.instanceId,
      );
      const decided = decide(instance, step, steps, request, recorded.map(asVote));

      if (!decided.ok) return refusedBy(decided.error);

      const delivered = await deliver(dependencies, instance, decided.value);

      if (delivered !== undefined) return refuseWith(delivered);

      await persistDecision(dependencies, transaction, decided.value, command.expectedVersion);
      return success({
        decisionId: decided.value.decision.decisionId,
        instanceStatus: decided.value.instance.status,
        awaitingStepIds: decided.value.next.map((following) => following.stepId),
        tally: asTallyView(step.ordinal, decided.value.tally),
        // The first step of the branch that opened, kept for the shape 16A published. A branch of
        // several has several, which is what `awaitingStepIds` is for.
        ...(decided.value.next[0] === undefined
          ? {}
          : { awaitingStepId: decided.value.next[0].stepId }),
      });
    }),
});

/** A recorded decision, as the vote the tally counts. */
const asVote = (decision: {
  readonly stepId: string;
  readonly decision: ApprovalDecisionKind;
  readonly decidedAt: Date;
}): BranchVote => ({
  stepId: decision.stepId,
  decision: decision.decision,
  decidedAt: decision.decidedAt,
});

/**
 * Tells the module that asked for this approval that it has ended, and reports its refusal if it has
 * one.
 *
 * **Only for a terminal decision.** An approval that has moved on to its next step has decided
 * nothing the requesting module can act on, and telling it so would have the module apply a
 * transition halfway through a chain.
 *
 * Returns `undefined` when Workflow may proceed — the module applied the decision, had already
 * applied *this* approval, or does not route this subject type at all — and a refusal reason when it
 * may not. That reason is one of the four in `WORKFLOW_REFUSALS_FROM_A_SUBJECT`: Workflow does not
 * know *why* a requisition could not be approved and does not invent a sentence for it — it says
 * which kind of refusal happened and leaves the module's own wording where it is owned.
 */
const deliver = async (
  dependencies: WorkflowDependencies,
  instance: {
    readonly subjectType: string;
    readonly subjectId: string;
    readonly instanceId: string;
  },
  decided: DecidedStep,
): Promise<string | undefined> => {
  if (decided.instance.status === 'running') return undefined;

  const outcome = decided.instance.status === 'completed' ? 'approved' : 'rejected';
  const delivery = await dependencies.businessDecision.apply({
    subjectType: instance.subjectType,
    subjectId: instance.subjectId,
    // The approval **is** the instance. A second identifier would be a fact with no owner.
    approvalId: instance.instanceId,
    outcome,
  });

  return delivery.kind === 'refused' ? delivery.reason : undefined;
};

/**
 * The writes a decision makes.
 *
 * 16A wrote the decided step out of `awaiting` before the next one entered it, because
 * `workflow_step_awaiting_idx` refused a second awaiting row and a partial unique index cannot be
 * deferred. Checkpoint 3 widened that index — a branch is asked all at once — so the ordering is no
 * longer a constraint of the schema. It is kept anyway: the decided step first, then what follows,
 * so no intermediate state shows an approval whose next branch is open while the step that opened
 * it still reads as waiting on somebody.
 */
const persistDecision = async (
  dependencies: WorkflowDependencies,
  transaction: Transaction,
  decided: DecidedStep,
  expectedInstanceVersion: number,
): Promise<void> => {
  await dependencies.stores.steps.update(transaction, decided.step, decided.step.version);

  for (const skipped of decided.skipped) {
    await dependencies.stores.steps.update(transaction, skipped, skipped.version);
  }
  // Every step of the branch that opens, not one: a branch of four puts four people on a queue.
  for (const following of decided.next) {
    await dependencies.stores.steps.update(transaction, following, following.version);
  }
  await dependencies.stores.decisions.insert(transaction, decided.decision);

  if (decided.instance.status !== 'running') {
    await dependencies.stores.instances.update(
      transaction,
      decided.instance,
      expectedInstanceVersion,
    );
  }
  // One entry for the decision, one per step of the branch that opened, one per step skipped, and
  // one more if the approval ended. A branch of four opens four queue entries and the timeline has
  // to say so.
  const entries = decisionHistory(
    decided,
    Array.from({ length: 2 + decided.next.length + decided.skipped.length }, () => uuidV7()),
  );

  for (const entry of entries) await dependencies.stores.history.insert(transaction, entry);
};
