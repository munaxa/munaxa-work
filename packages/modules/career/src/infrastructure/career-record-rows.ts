import type { ReadinessAssessmentState } from '../domain/readiness.js';
import type { SuccessionPlanState, SuccessorState } from '../domain/succession.js';
import type { SuccessionPlanStatus, SuccessorStatus } from '../domain/career-vocabulary.js';
import { asNumber, civilDateColumn, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Succession and readiness rows.
 *
 * The same rules as the configuration half: civil dates as `YYYY-MM-DD` strings in both directions,
 * `smallint` numbers the schema bounds, and `recorded_at` kept as a genuine instant because it *is*
 * one — the moment a statement was written down, which is what breaks a same-day tie between an
 * assessment and its correction.
 *
 * Development and mobility live in `career-development-rows.ts`, split at the aggregate boundary.
 */

// ------------------------------------------------------------------------------------------------
// Succession
// ------------------------------------------------------------------------------------------------

export interface SuccessionPlanRow {
  readonly id: string;
  readonly position_id: string;
  readonly status: string;
  readonly review_on: string | null;
  readonly notes: string | null;
  readonly archived_at: Date | null;
  readonly archived_by: string | null;
  readonly version: number;
}

export const successionPlanColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.position_id`,
    `${alias}.status`,
    civilDateColumn(`${alias}.review_on`, 'review_on'),
    `${alias}.notes`,
    `${alias}.archived_at`,
    `${alias}.archived_by`,
    `${alias}.version`,
  ].join(', ');

/** No criticality column, and there will not be one: Organization owns it (AD-004, D-3). */
export const successionPlanState = (row: SuccessionPlanRow): SuccessionPlanState => ({
  successionPlanId: row.id,
  positionId: row.position_id,
  status: row.status as SuccessionPlanStatus,
  version: asNumber(row.version),
  ...presentOf({
    reviewOn: row.review_on,
    notes: row.notes,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  }),
});

export const successionPlanValues = (state: SuccessionPlanState, tenantId: string): RowValues => ({
  id: state.successionPlanId,
  tenant_id: tenantId,
  position_id: state.positionId,
  status: state.status,
  review_on: orNull(state.reviewOn),
  notes: orNull(state.notes),
  archived_at: orNull(state.archivedAt),
  archived_by: orNull(state.archivedBy),
  metadata: '{}',
});

export interface SuccessorRow {
  readonly id: string;
  readonly succession_plan_id: string;
  readonly employment_id: string;
  readonly readiness_level_id: string | null;
  readonly rank: number | null;
  readonly status: string;
  readonly nominated_on: string;
  readonly nominated_by: string;
  readonly confirmed_on: string | null;
  readonly confirmed_by: string | null;
  readonly withdrawn_on: string | null;
  readonly withdrawn_by: string | null;
  readonly withdrawal_reason: string | null;
  readonly version: number;
}

export const successorColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.succession_plan_id`,
    `${alias}.employment_id`,
    `${alias}.readiness_level_id`,
    `${alias}.rank`,
    `${alias}.status`,
    civilDateColumn(`${alias}.nominated_on`, 'nominated_on'),
    `${alias}.nominated_by`,
    civilDateColumn(`${alias}.confirmed_on`, 'confirmed_on'),
    `${alias}.confirmed_by`,
    civilDateColumn(`${alias}.withdrawn_on`, 'withdrawn_on'),
    `${alias}.withdrawn_by`,
    `${alias}.withdrawal_reason`,
    `${alias}.version`,
  ].join(', ');

/** `rank` is an order a human put the bench in. Not a score, and nothing computes it. */
export const successorState = (row: SuccessorRow): SuccessorState => ({
  successorId: row.id,
  successionPlanId: row.succession_plan_id,
  employmentId: row.employment_id,
  status: row.status as SuccessorStatus,
  nominatedOn: row.nominated_on,
  nominatedBy: row.nominated_by,
  version: asNumber(row.version),
  ...presentOf({
    readinessLevelId: row.readiness_level_id,
    rank: row.rank === null ? undefined : asNumber(row.rank),
    confirmedOn: row.confirmed_on,
    confirmedBy: row.confirmed_by,
    withdrawnOn: row.withdrawn_on,
    withdrawnBy: row.withdrawn_by,
    withdrawalReason: row.withdrawal_reason,
  }),
});

export const successorValues = (state: SuccessorState, tenantId: string): RowValues => ({
  id: state.successorId,
  tenant_id: tenantId,
  succession_plan_id: state.successionPlanId,
  employment_id: state.employmentId,
  readiness_level_id: orNull(state.readinessLevelId),
  rank: orNull(state.rank),
  status: state.status,
  nominated_on: state.nominatedOn,
  nominated_by: state.nominatedBy,
  confirmed_on: orNull(state.confirmedOn),
  confirmed_by: orNull(state.confirmedBy),
  withdrawn_on: orNull(state.withdrawnOn),
  withdrawn_by: orNull(state.withdrawnBy),
  withdrawal_reason: orNull(state.withdrawalReason),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Readiness assessments
// ------------------------------------------------------------------------------------------------

export interface AssessmentRow {
  readonly id: string;
  readonly employment_id: string;
  readonly readiness_level_id: string;
  readonly position_id: string | null;
  readonly succession_plan_id: string | null;
  readonly assessed_on: string;
  readonly assessed_by: string;
  readonly rationale: string | null;
  readonly recorded_at: Date;
}

export const assessmentColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.employment_id`,
    `${alias}.readiness_level_id`,
    `${alias}.position_id`,
    `${alias}.succession_plan_id`,
    civilDateColumn(`${alias}.assessed_on`, 'assessed_on'),
    `${alias}.assessed_by`,
    `${alias}.rationale`,
    `${alias}.recorded_at`,
  ].join(', ');

/**
 * One assessor's statement, passed through untouched.
 *
 * `assessed_on` is a civil day and stays a string; `recorded_at` is genuinely an instant and stays
 * a `Date`. There is no score column to map, no weight and no derived level, because readiness is
 * stated and nothing computes it (ADR-0074). There is also **no evidence-document column**: the
 * schema has none, and Checkpoint 4 removed the field rather than confirm a reference and discard
 * it.
 */
export const assessmentState = (row: AssessmentRow): ReadinessAssessmentState => ({
  readinessAssessmentId: row.id,
  employmentId: row.employment_id,
  readinessLevelId: row.readiness_level_id,
  assessedOn: row.assessed_on,
  assessedBy: row.assessed_by,
  recordedAt: row.recorded_at,
  ...presentOf({
    positionId: row.position_id,
    successionPlanId: row.succession_plan_id,
    rationale: row.rationale,
  }),
});

export const assessmentValues = (state: ReadinessAssessmentState, tenantId: string): RowValues => ({
  id: state.readinessAssessmentId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  readiness_level_id: state.readinessLevelId,
  position_id: orNull(state.positionId),
  succession_plan_id: orNull(state.successionPlanId),
  assessed_on: state.assessedOn,
  assessed_by: state.assessedBy,
  rationale: orNull(state.rationale),
  recorded_at: state.recordedAt,
  metadata: '{}',
});
