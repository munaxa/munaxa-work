import type { DevelopmentItemState, DevelopmentPlanState } from '../domain/development.js';
import type { MobilityRecommendationState } from '../domain/mobility.js';
import type {
  DevelopmentCategory,
  DevelopmentItemKind,
  DevelopmentItemStatus,
  DevelopmentPlanStatus,
  MobilityKind,
  StoredMobilityStatus,
} from '../domain/career-vocabulary.js';
import { asNumber, civilDateColumn, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Development and mobility rows.
 *
 * Split from the succession and readiness half at the aggregate boundary rather than at a line
 * count. The same rules apply throughout: civil dates as `YYYY-MM-DD` strings in both directions,
 * `smallint` numbers the schema bounds, and no value anywhere whose exactness a JavaScript `number`
 * could lose.
 *
 * **`career_mobility_recommendation.status` is only ever one of three values.** `expired` is derived
 * at the view boundary from `valid_until` and the day asked, and a check constraint refuses it as a
 * column value (D-13). No mapper here can produce it, and the type says so.
 */
// ------------------------------------------------------------------------------------------------
// Development
// ------------------------------------------------------------------------------------------------

export interface DevelopmentPlanRow {
  readonly id: string;
  readonly employment_id: string;
  readonly career_plan_id: string | null;
  readonly cycle_label: string | null;
  readonly status: string;
  readonly started_on: string;
  readonly target_date: string | null;
  readonly employee_acknowledged_on: string | null;
  readonly employee_acknowledgement_recorded_by: string | null;
  readonly manager_acknowledged_on: string | null;
  readonly manager_acknowledgement_recorded_by: string | null;
  readonly closed_on: string | null;
  readonly closed_by: string | null;
  readonly version: number;
}

export const developmentPlanColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.employment_id`,
    `${alias}.career_plan_id`,
    `${alias}.cycle_label`,
    `${alias}.status`,
    civilDateColumn(`${alias}.started_on`, 'started_on'),
    civilDateColumn(`${alias}.target_date`, 'target_date'),
    civilDateColumn(`${alias}.employee_acknowledged_on`, 'employee_acknowledged_on'),
    `${alias}.employee_acknowledgement_recorded_by`,
    civilDateColumn(`${alias}.manager_acknowledged_on`, 'manager_acknowledged_on'),
    `${alias}.manager_acknowledgement_recorded_by`,
    civilDateColumn(`${alias}.closed_on`, 'closed_on'),
    `${alias}.closed_by`,
    `${alias}.version`,
  ].join(', ');

/**
 * The acknowledgement columns say what is true: an administrator *recorded* it (D-9).
 *
 * A column named `employee_signed_by` would claim the employee pressed a button, and the employee
 * cannot sign in — there is no principal-to-employment resolution (ADR-0032).
 */
export const developmentPlanState = (row: DevelopmentPlanRow): DevelopmentPlanState => ({
  developmentPlanId: row.id,
  employmentId: row.employment_id,
  status: row.status as DevelopmentPlanStatus,
  startedOn: row.started_on,
  version: asNumber(row.version),
  ...presentOf({
    careerPlanId: row.career_plan_id,
    cycleLabel: row.cycle_label,
    targetDate: row.target_date,
    employeeAcknowledgedOn: row.employee_acknowledged_on,
    employeeAcknowledgementRecordedBy: row.employee_acknowledgement_recorded_by,
    managerAcknowledgedOn: row.manager_acknowledged_on,
    managerAcknowledgementRecordedBy: row.manager_acknowledgement_recorded_by,
    closedOn: row.closed_on,
    closedBy: row.closed_by,
  }),
});

export const developmentPlanValues = (
  state: DevelopmentPlanState,
  tenantId: string,
): RowValues => ({
  id: state.developmentPlanId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  career_plan_id: orNull(state.careerPlanId),
  cycle_label: orNull(state.cycleLabel),
  status: state.status,
  started_on: state.startedOn,
  target_date: orNull(state.targetDate),
  employee_acknowledged_on: orNull(state.employeeAcknowledgedOn),
  employee_acknowledgement_recorded_by: orNull(state.employeeAcknowledgementRecordedBy),
  manager_acknowledged_on: orNull(state.managerAcknowledgedOn),
  manager_acknowledgement_recorded_by: orNull(state.managerAcknowledgementRecordedBy),
  closed_on: orNull(state.closedOn),
  closed_by: orNull(state.closedBy),
  metadata: '{}',
});

export interface DevelopmentItemRow {
  readonly id: string;
  readonly development_plan_id: string;
  readonly category: string;
  readonly kind: string;
  readonly title: string;
  readonly learning_assignment_id: string | null;
  readonly target_date: string | null;
  readonly status: string;
  readonly completed_on: string | null;
  readonly completed_by: string | null;
  readonly version: number;
}

export const developmentItemColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.development_plan_id`,
    `${alias}.category`,
    `${alias}.kind`,
    `${alias}.title`,
    `${alias}.learning_assignment_id`,
    civilDateColumn(`${alias}.target_date`, 'target_date'),
    `${alias}.status`,
    civilDateColumn(`${alias}.completed_on`, 'completed_on'),
    `${alias}.completed_by`,
    `${alias}.version`,
  ].join(', ');

/**
 * A course item carries its Learning assignment identifier and nothing else.
 *
 * There is no title of Learning's here, no completion date of Learning's and no progress — whether
 * somebody finished is `learning_enrolment`'s answer, and a second copy would be the one that goes
 * stale the first time an enrolment was withdrawn (ADR-0073).
 */
export const developmentItemState = (row: DevelopmentItemRow): DevelopmentItemState => ({
  developmentItemId: row.id,
  developmentPlanId: row.development_plan_id,
  category: row.category as DevelopmentCategory,
  kind: row.kind as DevelopmentItemKind,
  title: row.title,
  status: row.status as DevelopmentItemStatus,
  version: asNumber(row.version),
  ...presentOf({
    learningAssignmentId: row.learning_assignment_id,
    targetDate: row.target_date,
    completedOn: row.completed_on,
    completedBy: row.completed_by,
  }),
});

export const developmentItemValues = (
  state: DevelopmentItemState,
  tenantId: string,
): RowValues => ({
  id: state.developmentItemId,
  tenant_id: tenantId,
  development_plan_id: state.developmentPlanId,
  category: state.category,
  kind: state.kind,
  title: state.title,
  learning_assignment_id: orNull(state.learningAssignmentId),
  target_date: orNull(state.targetDate),
  status: state.status,
  completed_on: orNull(state.completedOn),
  completed_by: orNull(state.completedBy),
  metadata: '{}',
});

// ------------------------------------------------------------------------------------------------
// Mobility
// ------------------------------------------------------------------------------------------------

export interface MobilityRow {
  readonly id: string;
  readonly employment_id: string;
  readonly kind: string;
  readonly target_position_id: string | null;
  readonly target_unit_id: string | null;
  readonly rationale: string | null;
  readonly status: string;
  readonly recommended_on: string;
  readonly recommended_by: string;
  readonly valid_until: string | null;
  readonly decided_on: string | null;
  readonly decided_by: string | null;
  readonly decision_note: string | null;
  readonly version: number;
}

export const mobilityColumns = (alias: string): string =>
  [
    `${alias}.id`,
    `${alias}.employment_id`,
    `${alias}.kind`,
    `${alias}.target_position_id`,
    `${alias}.target_unit_id`,
    `${alias}.rationale`,
    `${alias}.status`,
    civilDateColumn(`${alias}.recommended_on`, 'recommended_on'),
    `${alias}.recommended_by`,
    civilDateColumn(`${alias}.valid_until`, 'valid_until'),
    civilDateColumn(`${alias}.decided_on`, 'decided_on'),
    `${alias}.decided_by`,
    `${alias}.decision_note`,
    `${alias}.version`,
  ].join(', ');

/**
 * A suggestion, and nothing that moves anybody (ADR-0072).
 *
 * `status` is one of three stored values. `expired` is never among them: it is derived at the view
 * boundary from `valid_until` and the day asked, because nothing would maintain a stored flag —
 * `JobPort` has no adapter. There is no `effective_date` and no `assignment_id` to map, because the
 * schema has neither and nothing here should point at a move that happened.
 */
export const mobilityState = (row: MobilityRow): MobilityRecommendationState => ({
  mobilityRecommendationId: row.id,
  employmentId: row.employment_id,
  kind: row.kind as MobilityKind,
  status: row.status as StoredMobilityStatus,
  recommendedOn: row.recommended_on,
  recommendedBy: row.recommended_by,
  version: asNumber(row.version),
  ...presentOf({
    targetPositionId: row.target_position_id,
    targetUnitId: row.target_unit_id,
    rationale: row.rationale,
    validUntil: row.valid_until,
    decidedOn: row.decided_on,
    decidedBy: row.decided_by,
    decisionNote: row.decision_note,
  }),
});

export const mobilityValues = (
  state: MobilityRecommendationState,
  tenantId: string,
): RowValues => ({
  id: state.mobilityRecommendationId,
  tenant_id: tenantId,
  employment_id: state.employmentId,
  kind: state.kind,
  target_position_id: orNull(state.targetPositionId),
  target_unit_id: orNull(state.targetUnitId),
  rationale: orNull(state.rationale),
  status: state.status,
  recommended_on: state.recommendedOn,
  recommended_by: state.recommendedBy,
  valid_until: orNull(state.validUntil),
  decided_on: orNull(state.decidedOn),
  decided_by: orNull(state.decidedBy),
  decision_note: orNull(state.decisionNote),
  metadata: '{}',
});
