import type {
  WorkflowDefinitionState,
  WorkflowStepTemplateState,
  WorkflowVersionState,
} from '../domain/definition.js';
import type {
  ApproverKind,
  LocalizedName,
  WorkflowDefinitionStatus,
  WorkflowVersionStatus,
} from '../domain/workflow-vocabulary.js';
import { asNumber, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * The configuration rows: a definition, its versions, and the step templates along one.
 *
 * **No `Date` is constructed or reinterpreted here.** Every temporal column in this module is a
 * `timestamptz`, which the driver hands back as a `Date` holding an absolute instant; the mapper
 * passes it through untouched in both directions. There is no `to_char`, no local-midnight parse and
 * no timezone arithmetic on this path, because there is no civil date in this module to lose a day
 * from — a request, a decision and a step becoming current are moments.
 *
 * **Two `jsonb` columns hold tenant-authored bilingual text**: a definition's `name` and
 * `description`, and a step template's `name`. Each goes in through `JSON.stringify` and comes back
 * as an object. `description` is `LocalizedName` rather than a plain string, matching the `name`
 * beside it and Career's, Learning's and Onboarding's descriptions — Checkpoint 6 brought the domain
 * to the column, which was `jsonb` from the start.
 *
 * **Every number is integral, and `asNumber` is applied only to columns PostgreSQL already
 * guarantees**: a version number, a step ordinal and the optimistic `version` column. The ordinals
 * are `integer` rather than `smallint` deliberately (AD-004), so an ordinal far past 32,767
 * round-trips exactly — asserted in the exactness suite rather than assumed.
 */

/** A `jsonb` column the tenant authored, as the bilingual value the domain declares. */
export const localized = (value: unknown): LocalizedName => value as LocalizedName;

// ------------------------------------------------------------------------------------------------
// Definitions
// ------------------------------------------------------------------------------------------------

export interface DefinitionRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: unknown;
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
  ...presentOf({ retiredAt: row.retired_at, retiredBy: row.retired_by }),
  // Separately from `presentOf`, because a `jsonb` column arrives as an object rather than as a
  // scalar the helper can pass through: `null` means the tenant wrote none, and anything else is the
  // localized text the domain declares.
  ...(row.description === null || row.description === undefined
    ? {}
    : { description: localized(row.description) }),
});

export const definitionValues = (state: WorkflowDefinitionState, tenantId: string): RowValues => ({
  id: state.definitionId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
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
