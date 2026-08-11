import type { BilingualText, Metadata } from '../domain/onboarding-aggregate.js';
import type { OnboardingInstanceState } from '../domain/onboarding-state.js';
import type { TaskState } from '../domain/task-definition.js';
import type { TaskEventState } from '../domain/task-event.js';
import type {
  OnboardingState,
  OwnerKind,
  TaskEventKind,
  TaskKind,
  TaskStatus,
} from '../domain/onboarding-vocabulary.js';

import { asVersion, civilDateColumn, type RowValues } from './row-writer.js';

/**
 * Instances, tasks and task history: the rows, and the functions that convert them to domain state
 * and back.
 *
 * Apart from the repositories for the reason the plan mappings are — a repository's complexity
 * budget is five and these mappings have a dozen optional columns each — and apart from
 * `plan-rows.ts` so neither file exceeds its size budget.
 *
 * **`employment_id` and `person_id` are absent from the instance's update set**, and that absence is
 * the strongest statement this module makes. An onboarding is *for* one employment and one human
 * being; a column that could be repointed would move somebody's induction record to another person,
 * silently, and no amount of application-level care makes that safe. They are written once, at
 * insert, and the foreign keys mean they must already exist (ADR-0047).
 *
 * **`template_code` is absent from the task's update set** for the same reason at a smaller scale:
 * it is the link back to the plan version an auditor will read, and the unique index that stops a
 * plan being applied twice is built on it.
 */

export interface OnboardingInstanceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly employment_id: string;
  readonly person_id: string;
  readonly application_id: string | null;
  readonly plan_id: string | null;
  readonly plan_version_id: string | null;
  readonly state: string;
  readonly planned_start_on: string;
  readonly employment_start_on: string | null;
  readonly completed_on: string | null;
  readonly completed_at: Date | null;
  readonly completed_by: string | null;
  readonly cancelled_at: Date | null;
  readonly cancelled_by: string | null;
  readonly cancellation_reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const INSTANCE_COLUMNS = `o.id, o.tenant_id, o.employment_id, o.person_id, o.application_id, o.plan_id,
  o.plan_version_id, o.state, ${civilDateColumn('o.planned_start_on', 'planned_start_on')},
  ${civilDateColumn('o.employment_start_on', 'employment_start_on')},
  ${civilDateColumn('o.completed_on', 'completed_on')}, o.completed_at, o.completed_by,
  o.cancelled_at, o.cancelled_by, o.cancellation_reason_code, o.metadata, o.version`;

const conclusionOf = (
  row: OnboardingInstanceRow,
): Partial<
  Pick<
    OnboardingInstanceState,
    | 'completedOn'
    | 'completedAt'
    | 'completedBy'
    | 'cancelledAt'
    | 'cancelledBy'
    | 'cancellationReasonCode'
  >
> => ({
  ...(row.completed_on === null ? {} : { completedOn: row.completed_on }),
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  ...(row.completed_by === null ? {} : { completedBy: row.completed_by }),
  ...(row.cancelled_at === null ? {} : { cancelledAt: row.cancelled_at }),
  ...(row.cancelled_by === null ? {} : { cancelledBy: row.cancelled_by }),
  ...(row.cancellation_reason_code === null
    ? {}
    : { cancellationReasonCode: row.cancellation_reason_code }),
});

export const toInstance = (row: OnboardingInstanceRow): OnboardingInstanceState => ({
  id: row.id,
  tenantId: row.tenant_id,
  employmentId: row.employment_id,
  personId: row.person_id,
  ...(row.application_id === null ? {} : { applicationId: row.application_id }),
  ...(row.plan_id === null ? {} : { planId: row.plan_id }),
  ...(row.plan_version_id === null ? {} : { planVersionId: row.plan_version_id }),
  state: row.state as OnboardingState,
  plannedStartOn: row.planned_start_on,
  ...(row.employment_start_on === null ? {} : { employmentStartOn: row.employment_start_on }),
  ...conclusionOf(row),
  metadata: row.metadata,
  version: asVersion(row.version),
});

const mutableInstance = (state: OnboardingInstanceState): RowValues => ({
  plan_id: state.planId ?? null,
  plan_version_id: state.planVersionId ?? null,
  state: state.state,
  planned_start_on: state.plannedStartOn,
  employment_start_on: state.employmentStartOn ?? null,
  completed_on: state.completedOn ?? null,
  completed_at: state.completedAt ?? null,
  completed_by: state.completedBy ?? null,
  cancelled_at: state.cancelledAt ?? null,
  cancelled_by: state.cancelledBy ?? null,
  cancellation_reason_code: state.cancellationReasonCode ?? null,
  metadata: JSON.stringify(state.metadata),
});

export const instanceInsert = (state: OnboardingInstanceState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  employment_id: state.employmentId,
  person_id: state.personId,
  application_id: state.applicationId ?? null,
  ...mutableInstance(state),
});

export const instanceUpdate = (state: OnboardingInstanceState): RowValues => mutableInstance(state);

export interface TaskRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly onboarding_id: string;
  readonly template_code: string | null;
  readonly sequence: number | string;
  readonly title: BilingualText;
  readonly description: BilingualText | null;
  readonly kind: string;
  readonly owner_kind: string;
  readonly owner_ref: string | null;
  readonly owner_role: string | null;
  readonly required: boolean;
  readonly status: string;
  readonly due_on: string | null;
  readonly depends_on_task_id: string | null;
  readonly document_reference: string | null;
  readonly document_type_code: string | null;
  readonly approval_reference: string | null;
  readonly completed_at: Date | null;
  readonly completed_by: string | null;
  readonly completion_note: string | null;
  readonly waiver_reason_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const TASK_COLUMNS = `k.id, k.tenant_id, k.onboarding_id, k.template_code, k.sequence, k.title, k.description,
  k.kind, k.owner_kind, k.owner_ref, k.owner_role, k.required, k.status,
  ${civilDateColumn('k.due_on', 'due_on')}, k.depends_on_task_id, k.document_reference,
  k.document_type_code, k.approval_reference, k.completed_at, k.completed_by, k.completion_note,
  k.waiver_reason_code, k.metadata, k.version`;

/** What a task records about how it ended. Split out so `toTask` stays inside its budget. */
const completionOf = (
  row: TaskRow,
): Partial<
  Pick<
    TaskState,
    'completedAt' | 'completedBy' | 'completionNote' | 'waiverReasonCode' | 'documentReference'
  >
> => ({
  ...(row.completed_at === null ? {} : { completedAt: row.completed_at }),
  ...(row.completed_by === null ? {} : { completedBy: row.completed_by }),
  ...(row.completion_note === null ? {} : { completionNote: row.completion_note }),
  ...(row.waiver_reason_code === null ? {} : { waiverReasonCode: row.waiver_reason_code }),
  ...(row.document_reference === null ? {} : { documentReference: row.document_reference }),
});

const ownerOf = (
  row: TaskRow,
): Pick<TaskState, 'ownerKind'> & Partial<Pick<TaskState, 'ownerRef' | 'ownerRole'>> => ({
  ownerKind: row.owner_kind as OwnerKind,
  ...(row.owner_ref === null ? {} : { ownerRef: row.owner_ref }),
  ...(row.owner_role === null ? {} : { ownerRole: row.owner_role }),
});

/** Everything else a task optionally carries: what it came from, when, and what it waits for. */
const descriptorOf = (
  row: TaskRow,
): Partial<
  Pick<
    TaskState,
    | 'templateCode'
    | 'description'
    | 'dueOn'
    | 'dependsOnTaskId'
    | 'documentTypeCode'
    | 'approvalReference'
  >
> => ({
  ...(row.template_code === null ? {} : { templateCode: row.template_code }),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.due_on === null ? {} : { dueOn: row.due_on }),
  ...(row.depends_on_task_id === null ? {} : { dependsOnTaskId: row.depends_on_task_id }),
  ...(row.document_type_code === null ? {} : { documentTypeCode: row.document_type_code }),
  ...(row.approval_reference === null ? {} : { approvalReference: row.approval_reference }),
});

export const toTask = (row: TaskRow): TaskState => ({
  id: row.id,
  tenantId: row.tenant_id,
  onboardingId: row.onboarding_id,
  sequence: Number(row.sequence),
  title: row.title,
  kind: row.kind as TaskKind,
  required: row.required,
  status: row.status as TaskStatus,
  ...descriptorOf(row),
  ...ownerOf(row),
  ...completionOf(row),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** How the task ended, as columns. Split out so neither half exceeds the complexity budget. */
const taskConclusionColumns = (state: TaskState): RowValues => ({
  document_reference: state.documentReference ?? null,
  approval_reference: state.approvalReference ?? null,
  completed_at: state.completedAt ?? null,
  completed_by: state.completedBy ?? null,
  completion_note: state.completionNote ?? null,
  waiver_reason_code: state.waiverReasonCode ?? null,
});

const mutableTask = (state: TaskState): RowValues => ({
  sequence: state.sequence,
  title: JSON.stringify(state.title),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  kind: state.kind,
  owner_kind: state.ownerKind,
  owner_ref: state.ownerRef ?? null,
  owner_role: state.ownerRole ?? null,
  required: state.required,
  status: state.status,
  due_on: state.dueOn ?? null,
  depends_on_task_id: state.dependsOnTaskId ?? null,
  document_type_code: state.documentTypeCode ?? null,
  ...taskConclusionColumns(state),
  metadata: JSON.stringify(state.metadata),
});

export const taskInsert = (state: TaskState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  onboarding_id: state.onboardingId,
  template_code: state.templateCode ?? null,
  ...mutableTask(state),
});

export const taskUpdate = (state: TaskState): RowValues => mutableTask(state);

export interface TaskEventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly task_id: string;
  readonly onboarding_id: string;
  readonly kind: string;
  readonly from_status: string | null;
  readonly to_status: string | null;
  readonly detail: string | null;
  readonly occurred_at: Date;
  readonly recorded_by: string;
  readonly version: number | string;
}

export const TASK_EVENT_COLUMNS =
  'e.id, e.tenant_id, e.task_id, e.onboarding_id, e.kind, e.from_status, e.to_status, e.detail, e.occurred_at, e.recorded_by, e.version';

export const toTaskEvent = (row: TaskEventRow): TaskEventState => ({
  id: row.id,
  tenantId: row.tenant_id,
  taskId: row.task_id,
  onboardingId: row.onboarding_id,
  kind: row.kind as TaskEventKind,
  ...(row.from_status === null ? {} : { fromStatus: row.from_status as TaskStatus }),
  ...(row.to_status === null ? {} : { toStatus: row.to_status as TaskStatus }),
  ...(row.detail === null ? {} : { detail: row.detail }),
  occurredAt: row.occurred_at,
  recordedBy: row.recorded_by,
  version: asVersion(row.version),
});

/** History is appended and never amended, so there is no update mapping to write. */
export const taskEventInsert = (state: TaskEventState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  task_id: state.taskId,
  onboarding_id: state.onboardingId,
  kind: state.kind,
  from_status: state.fromStatus ?? null,
  to_status: state.toStatus ?? null,
  detail: state.detail ?? null,
  occurred_at: state.occurredAt,
  recorded_by: state.recordedBy,
});
