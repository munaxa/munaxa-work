import type { BilingualText, Metadata } from '../domain/onboarding-aggregate.js';
import type { PlanState } from '../domain/plan.js';
import type { PlanVersionState, TaskTemplateState } from '../domain/plan-version.js';
import type {
  DueAnchor,
  OwnerKind,
  PlanStatus,
  PlanVersionStatus,
  TaskKind,
} from '../domain/onboarding-vocabulary.js';

import { asVersion, type RowValues } from './row-writer.js';

/**
 * Plans, their versions and the templates a version holds: the rows, and the functions that convert
 * them to domain state and back.
 *
 * Apart from the repositories because a repository is held to a tighter complexity budget than the
 * rest of the codebase — five rather than ten — and a mapping with a dozen optional columns exceeds
 * it by construction. The budget exists so that a repository which *needs* branching gets looked at,
 * and the honest answer here is that this is mapping rather than logic: no rule in this file decides
 * anything.
 *
 * Three columns are deliberately absent from every update set. `plan_id` and `version_number` on a
 * version, and `plan_version_id` on a template: a version repointed at another plan, or renumbered,
 * would move the checklist a hundred people were measured against — and the whole immutability
 * argument (ADR-0048) rests on that being impossible rather than merely refused.
 */

export interface PlanRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualText;
  readonly description: BilingualText | null;
  readonly status: string;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const PLAN_COLUMNS = 'p.id, p.tenant_id, p.code, p.name, p.description, p.status, p.metadata, p.version';

export const toPlan = (row: PlanRow): PlanState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  ...(row.description === null ? {} : { description: row.description }),
  status: row.status as PlanStatus,
  metadata: row.metadata,
  version: asVersion(row.version),
});

/** `code` is not here: a plan's code is its stable identity in an export a customer keeps. */
const mutablePlan = (state: PlanState): RowValues => ({
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  status: state.status,
  metadata: JSON.stringify(state.metadata),
});

export const planInsert = (state: PlanState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  code: state.code,
  ...mutablePlan(state),
});

export const planUpdate = (state: PlanState): RowValues => mutablePlan(state);

export interface PlanVersionRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly plan_id: string;
  readonly version_number: number | string;
  readonly status: string;
  readonly published_at: Date | null;
  readonly published_by: string | null;
  readonly version: number | string;
}

export const PLAN_VERSION_COLUMNS =
  'v.id, v.tenant_id, v.plan_id, v.version_number, v.status, v.published_at, v.published_by, v.version';

export const toPlanVersion = (row: PlanVersionRow): PlanVersionState => ({
  id: row.id,
  tenantId: row.tenant_id,
  planId: row.plan_id,
  versionNumber: Number(row.version_number),
  status: row.status as PlanVersionStatus,
  ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
  ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
  version: asVersion(row.version),
});

const mutablePlanVersion = (state: PlanVersionState): RowValues => ({
  status: state.status,
  published_at: state.publishedAt ?? null,
  published_by: state.publishedBy ?? null,
});

export const planVersionInsert = (state: PlanVersionState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  plan_id: state.planId,
  version_number: state.versionNumber,
  ...mutablePlanVersion(state),
});

export const planVersionUpdate = (state: PlanVersionState): RowValues => mutablePlanVersion(state);

export interface TaskTemplateRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly plan_version_id: string;
  readonly code: string;
  readonly sequence: number | string;
  readonly title: BilingualText;
  readonly description: BilingualText | null;
  readonly kind: string;
  readonly owner_kind: string;
  readonly owner_ref: string | null;
  readonly owner_role: string | null;
  readonly required: boolean;
  readonly due_anchor: string;
  readonly due_offset_days: number | string;
  readonly depends_on_template_code: string | null;
  readonly document_type_code: string | null;
  readonly metadata: Metadata;
  readonly version: number | string;
}

export const TASK_TEMPLATE_COLUMNS = `t.id, t.tenant_id, t.plan_version_id, t.code, t.sequence, t.title, t.description,
  t.kind, t.owner_kind, t.owner_ref, t.owner_role, t.required, t.due_anchor, t.due_offset_days,
  t.depends_on_template_code, t.document_type_code, t.metadata, t.version`;

export const toTaskTemplate = (row: TaskTemplateRow): TaskTemplateState => ({
  id: row.id,
  tenantId: row.tenant_id,
  planVersionId: row.plan_version_id,
  code: row.code,
  sequence: Number(row.sequence),
  title: row.title,
  ...(row.description === null ? {} : { description: row.description }),
  kind: row.kind as TaskKind,
  ownerKind: row.owner_kind as OwnerKind,
  ...(row.owner_ref === null ? {} : { ownerRef: row.owner_ref }),
  ...(row.owner_role === null ? {} : { ownerRole: row.owner_role }),
  required: row.required,
  dueAnchor: row.due_anchor as DueAnchor,
  dueOffsetDays: Number(row.due_offset_days),
  ...(row.depends_on_template_code === null
    ? {}
    : { dependsOnTemplateCode: row.depends_on_template_code }),
  ...(row.document_type_code === null ? {} : { documentTypeCode: row.document_type_code }),
  metadata: row.metadata,
  version: asVersion(row.version),
});

/**
 * A template has an insert and no update.
 *
 * Not an oversight: a template is only ever changed on a *draft* version, and the application
 * replaces a draft's templates wholesale rather than editing one in place. Once the version is
 * published there is nothing to write — which is the mechanism, not a policy a caller could forget
 * to apply (ADR-0048).
 */
export const taskTemplateInsert = (state: TaskTemplateState): RowValues => ({
  id: state.id,
  tenant_id: state.tenantId,
  plan_version_id: state.planVersionId,
  code: state.code,
  sequence: state.sequence,
  title: JSON.stringify(state.title),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  kind: state.kind,
  owner_kind: state.ownerKind,
  owner_ref: state.ownerRef ?? null,
  owner_role: state.ownerRole ?? null,
  required: state.required,
  due_anchor: state.dueAnchor,
  due_offset_days: state.dueOffsetDays,
  depends_on_template_code: state.dependsOnTemplateCode ?? null,
  document_type_code: state.documentTypeCode ?? null,
  metadata: JSON.stringify(state.metadata),
});
