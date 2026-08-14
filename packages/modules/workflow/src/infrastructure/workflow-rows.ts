import type { WorkflowDecisionState } from '../domain/decision.js';
import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type { WorkflowHistoryState } from '../domain/history.js';
import type { WorkflowInstanceState, WorkflowStepState } from '../domain/instance.js';
import type {
  ApprovalDecisionKind,
  ApproverKind,
  DecisionAuthority,
  LocalizedName,
  WorkflowDefinitionStatus,
  WorkflowHistoryEvent,
  WorkflowInstanceStatus,
  WorkflowStepStatus,
  WorkflowVersionStatus,
} from '../domain/workflow-vocabulary.js';
import { asNumber, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Every Workflow row, and the mapping in both directions.
 *
 * **No `Date` is constructed or reinterpreted here.** Every temporal column in this module is a
 * `timestamptz`, which the driver hands back as a `Date` holding an absolute instant; the mapper
 * passes it through untouched in both directions. There is no `to_char`, no local-midnight parse and
 * no timezone arithmetic on this path, because there is no civil date in this module to lose a day
 * from — a request, a decision and a step becoming current are moments. The application's views turn
 * an instant into an ISO string at the boundary, which is the one place that conversion happens.
 *
 * **Every number is integral and `asNumber` is applied only to columns PostgreSQL already
 * guarantees.** A version number, a step ordinal and the optimistic `version` column. The ordinals
 * are `integer` rather than `smallint` deliberately (AD-004), so an ordinal far past 32,767
 * round-trips exactly — asserted in the exactness suite rather than assumed.
 *
 * **`context` and `metadata` are `jsonb` and are passed through as objects.** Neither is read by
 * anything in Phase 16A; `context` is the requesting module's own payload, kept for audit.
 */

const localized = (value: unknown): LocalizedName => value as LocalizedName;

// ------------------------------------------------------------------------------------------------
// Definitions
// ------------------------------------------------------------------------------------------------

export interface DefinitionRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: string | null;
  readonly subject_type: string;
  readonly status: string;
  readonly retired_at: Date | null;
  readonly retired_by: string | null;
  readonly version: number;
}

export const definitionColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.code`,
    `${alias}.name`,
    `${alias}.description`,
    `${alias}.subject_type`,
    `${alias}.status`,
    `${alias}.retired_at`,
    `${alias}.retired_by`,
    `${alias}.version`,
  ].join(', ');

export const definitionState = (row: DefinitionRow): WorkflowDefinitionState => ({
  definitionId: row.id,
  code: row.code,
  name: localized(row.name),
  subjectType: row.subject_type,
  status: row.status as WorkflowDefinitionStatus,
  version: asNumber(row.version),
  ...presentOf({
    description: row.description,
    retiredAt: row.retired_at,
    retiredBy: row.retired_by,
  }),
});

export const definitionValues = (state: WorkflowDefinitionState, tenantId: string): RowValues => ({
  id: state.definitionId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: orNull(state.description),
  subject_type: state.subjectType,
  status: state.status,
  retired_at: orNull(state.retiredAt),
  retired_by: orNull(state.retiredBy),
});

// ------------------------------------------------------------------------------------------------
// Versions and their step templates
// ------------------------------------------------------------------------------------------------

export interface VersionRow {
  readonly id: string;
  readonly definition_id: string;
  readonly version_number: number;
  readonly status: string;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly version: number;
}

export const versionColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.definition_id`,
    `${alias}.version_number`,
    `${alias}.status`,
    `${alias}.published_at`,
    `${alias}.published_by`,
    `${alias}.version`,
  ].join(', ');

export const versionState = (row: VersionRow): WorkflowVersionState => ({
  workflowVersionId: row.id,
  definitionId: row.definition_id,
  versionNumber: asNumber(row.version_number),
  status: row.status as WorkflowVersionStatus,
  version: asNumber(row.version),
  ...presentOf({ publishedAt: row.published_at, publishedBy: row.published_by }),
});

export const versionValues = (state: WorkflowVersionState, tenantId: string): RowValues => ({
  id: state.workflowVersionId,
  tenant_id: tenantId,
  definition_id: state.definitionId,
  version_number: state.versionNumber,
  status: state.status,
  published_at: orNull(state.publishedAt),
  published_by: orNull(state.publishedBy),
});

export interface TemplateRow {
  readonly id: string;
  readonly workflow_version_id: string;
  readonly ordinal: number;
  readonly name: unknown;
  readonly approver_kind: string;
  readonly approver_membership_id: string;
  readonly version: number;
}

export const TEMPLATE_COLUMNS =
  'id, workflow_version_id, ordinal, name, approver_kind, approver_membership_id, version';

export const templateState = (row: TemplateRow): WorkflowStepTemplateState => ({
  stepTemplateId: row.id,
  workflowVersionId: row.workflow_version_id,
  ordinal: asNumber(row.ordinal),
  name: localized(row.name),
  approverKind: row.approver_kind as ApproverKind,
  approverMembershipId: row.approver_membership_id,
  version: asNumber(row.version),
});

export const templateValues = (state: WorkflowStepTemplateState, tenantId: string): RowValues => ({
  id: state.stepTemplateId,
  tenant_id: tenantId,
  workflow_version_id: state.workflowVersionId,
  ordinal: state.ordinal,
  name: JSON.stringify(state.name),
  approver_kind: state.approverKind,
  approver_membership_id: state.approverMembershipId,
});

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

export interface StepRow {
  readonly id: string;
  readonly instance_id: string;
  readonly ordinal: number;
  readonly approver_kind: string;
  readonly approver_membership_id: string;
  readonly status: string;
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
});

export const stepValues = (state: WorkflowStepState, tenantId: string): RowValues => ({
  id: state.stepId,
  tenant_id: tenantId,
  instance_id: state.instanceId,
  ordinal: state.ordinal,
  approver_kind: state.approverKind,
  approver_membership_id: state.approverMembershipId,
  status: state.status,
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
