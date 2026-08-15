import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { branchAt, branchOrdinals, conditionsOf } from './branch.js';
import { evaluateAllOf, type BranchCondition } from './condition.js';
import type { WorkflowStepTemplateState } from './definition.js';

/**
 * Turning a version's templates into the steps an instance actually runs, and choosing which branch
 * runs next.
 *
 * Two jobs, in one file because they are the same job at two moments: *which approvers are asked,
 * and which branch is asked now*. Starting an instance answers both from the beginning; deciding a
 * branch answers the second again from wherever the approval got to.
 *
 * **A group is resolved once and never again.** The members are supplied by the caller — the
 * application reads them, because a domain function does not query anything — and copied into the
 * steps. From that moment the group is irrelevant to this approval: editing it, emptying it or
 * deleting it changes nothing, and "why was I asked?" is answered by a step that exists rather than
 * by a list as it stands today. This is 16A's rule about copying a version's steps (AD-003,
 * ADR-0048), applied to the one new thing that could otherwise change underneath a running approval.
 *
 * **A condition decides whether a branch runs at all**, and it is evaluated against the instance's
 * own `context` — the payload the requesting module supplied, stored since 16A and until now read by
 * nothing. A branch whose condition does not hold is **skipped**, with the history entry every
 * skipped step gets. A condition that cannot be evaluated **refuses the whole operation**: nothing is
 * written, and nobody is quietly routed past.
 */

/** A group's membership as it stood when the caller read it. The snapshot, not the group. */
export interface GroupSnapshot {
  readonly approvalGroupId: string;
  readonly members: readonly string[];
}

/** One approver an instance will actually ask, after groups have been expanded. */
export interface PlannedStep {
  readonly ordinal: number;
  readonly approverMembershipId: string;
  /** The group this approver came from, when they came from one. Provenance, for the audit. */
  readonly sourceGroupId?: string;
}

/**
 * Every approver a version's templates resolve to, in branch order then membership order.
 *
 * Deterministic, because the identifiers assigned to these steps come from the caller in this order:
 * a plan that reordered itself between two reads would hand the same person a different step
 * identifier, and a test could never pin it.
 *
 * **An empty group refuses the whole start.** This is the moment an empty list actually matters —
 * publication was too early to check it, because a group's membership at publication is not its
 * membership now. An approval that started with a branch nobody was asked to decide would complete
 * instantly while looking like a process, which is the failure `version-has-no-steps` exists to
 * prevent, arriving by another road.
 */
export const planSteps = (
  templates: readonly WorkflowStepTemplateState[],
  groups: readonly GroupSnapshot[],
): WorkflowResult<readonly PlannedStep[]> => {
  const planned: PlannedStep[] = [];
  const ordered = [...templates].sort(
    (left, right) =>
      left.ordinal - right.ordinal || left.stepTemplateId.localeCompare(right.stepTemplateId),
  );

  for (const template of ordered) {
    if (template.approverKind === 'membership') {
      const membershipId = template.approverMembershipId;

      if (membershipId === undefined) return refuse('step-approver-required');
      planned.push({ ordinal: template.ordinal, approverMembershipId: membershipId });
      continue;
    }

    const groupId = template.approverGroupId;

    if (groupId === undefined) return refuse('step-approver-required');

    const snapshot = groups.find((group) => group.approvalGroupId === groupId);

    if (snapshot === undefined) return refuse('branch-group-unresolved', { group: groupId });
    if (snapshot.members.length === 0) return refuse('branch-group-empty', { group: groupId });

    for (const membershipId of snapshot.members) {
      planned.push({
        ordinal: template.ordinal,
        approverMembershipId: membershipId,
        sourceGroupId: groupId,
      });
    }
  }
  return accept(planned);
};

/** How many step identifiers a caller must supply to start an instance from these templates. */
export const plannedStepCount = (
  templates: readonly WorkflowStepTemplateState[],
  groups: readonly GroupSnapshot[],
): number => {
  const planned = planSteps(templates, groups);

  return planned.ok ? planned.value.length : 0;
};

/** The branch a walk settled on, and every branch it skipped on the way. */
export interface ChosenBranch<TStep> {
  /** The steps that become `awaiting`. Empty when every remaining branch was skipped. */
  readonly running: readonly TStep[];
  /** The steps of branches whose condition did not hold. */
  readonly skipped: readonly TStep[];
}

/** The minimum a step must carry to be walked: which branch it is in, and what gates that branch. */
interface Conditioned {
  readonly ordinal: number;
  readonly condition?: readonly BranchCondition[];
}

/**
 * The next branch that actually runs, walking forward from an ordinal and skipping what does not.
 *
 * `after` is exclusive: pass `0` to choose the opening branch, or the ordinal just decided to choose
 * what follows it. Every branch in between whose condition does not hold is skipped and reported, so
 * the caller can record the history entries and write the rows in one transaction.
 *
 * Returning an **empty** `running` is a real answer rather than an error: every remaining branch was
 * skipped, so there is nobody left to ask and the approval has nothing outstanding. What the caller
 * does with that — complete the instance — is the caller's, because completing is a lifecycle move
 * and this function only chooses a branch.
 */
export const chooseBranch = <TStep extends Conditioned>(
  steps: readonly TStep[],
  after: number,
  context: Readonly<Record<string, unknown>>,
): WorkflowResult<ChosenBranch<TStep>> => {
  const skipped: TStep[] = [];

  for (const ordinal of branchOrdinals(steps).filter((candidate) => candidate > after)) {
    const branch = branchAt(steps, ordinal);
    const [first] = branch;

    if (first === undefined) continue;

    const holds = evaluateAllOf(conditionsOf(first), context);

    // Fail closed. A missing key, an unsupported operand or a type mismatch refuses the operation
    // rather than resolving to "the branch does not run" — which would route an approval past
    // somebody because a requesting module spelled a key differently.
    if (!holds.ok) return refuse(holds.error.reason, holds.error.detail);
    if (holds.value) return accept({ running: branch, skipped });

    skipped.push(...branch);
  }
  return accept({ running: [], skipped });
};
