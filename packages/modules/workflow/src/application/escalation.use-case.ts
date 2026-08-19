import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { escalateBranch } from '../domain/escalation.js';
import { escalationHistory } from '../domain/history.js';
import { currentMembership, notFound, refuseWith, refusedBy } from './workflow-context.js';
import { WorkflowPermissions } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Bringing one more approver into a branch that is stuck.
 *
 * **A human asks for this and nothing else does.** There is no timer, no sweep and no consumer that
 * could invoke it: the command exists only at the end of a request somebody made, which is D-16C-02
 * unchanged — nothing terminal fires without a human request. The handler is deterministic and takes
 * its instant from the injected clock, so a future runner *could* call it unchanged; that is a
 * property of the semantics and not an invitation to build one.
 *
 * **Every rule belongs to the domain.** This handler loads the approval, hands it to
 * `escalateBranch`, and writes what comes back. It computes no denominator, no threshold, no
 * majority, no quorum, no outstanding count and no eligibility of its own — a second copy of any of
 * those would be a second answer, and the tally is exactly the rule that decides who is approved.
 *
 * **Two writes and one transaction**: the new step, and the timeline entry saying who added them.
 * Either both exist or neither does, which matters because a step with no history entry is an
 * approver nobody can account for, and an entry with no step is a record of something that did not
 * happen.
 *
 * **The membership on the command is the person being added, never the person asking.** Whoever
 * asked is resolved from the request context, exactly as the requester of an approval is, and there
 * is no field through which a caller could name themselves or anybody else as the actor. Its own
 * permission guards it — `workflow.approval.escalate`, implied by nothing, because changing who
 * approves an approval *already under way* is the most powerful thing an administrator can do to one
 * short of ending it.
 */
export interface EscalateBranchCommand extends Command {
  readonly commandName: 'workflow.escalate-branch';
  readonly instanceId: string;
  /** The branch, named the only way a branch can be named. */
  readonly ordinal: number;
  /** The approver being **added**. Not the caller, and never treated as one. */
  readonly approverMembershipId: string;
}

export const escalateBranchHandler = (
  dependencies: WorkflowDependencies,
): CommandHandler<EscalateBranchCommand, { readonly stepId: string }> => ({
  commandName: 'workflow.escalate-branch',
  permission: WorkflowPermissions.approvalEscalate,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      // The escalation is somebody's act, and the timeline has to be able to say whose. A context
      // that resolved no membership is refused rather than recorded with an empty actor.
      const by = currentMembership();

      if (by === undefined) return refuseWith('escalation-actor-unknown');

      const held = await dependencies.stores.instances.byId(transaction, command.instanceId);

      // Not found rather than forbidden, for an approval in another tenant exactly as for one that
      // does not exist: "forbidden" would confirm that this instance is real.
      if (held === undefined) return notFound('workflow-instance');

      const steps = await dependencies.stores.steps.forInstance(transaction, command.instanceId);
      const at = dependencies.clock.now();
      // **One Identity read, for the one membership named on the command** (D-16D-12, A). Never for
      // anybody already on the branch, never in a loop, and never for a list — the person being added
      // is the only one whose standing this command has any business asking about.
      //
      // Asked **unconditionally**, before the domain runs, because `escalateBranch` is a pure
      // function and the answer is one of its inputs. So a request the domain would refuse for some
      // other reason still costs this one read; the alternative is evaluating the branch rules out
      // here to decide whether to ask, which would put a second copy of them in the handler to save a
      // single bounded lookup. Which refusal *wins* is still the domain's, and it prefers the branch.
      //
      // It **raises** rather than answering when Identity cannot be reached, and that is the whole
      // reason the call is here rather than folded into a boolean somewhere: an outage must abort the
      // command before anything is written, not arrive at the domain disguised as "not eligible".
      const standing = await dependencies.membershipStanding.standing(command.approverMembershipId);
      const escalated = escalateBranch(held, steps, {
        stepId: uuidV7(),
        ordinal: command.ordinal,
        approverMembershipId: command.approverMembershipId,
        at,
        approverIsActive: standing.active,
      });

      // Seven distinct refusals, passed through as themselves. Collapsing them would tell an
      // administrator to fix the wrong thing — "this branch is unanimous" and "you already asked
      // them" are different problems with different answers.
      if (!escalated.ok) return refusedBy(escalated.error);

      // The new step only. No existing step is read back, updated or re-written here, which is what
      // makes "adds an approver, never replaces one" true of the code rather than of a comment.
      await dependencies.stores.steps.insert(transaction, escalated.value);
      await dependencies.stores.history.insert(
        transaction,
        escalationHistory(escalated.value, at, uuidV7(), by),
      );

      return success({ stepId: escalated.value.stepId });
    }),
});
