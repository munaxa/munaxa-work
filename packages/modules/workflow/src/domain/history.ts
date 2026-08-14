import type { WorkflowHistoryEvent } from './workflow-vocabulary.js';
import type { DecidedStep } from './decision.js';
import type { CancelledInstance, StartedInstance } from './instance.js';
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
 * The entries a start produces: the instance beginning, and its first step becoming current.
 *
 * Two entries rather than one, because "this was raised" and "you were asked" are different moments
 * to the two different people they concern, even when they share an instant.
 */
export const startHistory = (
  started: StartedInstance,
  historyIds: readonly string[],
): readonly WorkflowHistoryState[] => {
  const [instanceEntryId, stepEntryId] = historyIds;
  const first = [...started.steps].sort((left, right) => left.ordinal - right.ordinal)[0];

  if (instanceEntryId === undefined || stepEntryId === undefined || first === undefined) return [];

  return [
    entry({
      historyId: instanceEntryId,
      instanceId: started.instance.instanceId,
      event: 'instance-started',
      occurredAt: started.instance.startedAt,
      actorMembershipId: started.instance.requestedByMembershipId,
    }),
    entry({
      historyId: stepEntryId,
      instanceId: started.instance.instanceId,
      event: 'step-awaiting',
      occurredAt: started.instance.startedAt,
      stepId: first.stepId,
      ordinal: first.ordinal,
    }),
  ];
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

  if (decided.next !== undefined) {
    events.push({
      historyId: '',
      instanceId,
      event: 'step-awaiting',
      occurredAt: at,
      stepId: decided.next.stepId,
      ordinal: decided.next.ordinal,
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

/** The entries a cancellation produces: every abandoned step, then the instance itself. */
export const cancellationHistory = (
  cancelled: CancelledInstance,
  at: Date,
  historyIds: readonly string[],
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
    ...definedOf({ actorMembershipId: cancelled.instance.cancelledBy }),
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
