import { ESCALATION_EVENT } from './escalation.js';
import type { WorkflowHistoryEvent } from './workflow-vocabulary.js';
import type { DecidedStep } from './decision.js';
import type { CancelledInstance, StartedInstance, WorkflowStepState } from './instance.js';
import { definedOf } from './defined.js';

/**
 * What happened to an instance, in the order it happened.
 *
 * **This is Workflow's audit of routing, and never a restatement of a business fact.** "The
 * requisition was approved" is Recruitment's sentence, written in Recruitment's own decision table
 * by Recruitment's own command. What belongs here is "step 2 of instance X was approved by
 * membership Y acting for membership Z at this instant" — who was asked, who answered, on whose
 * authority, and when. The distinction is the whole of AD-001, and it is why
 * `WORKFLOW_HISTORY_EVENTS` is a closed list with no business word in it.
 *
 * **Append-only, like the decisions it accompanies.** There is no amend and no delete here either.
 * An entry carries no comment and no rationale: those live on the decision, where the permission to
 * read them is decided, rather than in a timeline a queue screen renders.
 *
 * The entries are **derived from the transitions rather than raised alongside them**, which is what
 * keeps the two from disagreeing. A caller that moves an instance without writing history has to go
 * out of its way to do so, because the functions that move an instance are the functions that
 * produce the entries.
 */

export interface WorkflowHistoryState {
  readonly historyId: string;
  readonly instanceId: string;
  readonly event: WorkflowHistoryEvent;
  readonly occurredAt: Date;
  /** The step the entry is about, when it is about one. Absent for instance-level entries. */
  readonly stepId?: string;
  readonly ordinal?: number;
  /** The membership that acted. Absent when nothing human did — a step merely becoming current. */
  readonly actorMembershipId?: string;
  readonly onBehalfOfMembershipId?: string;
  readonly version: number;
}

interface EntryRequest {
  readonly historyId: string;
  readonly instanceId: string;
  readonly event: WorkflowHistoryEvent;
  readonly occurredAt: Date;
  readonly stepId?: string;
  readonly ordinal?: number;
  readonly actorMembershipId?: string;
  readonly onBehalfOfMembershipId?: string;
}

const entry = (request: EntryRequest): WorkflowHistoryState => ({
  historyId: request.historyId,
  instanceId: request.instanceId,
  event: request.event,
  occurredAt: request.occurredAt,
  version: 1,
  ...definedOf({
    stepId: request.stepId,
    ordinal: request.ordinal,
    actorMembershipId: request.actorMembershipId,
    onBehalfOfMembershipId: request.onBehalfOfMembershipId,
  }),
});

/**
 * The entries a start produces: the instance beginning, and everybody it asked.
 *
 * Separate entries because "this was raised" and "you were asked" are different moments to the
 * different people they concern, even when they share an instant.
 *
 * **One `step-awaiting` per opening step**, so a branch of four records that four people were asked.
 * A single entry would leave three of them with a queue item the timeline never explains.
 *
 * **A branch a condition skipped is recorded too.** Somebody reading the timeline later needs to see
 * that a stage existed and was not run — an approval that silently omitted it would look like a
 * process that never had that stage. And when *every* branch was skipped there is nothing to decide,
 * so the instance completes at the instant it started and says so.
 */
export const startHistory = (
  started: StartedInstance,
  historyIds: readonly string[],
): readonly WorkflowHistoryState[] => {
  const instanceId = started.instance.instanceId;
  const at = started.instance.startedAt;
  const ordered = [...started.steps].sort(
    (left, right) => left.ordinal - right.ordinal || left.stepId.localeCompare(right.stepId),
  );
  const events: EntryRequest[] = [
    {
      historyId: '',
      instanceId,
      event: 'instance-started',
      occurredAt: at,
      actorMembershipId: started.instance.requestedByMembershipId,
    },
  ];

  for (const step of ordered.filter((candidate) => candidate.status === 'awaiting')) {
    events.push({
      historyId: '',
      instanceId,
      event: 'step-awaiting',
      occurredAt: at,
      stepId: step.stepId,
      ordinal: step.ordinal,
    });
  }
  for (const step of ordered.filter((candidate) => candidate.status === 'skipped')) {
    events.push({
      historyId: '',
      instanceId,
      event: 'step-skipped',
      occurredAt: at,
      stepId: step.stepId,
      ordinal: step.ordinal,
    });
  }
  if (started.instance.status === 'completed') {
    events.push({
      historyId: '',
      instanceId,
      event: 'instance-completed',
      occurredAt: at,
      actorMembershipId: started.instance.requestedByMembershipId,
    });
  }
  return withIdentifiers(events, historyIds);
};

/**
 * The entries a decision produces: the step's outcome, then whatever followed from it.
 *
 * A rejection produces an entry per skipped step as well as the instance's own, because "this step
 * was abandoned" is what explains a step that was never decided to somebody reading the timeline
 * afterwards. Identifiers are supplied by the caller rather than generated here, for the reason
 * every aggregate in this repository takes them: a pure function that minted its own would be
 * untestable without freezing a clock.
 */
export const decisionHistory = (
  decided: DecidedStep,
  historyIds: readonly string[],
): readonly WorkflowHistoryState[] => {
  const at = decided.decision.decidedAt;
  const instanceId = decided.instance.instanceId;
  const events: EntryRequest[] = [
    {
      historyId: '',
      instanceId,
      event: decided.decision.decision === 'approved' ? 'step-approved' : 'step-rejected',
      occurredAt: at,
      stepId: decided.step.stepId,
      ordinal: decided.step.ordinal,
      actorMembershipId: decided.decision.decidedByMembershipId,
      ...definedOf({ onBehalfOfMembershipId: decided.decision.onBehalfOfMembershipId }),
    },
  ];

  // One entry per step of the branch that opens, because each is a person newly asked. A branch of
  // four produces four `step-awaiting` entries, and a queue that showed one of them would be telling
  // three people they had not been asked.
  for (const following of decided.next) {
    events.push({
      historyId: '',
      instanceId,
      event: 'step-awaiting',
      occurredAt: at,
      stepId: following.stepId,
      ordinal: following.ordinal,
    });
  }
  for (const skipped of decided.skipped) {
    events.push({
      historyId: '',
      instanceId,
      event: 'step-skipped',
      occurredAt: at,
      stepId: skipped.stepId,
      ordinal: skipped.ordinal,
    });
  }
  if (decided.instance.status !== 'running') {
    events.push({
      historyId: '',
      instanceId,
      event: decided.instance.status === 'completed' ? 'instance-completed' : 'instance-rejected',
      occurredAt: at,
      actorMembershipId: decided.decision.decidedByMembershipId,
    });
  }
  return withIdentifiers(events, historyIds);
};

/**
 * The entries a cancellation produces: every abandoned step, then the instance itself.
 *
 * **The acting membership is passed in rather than read from `cancelledBy`.** Those are two
 * different identities and the schema types them differently: `cancelled_by` is the audit actor —
 * `user:<workforceUserId>`, a `varchar` — while `actor_membership_id` is a membership, a `uuid`.
 * Reading one into the other produced a row PostgreSQL refused outright, which is the defect this
 * signature exists to make unrepresentable.
 *
 * It is optional because a context that resolved no membership is a real case — a reconciliation
 * command, a migration — and an entry with no actor is honest there. The column is nullable for
 * exactly that reason.
 */
export const cancellationHistory = (
  cancelled: CancelledInstance,
  at: Date,
  historyIds: readonly string[],
  actorMembershipId?: string,
): readonly WorkflowHistoryState[] => {
  const instanceId = cancelled.instance.instanceId;
  const events: EntryRequest[] = cancelled.skipped.map((step) => ({
    historyId: '',
    instanceId,
    event: 'step-skipped',
    occurredAt: at,
    stepId: step.stepId,
    ordinal: step.ordinal,
  }));

  events.push({
    historyId: '',
    instanceId,
    event: 'instance-cancelled',
    occurredAt: at,
    ...definedOf({ actorMembershipId }),
  });
  return withIdentifiers(events, historyIds);
};

/**
 * Pairs each entry with the identifier the caller supplied, and drops any it did not.
 *
 * Dropping rather than inventing: a caller that supplied too few identifiers has a defect, and a
 * generated identifier would hide it behind a history entry nothing else references. The count is
 * asserted in the suites.
 */
const withIdentifiers = (
  events: readonly EntryRequest[],
  historyIds: readonly string[],
): readonly WorkflowHistoryState[] =>
  events
    .map((event, index) => ({ event, historyId: historyIds[index] }))
    .filter(
      (pair): pair is { event: EntryRequest; historyId: string } => pair.historyId !== undefined,
    )
    .map((pair) => entry({ ...pair.event, historyId: pair.historyId }));

/**
 * The single entry an escalation writes: somebody was **added** to a branch.
 *
 * Two `step-awaiting` entries would be closer to what happens — a step opened, and it is awaiting —
 * and would be wrong: a reader could not tell the added approver from the ones the approval started
 * with, which is the distinction the whole phase exists to keep. One entry, under its own event.
 *
 * **The actor is required here, unlike a cancellation's.** An escalation is somebody's decision to
 * widen an approval other people are already answering, and an entry that could not say whose
 * decision it was would be the one row in this timeline that records a change of approver with
 * nobody attached to it. There is no reconciliation or migration path that writes one.
 *
 * The step is named so the timeline points at the approver who was added, and the ordinal so it
 * points at the branch they were added to.
 */
export const escalationHistory = (
  step: WorkflowStepState,
  at: Date,
  historyId: string,
  actorMembershipId: string,
): WorkflowHistoryState =>
  entry({
    historyId,
    instanceId: step.instanceId,
    event: ESCALATION_EVENT,
    occurredAt: at,
    stepId: step.stepId,
    ordinal: step.ordinal,
    actorMembershipId,
  });
