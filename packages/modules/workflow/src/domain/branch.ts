import {
  isPositiveWhole,
  type ApprovalDecisionKind,
  type BranchOutcome,
  type BranchRule,
} from './workflow-vocabulary.js';
import { accept, refuse, type WorkflowResult } from './workflow-rejection.js';
import { definedOf } from './defined.js';
import type { BranchCondition } from './condition.js';

/**
 * A branch, and the arithmetic that decides it.
 *
 * A **branch** is the set of steps sharing one ordinal on one instance. In 16A every branch had
 * exactly one step, which is why 16A needed no arithmetic at all: one approver, one decision, done.
 * A branch of several is the whole of Phase 16B's routing core, and everything below is the answer
 * to "when does it end, and how".
 *
 * **Every parameter here was approved rather than chosen**, because each one changes who is
 * approved. They are restated in the code as named constants and comments so that a later reader
 * changing one meets the decision rather than the arithmetic:
 *
 * - The **denominator is the assigned approvers**, snapshotted when the instance started. Never the
 *   respondents. A branch of five where one person answers is not a branch of one.
 * - A **majority is strictly more than half**: `floor(assigned / 2) + 1`. For an even number of
 *   approvers, half is not enough, and **a tie is not an approval**.
 * - A **non-response never shrinks the denominator.** Somebody who does not answer is not excluded;
 *   they are counted as outstanding, and the branch waits.
 * - A **delegated decision is one vote for the delegator.** The delegate is the actor and the
 *   approver is the authority — 16A's model, unchanged — and the pair counts once. It is the step
 *   that votes, not the person, and a step has exactly one decision.
 * - **Every voter has one vote.** There are no weights and no percentages, and no `numeric` column
 *   exists in this module for either to hide in.
 *
 * **Integer arithmetic throughout.** `floor(assigned / 2) + 1` is the only division in the module,
 * and it is floored immediately. Nothing here produces a fraction, a ratio or a rounding decision.
 *
 * **Nothing is stored.** A tally is a function of the decisions that exist. A stored `approvals`
 * counter would be a second source of truth that disagrees with the decision table the moment two
 * approvers commit at once, and the decision table is the one an auditor reads.
 */

/**
 * What a branch needs to be evaluated: its rule, its optional quorum, and its steps.
 *
 * The rule and the quorum are carried on **every step of the branch** — copied from the version
 * exactly as the approver is — rather than held on a branch row of their own. There is no branch
 * entity: a branch is a fact about a set of steps sharing an ordinal, and giving it a row would
 * create a second thing to keep in step with the steps themselves.
 */
export interface BranchConfiguration {
  readonly rule: BranchRule;
  /** A minimum number of **responses** before the rule is evaluated at all. Never a threshold. */
  readonly quorum?: number;
}

/** One vote, in the order it was cast. `first-response` is the only rule that reads the order. */
export interface BranchVote {
  readonly stepId: string;
  readonly decision: ApprovalDecisionKind;
  readonly decidedAt: Date;
}

/**
 * One approver of a branch, and whether they were in the set the instance snapshotted.
 *
 * **The denominator is a set, not a count** (D-16D-02), and this is the minimum a tally needs to tell
 * the set from the additions. `escalatedAt` present means an escalation added this approver after the
 * approval started; absent means the instance snapshotted them, which is every step written before
 * Phase 16D and every step of every branch nobody escalates.
 */
export interface BranchMember {
  readonly stepId: string;
  readonly escalatedAt?: Date;
}

/** The approvers the instance snapshotted — the denominator, and the only thing it is counted from. */
const assignedOf = <TMember extends BranchMember>(
  members: readonly TMember[],
): readonly TMember[] => members.filter((member) => member.escalatedAt === undefined);

export interface BranchTally {
  readonly rule: BranchRule;
  /** The snapshotted approver count. The denominator, and it does not move. */
  readonly assigned: number;
  readonly approvals: number;
  readonly rejections: number;
  readonly responses: number;
  /** Assigned approvers who have not answered. Counted, never excluded. */
  readonly outstanding: number;
  /** Approvals needed for this rule over this denominator. An integer count, never a proportion. */
  readonly threshold: number;
  readonly quorum: number;
  readonly quorumMet: boolean;
  readonly outcome: BranchOutcome;
}

/**
 * Approvals needed, by rule.
 *
 * `first-response` is 1 by construction, and is nonetheless evaluated separately below because the
 * *first* decision decides it whichever way it went — a threshold of one would make a lone rejection
 * look like "not yet approved" rather than the rejection it is.
 */
export const thresholdFor = (rule: BranchRule, assigned: number): number => {
  if (rule === 'unanimous') return assigned;
  if (rule === 'first-response') return 1;
  // Strictly more than half. `floor(4 / 2) + 1 = 3`, so two of four is a tie and a tie is not an
  // approval. The examples this was approved against: 1→1, 2→2, 3→2, 4→3, 5→3.
  return Math.floor(assigned / 2) + 1;
};

/**
 * The branch's standing, given who was asked and who has answered.
 *
 * **Quorum gates the whole evaluation, in both directions.** A quorum is a minimum number of
 * responses that must arrive before the configured rule is consulted, and until it does the branch
 * is `awaiting` however the votes have fallen — including when every response so far is a rejection.
 * That is what "a quorum does not itself approve an item; after quorum is reached, the configured
 * outcome rule is evaluated" means when it is read exactly.
 *
 * A quorum that can no longer be reached leaves the branch `awaiting` and nothing rescues it. There
 * is no timeout and no expiry in 16B: an approval waits until somebody acts on it. That is a real
 * operational state, and a screen showing it is telling the truth.
 */
export const tallyOf = (
  configuration: BranchConfiguration,
  members: readonly BranchMember[],
  votes: readonly BranchVote[],
): BranchTally => {
  const answered = new Set(votes.map((vote) => vote.stepId));
  const assigned = assignedOf(members);
  const approvals = votes.filter((vote) => vote.decision === 'approved').length;
  const rejections = votes.filter((vote) => vote.decision === 'rejected').length;
  const quorum = configuration.quorum ?? 1;
  const responses = approvals + rejections;
  const base = {
    rule: configuration.rule,
    assigned: assigned.length,
    approvals,
    rejections,
    responses,
    // Counted over the snapshotted approvers rather than subtracted from them (D-16D-08). An
    // escalated approver may answer after every assigned one already has, and `assigned - responses`
    // would then publish a **negative** integer in a module whose every number is a whole
    // non-negative one. Counting who has not answered cannot go below zero by construction.
    outstanding: assigned.filter((member) => !answered.has(member.stepId)).length,
    threshold: thresholdFor(configuration.rule, assigned.length),
    quorum,
    quorumMet: responses >= quorum,
  };

  return {
    ...base,
    // Reachability is asked of **everybody who can still answer**, which is not the same set as
    // `outstanding` once a branch has been escalated. See `outcomeOf`.
    outcome: outcomeOf(
      base,
      votes,
      members.filter((member) => !answered.has(member.stepId)).length,
    ),
  };
};

type Standing = Omit<BranchTally, 'outcome'>;

const outcomeOf = (
  standing: Standing,
  votes: readonly BranchVote[],
  unresolved: number,
): BranchOutcome => {
  if (!standing.quorumMet) return 'awaiting';
  if (standing.rule === 'first-response') return firstResponseOutcome(votes);

  // Reached: enough approvals exist. An escalated approval counts here, which is the whole of
  // D-16D-08 option (iii) for `majority` — and cannot arise for `unanimous`, because escalating one
  // is refused before a step is ever created.
  if (standing.approvals >= standing.threshold) return 'approved';
  // Impossible: even if everybody who can still answer approved, the threshold is out of reach. For
  // `unanimous` — where the threshold *is* the denominator — this reduces to "one rejection ends
  // it", which is the approved rule falling out of the arithmetic rather than being special-cased.
  //
  // **`unresolved`, not `outstanding`.** They are the same number on every branch nobody escalated,
  // and they differ afterwards: an escalated approver who has not answered is not one of the
  // snapshotted approvers, so they are not `outstanding` — but their approval is still reachable,
  // and counting only the assigned ones would reject a branch that could still be approved.
  if (standing.approvals + unresolved < standing.threshold) return 'rejected';
  return 'awaiting';
};

/**
 * The first decision, whichever way it went.
 *
 * Ordered by the instant it was made and then by the step identifier, so two decisions committed in
 * the same millisecond still resolve the same way on every read. Without the tie-break, a branch
 * could report `approved` to one reader and `rejected` to another from identical rows — which is the
 * kind of defect that only appears under load and is never reproducible afterwards.
 */
const firstResponseOutcome = (votes: readonly BranchVote[]): BranchOutcome => {
  const [first] = [...votes].sort(
    (left, right) =>
      left.decidedAt.getTime() - right.decidedAt.getTime() ||
      left.stepId.localeCompare(right.stepId),
  );

  if (first === undefined) return 'awaiting';
  return first.decision === 'approved' ? 'approved' : 'rejected';
};

/**
 * The branch helpers, generic over anything carrying an ordinal.
 *
 * A version's templates and an instance's steps are different types describing the same shape, and a
 * branch means the same thing in both. Writing these against `{ ordinal }` rather than against
 * either type is what lets one definition serve both — and, not incidentally, what keeps this file
 * from importing the version or the instance and closing a cycle around the domain.
 */
export interface Ordered {
  readonly ordinal: number;
}

/** The steps of one branch: those sharing an ordinal. */
export const branchAt = <TStep extends Ordered>(
  steps: readonly TStep[],
  ordinal: number,
): readonly TStep[] => steps.filter((step) => step.ordinal === ordinal);

/** The ordinals present, in order, each appearing once. */
export const branchOrdinals = (steps: readonly Ordered[]): readonly number[] =>
  [...new Set(steps.map((step) => step.ordinal))].sort((left, right) => left - right);

/** The next branch's ordinal after this one, or nothing when this was the last. */
export const branchAfter = (steps: readonly Ordered[], ordinal: number): number | undefined =>
  branchOrdinals(steps).find((candidate) => candidate > ordinal);

/** Every branch, in order. */
export const branchesOf = <TStep extends Ordered>(
  steps: readonly TStep[],
): readonly (readonly TStep[])[] =>
  branchOrdinals(steps).map((ordinal) => branchAt(steps, ordinal));

/**
 * A step's branch configuration, with 16A's defaults made explicit.
 *
 * Absent means `unanimous` with a quorum of one, which is exactly what every step written before
 * this phase is: one approver who must approve. Reading the default through one function rather than
 * at each call site is what makes "a 16A step is a branch of one" a fact rather than a coincidence.
 */
export const branchOf = (step: {
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
}): BranchConfiguration => ({
  rule: step.branchRule ?? 'unanimous',
  ...definedOf({ quorum: step.quorum }),
});

/** Every condition a step carries. Absent and empty mean the same: the branch always runs. */
export const conditionsOf = (step: {
  readonly condition?: readonly BranchCondition[];
}): readonly BranchCondition[] => step.condition ?? [];

/**
 * Whether a set of steps forms a usable order: **contiguous branches** from one.
 *
 * The rule 16A enforced was that the ordinals themselves were `1..n`, which was the same thing while
 * every ordinal held one step. With branches it is not: three steps at ordinal 1 and two at ordinal 2
 * is a perfectly ordered process whose ordinal *list* is `1,1,1,2,2`. What must be contiguous is the
 * set of **distinct** ordinals, because that is what "advance to the next branch" walks.
 */
export const ordinalsAreContiguous = (steps: readonly Ordered[]): boolean =>
  branchOrdinals(steps).every((ordinal, index) => ordinal === index + 1);

/** Everything a branch's coherence is judged on. Satisfied by a template and by an instance step. */
export interface BranchShape extends Ordered {
  readonly branchRule?: BranchRule;
  readonly quorum?: number;
  readonly condition?: readonly BranchCondition[];
}

/**
 * Whether every branch of a version is one this module can actually run.
 *
 * Three refusals, and each is a configuration a tenant could plausibly write:
 *
 * - **Steps at one ordinal that disagree about the rule.** A branch where one says `majority` and
 *   another says `unanimous` has no outcome, and picking the first — or the strictest — would be
 *   inventing a resolution rule nobody approved.
 * - **A quorum larger than the branch.** Permanently unreachable, so the branch could never end.
 * - **Steps at one ordinal that disagree about the condition.** A branch runs or it does not; two
 *   conditions on one branch would run half of it.
 *
 * A group's *size* is deliberately not checked here. A group is resolved when an instance starts,
 * and its membership at publication is not its membership then — refusing publication because a list
 * is empty today would be checking the wrong moment. An empty group is refused where it actually
 * matters: when an approval would otherwise start with nobody asked.
 */
export const branchesAreCoherent = <TStep extends BranchShape>(
  steps: readonly TStep[],
): WorkflowResult<readonly TStep[]> => {
  for (const branch of branchesOf(steps)) {
    const [first] = branch;

    if (first === undefined) continue;

    const configuration = branchOf(first);

    if (branch.some((step) => !configurationsAgree(branchOf(step), configuration))) {
      return refuse('branch-rule-inconsistent', { ordinal: String(first.ordinal) });
    }
    if (branch.some((step) => !sameCondition(conditionsOf(step), conditionsOf(first)))) {
      return refuse('branch-condition-inconsistent', { ordinal: String(first.ordinal) });
    }
    // A membership step is one approver; a group is at least one, and how many is not known until
    // an instance starts. Both count as one *here*, which is what makes a quorum larger than the
    // branch's configured step count refusable at publication.
    const usable = branchConfigurationIsUsable(configuration, branch.length);

    if (!usable.ok) return refuse(usable.error.reason, usable.error.detail);
  }
  return accept(steps);
};

/** Two condition lists describing the same branch. Compared by value, in order. */
const sameCondition = (
  left: readonly BranchCondition[],
  right: readonly BranchCondition[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

/**
 * Whether a branch configuration is one a tenant could ever satisfy.
 *
 * Checked when a version is published rather than when a step is added, for the reason
 * `ordinalsAreContiguous` is: a branch is a property of a **set** of steps, and the set is not
 * complete until the version stops being editable.
 *
 * A quorum larger than the branch is refused here rather than left to fail silently at run time. It
 * is not the same thing as a quorum that *becomes* unreachable — that is an ordinary state a branch
 * can sit in — but one that could never have been reached is a configuration mistake, and the moment
 * to say so is while somebody is still editing.
 */
export const branchConfigurationIsUsable = (
  configuration: BranchConfiguration,
  approvers: number,
): WorkflowResult<BranchConfiguration> => {
  if (approvers < 1) return refuse('branch-has-no-approvers');
  if (configuration.quorum !== undefined) {
    if (!isPositiveWhole(configuration.quorum)) return refuse('branch-quorum-invalid');
    if (configuration.quorum > approvers) {
      return refuse('branch-quorum-exceeds-approvers', {
        quorum: String(configuration.quorum),
        approvers: String(approvers),
      });
    }
  }
  return accept(configuration);
};

/** True when two steps of a branch describe the same branch. Coherence, checked at publication. */
export const configurationsAgree = (
  left: BranchConfiguration,
  right: BranchConfiguration,
): boolean => left.rule === right.rule && (left.quorum ?? 1) === (right.quorum ?? 1);
