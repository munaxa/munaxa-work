import type { WorkflowDecisionState } from '../domain/decision.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type { BranchCondition } from '../domain/condition.js';
import type {
  ApprovalDecisionKind,
  ApproverKind,
  BranchRule,
  DecisionAuthority,
  WorkflowHistoryEvent,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
} from '../domain/workflow-vocabulary.js';
import { asNumber, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * The rows an approval produces while it runs: the instance, its steps, the decisions approvers
 * made, and the timeline of how it got where it is.
 *
 * **Nothing here is localized and nothing here is a civil date.** A running approval carries no
 * tenant-authored text — the names live on the version it copied from — and every temporal column is
 * a `timestamptz` the driver hands back as a `Date`, passed through untouched in both directions.
 *
 * **`context` is `jsonb` and is passed through as an object.** It is the requesting module's own
 * payload, stored for audit and read by nothing in Phase 16A.
 *
 * **The last two tables are append-only**, and the shape of this file says so: there is no
 * `decisionUpdateValues` and no `historyUpdateValues` beside the two insert mappers, because a
 * trigger refuses every update and delete and the repositories offer no method that could issue one.
 */

// ------------------------------------------------------------------------------------------------
// Instances and steps
// ------------------------------------------------------------------------------------------------

export interface InstanceRow {
  readonly id: string;
  readonly definition_id: string;
  readonly workflow_version_id: string;
  readonly subject_type: string;
  readonly subject_id: string;
  readonly requested_by_membership_id: string;
  readonly status: string;
  readonly started_at: Date;
  readonly completed_at: Date | null;
  readonly cancelled_by: string | null;
  readonly cancellation_reason: string | null;
  readonly correlation_id: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly version: number;
}

export const instanceColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.definition_id`,
    `${alias}.workflow_version_id`,
    `${alias}.subject_type`,
    `${alias}.subject_id`,
    `${alias}.requested_by_membership_id`,
    `${alias}.status`,
    `${alias}.started_at`,
    `${alias}.completed_at`,
    `${alias}.cancelled_by`,
    `${alias}.cancellation_reason`,
    `${alias}.correlation_id`,
    `${alias}.context`,
    `${alias}.version`,
  ].join(', ');

export const instanceState = (row: InstanceRow): WorkflowInstanceState => ({
  instanceId: row.id,
  definitionId: row.definition_id,
  workflowVersionId: row.workflow_version_id,
  subjectType: row.subject_type,
  subjectId: row.subject_id,
  requestedByMembershipId: row.requested_by_membership_id,
  status: row.status as WorkflowInstanceStatus,
  startedAt: row.started_at,
  correlationId: row.correlation_id,
  context: row.context,
  version: asNumber(row.version),
  ...presentOf({
    completedAt: row.completed_at,
    cancelledBy: row.cancelled_by,
    cancellationReason: row.cancellation_reason,
  }),
});

export const instanceValues = (state: WorkflowInstanceState, tenantId: string): RowValues => ({
  id: state.instanceId,
  tenant_id: tenantId,
  definition_id: state.definitionId,
  workflow_version_id: state.workflowVersionId,
  subject_type: state.subjectType,
  subject_id: state.subjectId,
  requested_by_membership_id: state.requestedByMembershipId,
  status: state.status,
  started_at: state.startedAt,
  completed_at: orNull(state.completedAt),
  cancelled_by: orNull(state.cancelledBy),
  cancellation_reason: orNull(state.cancellationReason),
  correlation_id: state.correlationId,
  context: JSON.stringify(state.context),
});

/**
 * One step of a running approval, and the four columns Phase 16B added.
 *
 * **`approver_membership_id` stays `not null` here**, and that asymmetry with the template is the
 * group snapshot: a template may name a list, a running step never does, because the group was
 * expanded into its members before this row existed.
 *
 * **`source_group_id` is provenance rather than a reference.** It records which list the person came
 * from so "why was I asked?" has an answer; it carries no foreign key, so editing or deleting that
 * list cannot reach an approval already under way.
 *
 * `branch_rule`, `quorum` and `condition` are **copies**, taken from the template at the start, which
 * is what makes a running approval keep the rule it began under when the definition is edited.
 */
export interface StepRow {
  readonly id: string;
  readonly instance_id: string;
  readonly ordinal: number;
  readonly approver_kind: string;
  readonly approver_membership_id: string;
  readonly status: string;
  readonly source_group_id: string | null;
  readonly branch_rule: string | null;
  readonly quorum: number | null;
  readonly condition: unknown;
  readonly version: number;
}

export const stepColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.instance_id`,
    `${alias}.ordinal`,
    `${alias}.approver_kind`,
    `${alias}.approver_membership_id`,
    `${alias}.status`,
    `${alias}.source_group_id`,
    `${alias}.branch_rule`,
    `${alias}.quorum`,
    `${alias}.condition`,
    `${alias}.version`,
  ].join(', ');

export const stepState = (row: StepRow): WorkflowStepState => ({
  stepId: row.id,
  instanceId: row.instance_id,
  ordinal: asNumber(row.ordinal),
  approverKind: row.approver_kind as ApproverKind,
  approverMembershipId: row.approver_membership_id,
  status: row.status as WorkflowStepStatus,
  version: asNumber(row.version),
  ...presentOf({
    sourceGroupId: row.source_group_id,
    branchRule: row.branch_rule as BranchRule | null,
    quorum: row.quorum === null ? null : asNumber(row.quorum),
  }),
  // Separately, because a `jsonb` column arrives parsed rather than as a scalar `presentOf` can pass
  // through — and because an empty array is a real stored value rather than an absent one.
  ...(row.condition === null || row.condition === undefined
    ? {}
    : { condition: row.condition as readonly BranchCondition[] }),
});

export const stepValues = (state: WorkflowStepState, tenantId: string): RowValues => ({
  id: state.stepId,
  tenant_id: tenantId,
  instance_id: state.instanceId,
  ordinal: state.ordinal,
  approver_kind: state.approverKind,
  approver_membership_id: state.approverMembershipId,
  status: state.status,
  source_group_id: orNull(state.sourceGroupId),
  branch_rule: orNull(state.branchRule),
  quorum: orNull(state.quorum),
  condition: state.condition === undefined ? null : JSON.stringify(state.condition),
});

// ------------------------------------------------------------------------------------------------
// The two append-only tables
// ------------------------------------------------------------------------------------------------

export interface DecisionRow {
  readonly id: string;
  readonly instance_id: string;
  readonly step_id: string;
  readonly decision: string;
  readonly decided_by_membership_id: string;
  readonly authority: string;
  readonly on_behalf_of_membership_id: string | null;
  readonly decided_at: Date;
  readonly comment: string | null;
  readonly version: number;
}

export const decisionColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.instance_id`,
    `${alias}.step_id`,
    `${alias}.decision`,
    `${alias}.decided_by_membership_id`,
    `${alias}.authority`,
    `${alias}.on_behalf_of_membership_id`,
    `${alias}.decided_at`,
    `${alias}.comment`,
    `${alias}.version`,
  ].join(', ');

export const decisionState = (row: DecisionRow): WorkflowDecisionState => ({
  decisionId: row.id,
  instanceId: row.instance_id,
  stepId: row.step_id,
  decision: row.decision as ApprovalDecisionKind,
  decidedByMembershipId: row.decided_by_membership_id,
  authority: row.authority as DecisionAuthority,
  decidedAt: row.decided_at,
  version: asNumber(row.version),
  ...presentOf({
    onBehalfOfMembershipId: row.on_behalf_of_membership_id,
    comment: row.comment,
  }),
});

/**
 * A decision, on its way in.
 *
 * There is no `decisionUpdateValues` beside this, and that is the point: the table has a trigger
 * refusing every update and delete, and the repository offers no method that could issue one.
 */
export const decisionValues = (state: WorkflowDecisionState, tenantId: string): RowValues => ({
  id: state.decisionId,
  tenant_id: tenantId,
  instance_id: state.instanceId,
  step_id: state.stepId,
  decision: state.decision,
  decided_by_membership_id: state.decidedByMembershipId,
  authority: state.authority,
  on_behalf_of_membership_id: orNull(state.onBehalfOfMembershipId),
  decided_at: state.decidedAt,
  comment: orNull(state.comment),
});

export interface HistoryRow {
  readonly id: string;
  readonly instance_id: string;
  readonly event: string;
  readonly occurred_at: Date;
  readonly step_id: string | null;
  readonly ordinal: number | null;
  readonly actor_membership_id: string | null;
  readonly on_behalf_of_membership_id: string | null;
  readonly version: number;
}

export const historyColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.instance_id`,
    `${alias}.event`,
    `${alias}.occurred_at`,
    `${alias}.step_id`,
    `${alias}.ordinal`,
    `${alias}.actor_membership_id`,
    `${alias}.on_behalf_of_membership_id`,
    `${alias}.version`,
  ].join(', ');

export const historyState = (row: HistoryRow): WorkflowHistoryState => ({
  historyId: row.id,
  instanceId: row.instance_id,
  event: row.event as WorkflowHistoryEvent,
  occurredAt: row.occurred_at,
  version: asNumber(row.version),
  ...presentOf({
    stepId: row.step_id,
    ordinal: row.ordinal === null ? null : asNumber(row.ordinal),
    actorMembershipId: row.actor_membership_id,
    onBehalfOfMembershipId: row.on_behalf_of_membership_id,
  }),
});

export const historyValues = (state: WorkflowHistoryState, tenantId: string): RowValues => ({
  id: state.historyId,
  tenant_id: tenantId,
  instance_id: state.instanceId,
  event: state.event,
  occurred_at: state.occurredAt,
  step_id: orNull(state.stepId),
  ordinal: orNull(state.ordinal),
  actor_membership_id: orNull(state.actorMembershipId),
  on_behalf_of_membership_id: orNull(state.onBehalfOfMembershipId),
});
