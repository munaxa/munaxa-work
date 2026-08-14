import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { decide, type DecideRequest, type DecidedStep } from '../domain/decision.js';
import { decisionHistory } from '../domain/history.js';
import { awaitingStep } from '../domain/instance.js';
import type { ApprovalDecisionKind } from '../domain/workflow-vocabulary.js';
import { currentMembership, notFound, refuseWith, refusedBy } from './workflow-context.js';
import { DELEGABLE_SCOPES, WorkflowPermissions } from './workflow-permissions.js';
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
 */

export interface DecideStepCommand extends Command {
  readonly commandName: 'workflow.decide-step';
  readonly instanceId: string;
  readonly decision: ApprovalDecisionKind;
  readonly comment?: string;
  readonly expectedVersion: number;
}

export interface StepDecided {
  readonly decisionId: string;
  readonly instanceStatus: string;
  /** The step now awaiting a decision, when the approval continues. Absent once it has ended. */
  readonly awaitingStepId?: string;
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
      const step = awaitingStep(steps);

      if (step === undefined) return refuseWith('instance-has-no-awaiting-step');

      const authority = await authorityOf(dependencies, caller, step.approverMembershipId);

      if (authority === undefined) return refuseWith('decision-not-the-assigned-approver');

      const request: DecideRequest = {
        decisionId: uuidV7(),
        decision: command.decision,
        decidedByMembershipId: caller,
        authority,
        at: dependencies.clock.now(),
        ...(authority === 'delegated' ? { onBehalfOfMembershipId: step.approverMembershipId } : {}),
        ...(command.comment === undefined ? {} : { comment: command.comment }),
      };
      const decided = decide(instance, step, steps, request);

      if (!decided.ok) return refusedBy(decided.error);

      await persistDecision(dependencies, transaction, decided.value, command.expectedVersion);
      return success({
        decisionId: decided.value.decision.decisionId,
        instanceStatus: decided.value.instance.status,
        ...(decided.value.next === undefined ? {} : { awaitingStepId: decided.value.next.stepId }),
      });
    }),
});

/**
 * On whose authority this caller may decide this step, or nothing.
 *
 * `assigned` when they are the approver. `delegated` when Identity says they are acting for that
 * approver *now*, under a scope Workflow honours. `undefined` when neither — which the caller sees
 * as a refusal rather than as a not-found, because they already hold the instance identifier and
 * telling them the step is not theirs discloses nothing they did not send.
 */
const authorityOf = async (
  dependencies: WorkflowDependencies,
  caller: string,
  approver: string,
): Promise<'assigned' | 'delegated' | undefined> => {
  if (caller === approver) return 'assigned';

  const grants = await dependencies.delegation.activeFor(caller, dependencies.clock.now());
  const acting = grants.some(
    (grant) =>
      grant.delegatorMembershipId === approver &&
      grant.delegateMembershipId === caller &&
      DELEGABLE_SCOPES.includes(grant.scope),
  );

  return acting ? 'delegated' : undefined;
};

/**
 * The writes a decision makes, in the order the indexes require.
 *
 * The decided step leaves `awaiting` **before** the next one enters it. `workflow_step_awaiting_idx`
 * is a partial unique index and cannot be deferred, so the reverse order momentarily holds two
 * awaiting rows on one instance and PostgreSQL refuses it. Checkpoint 3 stated the rule in a comment
 * and asserted it in a test; this is the code that has to obey it.
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
  if (decided.next !== undefined) {
    await dependencies.stores.steps.update(transaction, decided.next, decided.next.version);
  }
  await dependencies.stores.decisions.insert(transaction, decided.decision);

  if (decided.instance.status !== 'running') {
    await dependencies.stores.instances.update(
      transaction,
      decided.instance,
      expectedInstanceVersion,
    );
  }
  const entries = decisionHistory(
    decided,
    Array.from({ length: 2 + decided.skipped.length }, () => uuidV7()),
  );

  for (const entry of entries) await dependencies.stores.history.insert(transaction, entry);
};
