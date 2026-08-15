import { accept, refuse, type WorkflowResult } from '../domain/workflow-rejection.js';
import type { WorkflowStepState } from '../domain/instance.js';
import type { DecisionAuthority } from '../domain/workflow-vocabulary.js';
import { DELEGABLE_SCOPES } from './workflow-permissions.js';
import type { WorkflowDependencies } from './workflow-dependencies.js';

/**
 * Which step of an open branch a caller may answer, and on whose authority.
 *
 * Split from `decision.use-case.ts` at the file-size budget, along the seam that matters most: this
 * is the whole of the access decision for a decision, and it reads better as one file than as three
 * functions among the persistence.
 */

/** One of the open steps, and the authority this caller would decide it on. */
interface Answerable {
  readonly step: WorkflowStepState;
  readonly authority: DecisionAuthority;
}

/**
 * Which of the open branch's steps this caller may answer.
 *
 * **The caller's membership decides this, and `stepId` only narrows it.** 16A read the instance's
 * single awaiting step and asked whether the caller could decide *that*; a branch has several open
 * at once, so the question became "which of these is mine" — and the answer is computed from the
 * membership on the request against each step's own approver, exactly as before. A `stepId` naming
 * somebody else's step produces the same refusal as sending nothing would: it can narrow the
 * caller's own set and cannot widen it.
 *
 * **Identity is asked once**, whatever the size of the branch. A per-step delegation lookup would
 * make deciding one step of a branch of twenty cost twenty cross-module reads.
 *
 * Ambiguity is refused rather than guessed. A version that names somebody individually *and*
 * through a group at one ordinal asks that person twice, and answering "one of them" would record a
 * decision against a step the caller never chose — so they are told to name one.
 */
export const stepsFor = async (
  dependencies: WorkflowDependencies,
  caller: string,
  open: readonly WorkflowStepState[],
  stepId: string | undefined,
): Promise<WorkflowResult<Answerable>> => {
  const named = stepId === undefined ? open : open.filter((step) => step.stepId === stepId);

  if (named.length === 0) return refuse('step-not-awaiting-a-decision');

  const assigned: Answerable[] = named
    .filter((step) => step.approverMembershipId === caller)
    .map((step) => ({ step, authority: 'assigned' as const }));
  const mine = assigned.length > 0 ? assigned : await delegated(dependencies, caller, named);
  const [only] = mine;

  if (only === undefined) return refuse('decision-not-the-assigned-approver');
  if (mine.length > 1) return refuse('decision-step-ambiguous');
  return accept(only);
};

/**
 * The steps of this branch the caller may answer on somebody else's authority.
 *
 * Identity is asked whether the caller is currently acting for anybody, at the instant of the
 * decision, under a scope Workflow honours — a delegation granted for `leave.approve` does not let
 * its holder decide a workflow step. Workflow stores no delegation and runs no expiry: an
 * arrangement that has ended simply is not in the answer.
 *
 * **Only consulted when the caller has no step of their own.** Somebody who is both an approver on
 * this branch and a deputy for a colleague on it answers their own step, because that is the one
 * they were asked to decide.
 */
const delegated = async (
  dependencies: WorkflowDependencies,
  caller: string,
  open: readonly WorkflowStepState[],
): Promise<readonly Answerable[]> => {
  const grants = await dependencies.delegation.activeFor(caller, dependencies.clock.now());
  const acting = new Set(
    grants
      .filter(
        (grant) => grant.delegateMembershipId === caller && DELEGABLE_SCOPES.includes(grant.scope),
      )
      .map((grant) => grant.delegatorMembershipId),
  );

  return open
    .filter((step) => acting.has(step.approverMembershipId))
    .map((step) => ({ step, authority: 'delegated' as const }));
};
