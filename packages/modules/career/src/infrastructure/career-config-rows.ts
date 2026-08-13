import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { CareerPlanState } from '../domain/plan.js';
import type { PoolMembershipState, TalentPoolState } from '../domain/pool.js';
import type { ReadinessLevelState } from '../domain/readiness.js';
import type { LocalizedName } from '../domain/career-rejection.js';
import type {
  CareerPathKind,
  CareerPathStatus,
  CareerPlanStatus,
  TalentPoolKind,
  TalentPoolStatus,
} from '../domain/career-vocabulary.js';
import { asNumber, civilDateColumn, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Configuration and plan rows, and the mapping in both directions.
 *
 * **Civil dates never become `Date` on this path.** The domain already holds them as `YYYY-MM-DD`
 * strings, so a `to_char` alias on the way out and a plain string on the way in is the whole
 * conversion — there is no timezone anywhere in it, and therefore no day to lose (D-11).
 *
 * **Every number here is a `smallint` the schema bounds**, and `asNumber` is applied only to
 * columns PostgreSQL already guarantees integral. There is no money, no rate, no percentage and
 * nothing a tenant types as a number, so nothing on this path can be rounded.
 *
 * **`archived_at` and `closed_at` are genuine instants** and stay `Date`. They record the moment a
 * row was archived, not a day something is true of — the distinction D-11 draws, kept in both
 * directions.
 */

export const localized = (value: unknown): LocalizedName => value as LocalizedName;

// ------------------------------------------------------------------------------------------------
// Career paths and stages
// ------------------------------------------------------------------------------------------------

export interface PathRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: unknown;
  readonly kind: string;
  readonly status: string;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly archived_at: Date | null;
  readonly archived_by: string | null;
  readonly version: number;
}

export const pathColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.code`,
    `${alias}.name`,
    `${alias}.description`,
    `${alias}.kind`,
    `${alias}.status`,
    civilDateColumn(`${alias}.effective_from`, 'effective_from'),
    civilDateColumn(`${alias}.effective_to`, 'effective_to'),
    `${alias}.archived_at`,
    `${alias}.archived_by`,
    `${alias}.version`,
  ].join(', ');

export const pathState = (row: PathRow): CareerPathState => ({
  pathId: row.id,
  code: row.code,
  name: localized(row.name),
  kind: row.kind as CareerPathKind,
  status: row.status as CareerPathStatus,
  effectiveFrom: row.effective_from,
  version: asNumber(row.version),
  ...presentOf({
    description: row.description === null ? undefined : localized(row.description),
    effectiveTo: row.effective_to,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  }),
});

export const pathValues = (state: CareerPathState, tenantId: string): RowValues => ({
  id: state.pathId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  kind: state.kind,
  status: state.status,
  effective_from: state.effectiveFrom,
  effective_to: orNull(state.effectiveTo),
  archived_at: orNull(state.archivedAt),
  archived_by: orNull(state.archivedBy),
  metadata: '{}',
});

export interface StageRow {
  readonly id: string;
  readonly path_id: string;
  readonly sequence: number;
  readonly name: unknown;
  readonly target_position_id: string | null;
}

export const STAGE_COLUMNS = 'id, path_id, sequence, name, target_position_id';

export const stageState = (row: StageRow): CareerStageState => ({
  stageId: row.id,
  pathId: row.path_id,
  sequence: asNumber(row.sequence),
  name: localized(row.name),
  ...presentOf({ targetPositionId: row.target_position_id }),
});

export const stageValues = (state: CareerStageState, tenantId: string): RowValues => ({
  id: state.stageId,
  tenant_id: tenantId,
  path_id: state.pathId,
  sequence: state.sequence,
  name: JSON.stringify(state.name),
  target_position_id: orNull(state.targetPositionId),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Career plans
// ------------------------------------------------------------------------------------------------

export interface PlanRow {
  readonly id: string;
  readonly employment_id: string;
  readonly path_id: string | null;
  readonly current_stage_id: string | null;
  readonly target_stage_id: string | null;
  readonly status: string;
  readonly started_on: string;
  readonly target_date: string | null;
  readonly notes: string | null;
  readonly closed_on: string | null;
  readonly closed_by: string | null;
  readonly version: number;
}

export const planColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.employment_id`,
    `${alias}.path_id`,
    `${alias}.current_stage_id`,
    `${alias}.target_stage_id`,
    `${alias}.status`,
    civilDateColumn(`${alias}.started_on`, 'started_on'),
    civilDateColumn(`${alias}.target_date`, 'target_date'),
    `${alias}.notes`,
    civilDateColumn(`${alias}.closed_on`, 'closed_on'),
    `${alias}.closed_by`,
    `${alias}.version`,
  ].join(', ');

export const planState = (row: PlanRow): CareerPlanState => ({
  careerPlanId: row.id,
  employmentId: row.employment_id,
  status: row.status as CareerPlanStatus,
  startedOn: row.started_on,
  version: asNumber(row.version),
  ...presentOf({
    pathId: row.path_id,
    currentStageId: row.current_stage_id,
    targetStageId: row.target_stage_id,
    targetDate: row.target_date,
    notes: row.notes,
    closedOn: row.closed_on,
    closedBy: row.closed_by,
  }),
});

export const planValues = (state: CareerPlanState, tenantId: string): RowValues => ({
  id: state.careerPlanId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  path_id: orNull(state.pathId),
  current_stage_id: orNull(state.currentStageId),
  target_stage_id: orNull(state.targetStageId),
  status: state.status,
  started_on: state.startedOn,
  target_date: orNull(state.targetDate),
  notes: orNull(state.notes),
  closed_on: orNull(state.closedOn),
  closed_by: orNull(state.closedBy),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Talent pools and membership periods
// ------------------------------------------------------------------------------------------------

export interface PoolRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly description: unknown;
  readonly kind: string;
  readonly status: string;
  readonly closed_at: Date | null;
  readonly closed_by: string | null;
  readonly version: number;
}

export const POOL_COLUMNS =
  'id, code, name, description, kind, status, closed_at, closed_by, version';

export const poolState = (row: PoolRow): TalentPoolState => ({
  talentPoolId: row.id,
  code: row.code,
  name: localized(row.name),
  kind: row.kind as TalentPoolKind,
  status: row.status as TalentPoolStatus,
  version: asNumber(row.version),
  ...presentOf({
    description: row.description === null ? undefined : localized(row.description),
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  }),
});

export const poolValues = (state: TalentPoolState, tenantId: string): RowValues => ({
  id: state.talentPoolId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  kind: state.kind,
  status: state.status,
  closed_at: orNull(state.closedAt),
  closed_by: orNull(state.closedBy),
  metadata: '{}',
});

export interface MembershipRow {
  readonly id: string;
  readonly talent_pool_id: string;
  readonly employment_id: string;
  readonly from_date: string;
  readonly to_date: string | null;
  readonly added_by: string;
  readonly added_reason: string | null;
  readonly removed_by: string | null;
  readonly removed_reason: string | null;
  readonly version: number;
}

export const membershipColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.talent_pool_id`,
    `${alias}.employment_id`,
    civilDateColumn(`${alias}.from_date`, 'from_date'),
    civilDateColumn(`${alias}.to_date`, 'to_date'),
    `${alias}.added_by`,
    `${alias}.added_reason`,
    `${alias}.removed_by`,
    `${alias}.removed_reason`,
    `${alias}.version`,
  ].join(', ');

export const membershipState = (row: MembershipRow): PoolMembershipState => ({
  membershipId: row.id,
  talentPoolId: row.talent_pool_id,
  employmentId: row.employment_id,
  from: row.from_date,
  addedBy: row.added_by,
  version: asNumber(row.version),
  ...presentOf({
    to: row.to_date,
    addedReason: row.added_reason,
    removedBy: row.removed_by,
    removedReason: row.removed_reason,
  }),
});

export const membershipValues = (state: PoolMembershipState, tenantId: string): RowValues => ({
  id: state.membershipId,
  tenant_id: tenantId,
  talent_pool_id: state.talentPoolId,
  employment_id: state.employmentId,
  from_date: state.from,
  to_date: orNull(state.to),
  added_by: state.addedBy,
  added_reason: orNull(state.addedReason),
  removed_by: orNull(state.removedBy),
  removed_reason: orNull(state.removedReason),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Readiness levels
// ------------------------------------------------------------------------------------------------

export interface ReadinessLevelRow {
  readonly id: string;
  readonly code: string;
  readonly name: unknown;
  readonly ordinal: number;
  readonly active: boolean;
  readonly version: number;
}

export const READINESS_LEVEL_COLUMNS = 'id, code, name, ordinal, active, version';

/** `ordinal` orders the ladder least to most ready. It is not a score and is never published as one. */
export const readinessLevelState = (row: ReadinessLevelRow): ReadinessLevelState => ({
  readinessLevelId: row.id,
  code: row.code,
  name: localized(row.name),
  ordinal: asNumber(row.ordinal),
  active: row.active,
  version: asNumber(row.version),
});

export const readinessLevelValues = (state: ReadinessLevelState, tenantId: string): RowValues => ({
  id: state.readinessLevelId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  ordinal: state.ordinal,
  active: state.active,
  metadata: '{}',
});
