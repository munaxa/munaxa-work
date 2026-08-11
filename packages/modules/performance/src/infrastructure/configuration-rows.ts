import type {
  CompetencyFrameworkState,
  CompetencyLevelState,
  CompetencyState,
} from '../domain/competency-framework.js';
import type { LocalizedName, RatingLevelState, RatingScaleState } from '../domain/rating-scale.js';
import type { ReviewTemplateState, TemplateComponentState } from '../domain/review-template.js';
import type { CompetencyCategory, ScoreComponent } from '../domain/performance-vocabulary.js';
import type { GoalCategoryState } from '../application/performance-ports.js';
import { asNumber, orNull, type RowValues } from './row-writer.js';

/**
 * Configuration rows to state and back.
 *
 * Two conventions carry through every mapper in this module. **`version` never appears in a values
 * map** — `auditForInsert` writes it on insert and `Repository.updateRow` appends
 * `version = version + 1`, so including it produces "multiple assignments to same column", which is
 * the defect Phase 10 found the hard way.
 *
 * And **every score and weight is an integer**. `minimum_score`, `maximum_score` and a competency
 * level's `score` are hundredths; `weight_basis_points` is basis points. They are read with
 * `asNumber` on an already-integral column, so there is no rounding step to get wrong and no
 * `numeric` column for a driver to hand back as a float.
 *
 * Civil dates are read from `to_char(...)` aliases rather than `date` columns — the driver would
 * otherwise build a `Date` at the *process's* local midnight, so an effective-from read on a server
 * west of UTC comes back as the previous day.
 */

const civil = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

const civilOf = (value: Date): string => value.toISOString().slice(0, 10);

export interface RatingScaleRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description: LocalizedName | null;
  readonly minimum_score: number;
  readonly maximum_score: number;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly active: boolean;
  readonly version: number;
}

export const ratingScaleState = (row: RatingScaleRow): RatingScaleState => ({
  ratingScaleId: row.id,
  code: row.code,
  name: row.name,
  minimumScore: asNumber(row.minimum_score),
  maximumScore: asNumber(row.maximum_score),
  effectiveFrom: civil(row.effective_from),
  active: row.active,
  version: asNumber(row.version),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.effective_to === null ? {} : { effectiveTo: civil(row.effective_to) }),
});

export const ratingScaleValues = (state: RatingScaleState, tenantId: string): RowValues => ({
  id: state.ratingScaleId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  minimum_score: state.minimumScore,
  maximum_score: state.maximumScore,
  effective_from: civilOf(state.effectiveFrom),
  effective_to: state.effectiveTo === undefined ? null : civilOf(state.effectiveTo),
  active: state.active,
  metadata: '{}',
});

export interface RatingLevelRow {
  readonly id: string;
  readonly performance_rating_scale_id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description: LocalizedName | null;
  readonly ordinal: number;
  readonly minimum_score: number;
  readonly maximum_score: number;
  readonly version: number;
}

export const ratingLevelState = (row: RatingLevelRow): RatingLevelState => ({
  ratingLevelId: row.id,
  ratingScaleId: row.performance_rating_scale_id,
  code: row.code,
  name: row.name,
  ordinal: asNumber(row.ordinal),
  minimumScore: asNumber(row.minimum_score),
  maximumScore: asNumber(row.maximum_score),
  version: asNumber(row.version),
  ...(row.description === null ? {} : { description: row.description }),
});

export const ratingLevelValues = (state: RatingLevelState, tenantId: string): RowValues => ({
  id: state.ratingLevelId,
  tenant_id: tenantId,
  performance_rating_scale_id: state.ratingScaleId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  ordinal: state.ordinal,
  minimum_score: state.minimumScore,
  maximum_score: state.maximumScore,
});

export interface FrameworkRow {
  readonly id: string;
  readonly code: string;
  readonly framework_version: number;
  readonly name: LocalizedName;
  readonly description: LocalizedName | null;
  readonly weighted: boolean;
  readonly effective_from: string;
  readonly effective_to: string | null;
  readonly active: boolean;
  readonly version: number;
}

export const frameworkState = (row: FrameworkRow): CompetencyFrameworkState => ({
  frameworkId: row.id,
  code: row.code,
  frameworkVersion: asNumber(row.framework_version),
  name: row.name,
  weighted: row.weighted,
  effectiveFrom: civil(row.effective_from),
  active: row.active,
  version: asNumber(row.version),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.effective_to === null ? {} : { effectiveTo: civil(row.effective_to) }),
});

export const frameworkValues = (state: CompetencyFrameworkState, tenantId: string): RowValues => ({
  id: state.frameworkId,
  tenant_id: tenantId,
  code: state.code,
  framework_version: state.frameworkVersion,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  weighted: state.weighted,
  effective_from: civilOf(state.effectiveFrom),
  effective_to: state.effectiveTo === undefined ? null : civilOf(state.effectiveTo),
  active: state.active,
  metadata: '{}',
});

export interface CompetencyRow {
  readonly id: string;
  readonly framework_id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description: LocalizedName | null;
  readonly category: string;
  readonly weight_basis_points: number | null;
  readonly display_order: number;
  readonly active: boolean;
  readonly version: number;
}

export const competencyState = (row: CompetencyRow): CompetencyState => ({
  competencyId: row.id,
  frameworkId: row.framework_id,
  code: row.code,
  name: row.name,
  category: row.category as CompetencyCategory,
  displayOrder: asNumber(row.display_order),
  active: row.active,
  version: asNumber(row.version),
  ...(row.description === null ? {} : { description: row.description }),
  // Null and zero are different answers: an unweighted framework's competency carries no weight,
  // and a weighted framework's competency may legitimately weigh nothing.
  ...(row.weight_basis_points === null
    ? {}
    : { weightBasisPoints: asNumber(row.weight_basis_points) }),
});

export const competencyValues = (state: CompetencyState, tenantId: string): RowValues => ({
  id: state.competencyId,
  tenant_id: tenantId,
  framework_id: state.frameworkId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  category: state.category,
  weight_basis_points: orNull(state.weightBasisPoints),
  display_order: state.displayOrder,
  active: state.active,
});

export interface CompetencyLevelRow {
  readonly id: string;
  readonly competency_id: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly behavioural_indicators: readonly LocalizedName[];
  readonly score: number;
  readonly version: number;
}

export const competencyLevelState = (row: CompetencyLevelRow): CompetencyLevelState => ({
  competencyLevelId: row.id,
  competencyId: row.competency_id,
  ordinal: asNumber(row.ordinal),
  name: row.name,
  behaviouralIndicators: row.behavioural_indicators,
  score: asNumber(row.score),
  version: asNumber(row.version),
});

export const competencyLevelValues = (
  state: CompetencyLevelState,
  tenantId: string,
): RowValues => ({
  id: state.competencyLevelId,
  tenant_id: tenantId,
  competency_id: state.competencyId,
  ordinal: state.ordinal,
  name: JSON.stringify(state.name),
  behavioural_indicators: JSON.stringify(state.behaviouralIndicators),
  score: state.score,
});

export interface GoalCategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly active: boolean;
  readonly version: number;
}

export const goalCategoryState = (row: GoalCategoryRow): GoalCategoryState => ({
  goalCategoryId: row.id,
  code: row.code,
  name: row.name,
  active: row.active,
  version: asNumber(row.version),
});

export const goalCategoryValues = (state: GoalCategoryState, tenantId: string): RowValues => ({
  id: state.goalCategoryId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  active: state.active,
});

export interface TemplateRow {
  readonly id: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description: LocalizedName | null;
  readonly rating_scale_id: string;
  readonly competency_framework_id: string | null;
  readonly requires_self_assessment: boolean;
  readonly requires_peer_assessment: boolean;
  readonly requires_calibration: boolean;
  readonly goal_weight_total_basis_points: number;
  readonly minimum_peer_responses: number | null;
  readonly active: boolean;
  readonly version: number;
}

export const templateState = (row: TemplateRow): ReviewTemplateState => ({
  templateId: row.id,
  code: row.code,
  name: row.name,
  ratingScaleId: row.rating_scale_id,
  requiresSelfAssessment: row.requires_self_assessment,
  requiresPeerAssessment: row.requires_peer_assessment,
  requiresCalibration: row.requires_calibration,
  goalWeightTotalBasisPoints: asNumber(row.goal_weight_total_basis_points),
  active: row.active,
  version: asNumber(row.version),
  ...(row.description === null ? {} : { description: row.description }),
  ...(row.competency_framework_id === null
    ? {}
    : { competencyFrameworkId: row.competency_framework_id }),
  ...(row.minimum_peer_responses === null
    ? {}
    : { minimumPeerResponses: asNumber(row.minimum_peer_responses) }),
});

export const templateValues = (state: ReviewTemplateState, tenantId: string): RowValues => ({
  id: state.templateId,
  tenant_id: tenantId,
  code: state.code,
  name: JSON.stringify(state.name),
  description: state.description === undefined ? null : JSON.stringify(state.description),
  rating_scale_id: state.ratingScaleId,
  competency_framework_id: orNull(state.competencyFrameworkId),
  requires_self_assessment: state.requiresSelfAssessment,
  requires_peer_assessment: state.requiresPeerAssessment,
  requires_calibration: state.requiresCalibration,
  goal_weight_total_basis_points: state.goalWeightTotalBasisPoints,
  minimum_peer_responses: orNull(state.minimumPeerResponses),
  active: state.active,
  metadata: '{}',
});

export interface TemplateComponentRow {
  readonly id: string;
  readonly template_id: string;
  readonly component: string;
  readonly weight_basis_points: number;
  readonly version: number;
}

export const templateComponentState = (row: TemplateComponentRow): TemplateComponentState => ({
  templateComponentId: row.id,
  templateId: row.template_id,
  component: row.component as ScoreComponent,
  weightBasisPoints: asNumber(row.weight_basis_points),
  version: asNumber(row.version),
});

export const templateComponentValues = (
  state: TemplateComponentState,
  tenantId: string,
): RowValues => ({
  id: state.templateComponentId,
  tenant_id: tenantId,
  template_id: state.templateId,
  component: state.component,
  weight_basis_points: state.weightBasisPoints,
});

/** The `to_char` aliases the configuration reads need, in one place so no query forgets one. */
export const SCALE_COLUMNS = `id, code, name, description, minimum_score, maximum_score, active, version,
   to_char(effective_from, 'YYYY-MM-DD') as effective_from,
   to_char(effective_to, 'YYYY-MM-DD') as effective_to`;

export const FRAMEWORK_COLUMNS = `id, code, framework_version, name, description, weighted, active, version,
   to_char(effective_from, 'YYYY-MM-DD') as effective_from,
   to_char(effective_to, 'YYYY-MM-DD') as effective_to`;
