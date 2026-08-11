import type { AssessmentItemState, AssessmentState } from '../domain/assessment.js';
import type {
  AssessmentKind,
  AssessmentStatus,
  ExclusionReason,
  ScoreComponent,
} from '../domain/performance-vocabulary.js';
import type { ComponentScoreRecord } from '../application/performance-ports.js';
import { asNumber, orNull, presentOf, type RowValues } from './row-writer.js';

/**
 * Assessments, their lines, and the persisted working behind a score.
 *
 * **Every score column here is an integer holding hundredths** and every weight an integer holding
 * basis points, so `asNumber` on an already-integral column is the only conversion on the path.
 * There is no `numeric` column for a driver to hand back as a float and no rounding step between
 * what the engine computed and what the database holds.
 *
 * `presentOf` drops nulls and nothing else, which matters here more than anywhere: a score of zero
 * and an unscored line are different facts, and a mapper that collapsed the first into the second
 * would turn a judgement into an absence.
 */

export interface AssessmentRow {
  readonly id: string;
  readonly review_id: string;
  readonly reviewer_assignment_id: string | null;
  readonly assessor_employment_id: string;
  readonly assessment_kind: string;
  readonly status: string;
  readonly goal_score: number | null;
  readonly competency_score: number | null;
  readonly overall_score: number | null;
  readonly rating_level_id: string | null;
  readonly overall_comment: string | null;
  readonly strengths: string | null;
  readonly development_areas: string | null;
  readonly submitted_at: Date | null;
  readonly submitted_by: string | null;
  readonly version: number;
}

export const assessmentState = (row: AssessmentRow): AssessmentState => ({
  assessmentId: row.id,
  reviewId: row.review_id,
  assessorEmploymentId: row.assessor_employment_id,
  assessmentKind: row.assessment_kind as AssessmentKind,
  status: row.status as AssessmentStatus,
  version: asNumber(row.version),
  ...presentOf({
    reviewerAssignmentId: row.reviewer_assignment_id,
    goalScore: row.goal_score === null ? null : asNumber(row.goal_score),
    competencyScore: row.competency_score === null ? null : asNumber(row.competency_score),
    overallScore: row.overall_score === null ? null : asNumber(row.overall_score),
    ratingLevelId: row.rating_level_id,
    overallComment: row.overall_comment,
    strengths: row.strengths,
    developmentAreas: row.development_areas,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by,
  }),
});

export const assessmentValues = (state: AssessmentState, tenantId: string): RowValues => ({
  id: state.assessmentId,
  tenant_id: tenantId,
  review_id: state.reviewId,
  reviewer_assignment_id: orNull(state.reviewerAssignmentId),
  assessor_employment_id: state.assessorEmploymentId,
  assessment_kind: state.assessmentKind,
  status: state.status,
  goal_score: orNull(state.goalScore),
  competency_score: orNull(state.competencyScore),
  overall_score: orNull(state.overallScore),
  rating_level_id: orNull(state.ratingLevelId),
  overall_comment: orNull(state.overallComment),
  strengths: orNull(state.strengths),
  development_areas: orNull(state.developmentAreas),
  submitted_at: orNull(state.submittedAt),
  submitted_by: orNull(state.submittedBy),
});

export interface AssessmentItemRow {
  readonly id: string;
  readonly assessment_id: string;
  readonly item_kind: string;
  readonly goal_id: string | null;
  readonly competency_id: string | null;
  readonly score: number | null;
  readonly rating_level_id: string | null;
  readonly weight_basis_points: number | null;
  readonly comment: string | null;
  readonly excluded: boolean;
  readonly exclusion_reason: string | null;
  readonly version: number;
}

export const assessmentItemState = (row: AssessmentItemRow): AssessmentItemState => ({
  assessmentItemId: row.id,
  assessmentId: row.assessment_id,
  itemKind: row.item_kind as 'goal' | 'competency',
  excluded: row.excluded,
  version: asNumber(row.version),
  ...(row.goal_id === null ? {} : { goalId: row.goal_id }),
  ...(row.competency_id === null ? {} : { competencyId: row.competency_id }),
  ...(row.score === null ? {} : { score: asNumber(row.score) }),
  ...(row.rating_level_id === null ? {} : { ratingLevelId: row.rating_level_id }),
  ...(row.weight_basis_points === null
    ? {}
    : { weightBasisPoints: asNumber(row.weight_basis_points) }),
  ...(row.comment === null ? {} : { comment: row.comment }),
  ...(row.exclusion_reason === null
    ? {}
    : { exclusionReason: row.exclusion_reason as ExclusionReason }),
});

export const assessmentItemValues = (state: AssessmentItemState, tenantId: string): RowValues => ({
  id: state.assessmentItemId,
  tenant_id: tenantId,
  assessment_id: state.assessmentId,
  item_kind: state.itemKind,
  goal_id: orNull(state.goalId),
  competency_id: orNull(state.competencyId),
  score: orNull(state.score),
  rating_level_id: orNull(state.ratingLevelId),
  weight_basis_points: orNull(state.weightBasisPoints),
  comment: orNull(state.comment),
  excluded: state.excluded,
  exclusion_reason: orNull(state.exclusionReason),
});

export interface ComponentScoreRow {
  readonly id: string;
  readonly review_id: string;
  readonly component: string;
  readonly weight_basis_points: number;
  readonly score: number | null;
  readonly included: boolean;
  readonly exclusion_reason: string | null;
  readonly denominator_basis_points: number;
  readonly contributed_score: number | null;
  readonly calculated_at: Date;
  readonly excluded_items: readonly { readonly reference: string; readonly reason: string }[];
}

/**
 * The persisted working behind a score.
 *
 * `excluded_items` is stored rather than derived. Rebuilding which goals left the denominator by
 * re-reading the assessment items would make the explanation of a completed rating depend on
 * exactly the mutable state the persisted working exists to escape.
 */
export const componentScoreRecord = (row: ComponentScoreRow): ComponentScoreRecord => ({
  reviewId: row.review_id,
  component: row.component as ScoreComponent,
  weightBasisPoints: asNumber(row.weight_basis_points),
  included: row.included,
  denominatorBasisPoints: asNumber(row.denominator_basis_points),
  calculatedAt: row.calculated_at,
  excludedItems: row.excluded_items.map((item) => ({
    reference: item.reference,
    reason: item.reason as ExclusionReason,
  })),
  ...(row.score === null ? {} : { score: asNumber(row.score) }),
  ...(row.exclusion_reason === null
    ? {}
    : { exclusionReason: row.exclusion_reason as ExclusionReason }),
  ...(row.contributed_score === null ? {} : { contributedScore: asNumber(row.contributed_score) }),
});

export const componentScoreValues = (
  state: ComponentScoreRecord,
  componentScoreId: string,
  tenantId: string,
): RowValues => ({
  id: componentScoreId,
  tenant_id: tenantId,
  review_id: state.reviewId,
  component: state.component,
  weight_basis_points: state.weightBasisPoints,
  score: orNull(state.score),
  included: state.included,
  exclusion_reason: orNull(state.exclusionReason),
  denominator_basis_points: state.denominatorBasisPoints,
  contributed_score: orNull(state.contributedScore),
  excluded_items: JSON.stringify(state.excludedItems),
  calculated_at: state.calculatedAt,
});

/**
 * A goal's columns, unqualified or aliased.
 *
 * A function rather than one literal with an alias spliced in by regular expression: the civil-date
 * columns are `to_char(...)` expressions, and a pattern that prefixed every bare identifier would
 * prefix the ones inside those calls too — producing SQL that fails at run time in a query nobody
 * reads twice.
 */
