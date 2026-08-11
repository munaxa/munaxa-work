import {
  MAX_BASIS_POINTS,
  isEntityCode,
  isScoreComponent,
  type ScoreComponent,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type { LocalizedName } from './rating-scale.js';

/**
 * The shape of a review: which scale it rates against, which framework it assesses, what it
 * requires, and what its components weigh.
 *
 * **The component weights are the first approved scoring decision, and this is where they are
 * refused.** They are tenant configuration, in integer basis points, and they must total 10,000. A
 * template weighting goals at 60% and competencies at 30% is not a template that means two-to-one;
 * it is one somebody mis-entered, and scoring against it would produce a number nobody could
 * account for afterwards. The database cannot check a total across rows, so it is checked here,
 * refused again before a review is scored, and reported by the reconciliation query — three places,
 * because a rule enforced in only one of them is a rule that a bulk path will eventually bypass.
 *
 * **`goalWeightTotalBasisPoints` is D-5's "must total", made configurable rather than fixed.** A
 * tenant that runs unweighted goals sets it to zero; one that requires a complete goal set leaves
 * it at 10,000 and a participant whose goals do not add up is refused before scoring.
 *
 * **A template that asks for peers says how few is too few.** `minimumPeerResponses` withholds an
 * aggregate computed from one person's opinion presented as the group's. It is a display rule, and
 * it is emphatically **not** anonymity — every response records its author, and nothing in this
 * module claims otherwise (D-12).
 */

export interface TemplateComponentState {
  readonly templateComponentId: string;
  readonly templateId: string;
  readonly component: ScoreComponent;
  readonly weightBasisPoints: number;
  readonly version: number;
}

export interface ReviewTemplateState {
  readonly templateId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly ratingScaleId: string;
  readonly competencyFrameworkId?: string;
  readonly requiresSelfAssessment: boolean;
  readonly requiresPeerAssessment: boolean;
  readonly requiresCalibration: boolean;
  readonly goalWeightTotalBasisPoints: number;
  readonly minimumPeerResponses?: number;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineTemplateComponentRequest {
  readonly templateComponentId: string;
  readonly component: string;
  readonly weightBasisPoints: number;
}

export interface DefineTemplateRequest {
  readonly templateId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly ratingScaleId: string;
  readonly competencyFrameworkId?: string;
  readonly requiresSelfAssessment: boolean;
  readonly requiresPeerAssessment: boolean;
  readonly requiresCalibration: boolean;
  readonly goalWeightTotalBasisPoints: number;
  readonly minimumPeerResponses?: number;
  readonly components: readonly DefineTemplateComponentRequest[];
}

export interface DefinedTemplate {
  readonly template: ReviewTemplateState;
  readonly components: readonly TemplateComponentState[];
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const defineTemplate = (
  request: DefineTemplateRequest,
): PerformanceResult<DefinedTemplate> => {
  const checked = validateTemplate(request);

  if (!checked.ok) return checked;

  return accept({
    template: {
      templateId: request.templateId,
      code: request.code,
      name: request.name,
      ratingScaleId: request.ratingScaleId,
      requiresSelfAssessment: request.requiresSelfAssessment,
      requiresPeerAssessment: request.requiresPeerAssessment,
      requiresCalibration: request.requiresCalibration,
      goalWeightTotalBasisPoints: request.goalWeightTotalBasisPoints,
      active: true,
      version: 1,
      ...optional('description', request.description),
      ...optional('competencyFrameworkId', request.competencyFrameworkId),
      ...optional('minimumPeerResponses', request.minimumPeerResponses),
    },
    components: checked.value.map((component) => ({
      templateComponentId: component.templateComponentId,
      templateId: request.templateId,
      component: component.component,
      weightBasisPoints: component.weightBasisPoints,
      version: 1,
    })),
  });
};

interface CheckedComponent {
  readonly templateComponentId: string;
  readonly component: ScoreComponent;
  readonly weightBasisPoints: number;
}

const validateTemplate = (
  request: DefineTemplateRequest,
): PerformanceResult<readonly CheckedComponent[]> => {
  if (!isEntityCode(request.code))
    return refuse('review-template-code-invalid', { code: request.code });
  if (
    !Number.isInteger(request.goalWeightTotalBasisPoints) ||
    request.goalWeightTotalBasisPoints < 0 ||
    request.goalWeightTotalBasisPoints > MAX_BASIS_POINTS
  ) {
    return refuse('review-template-goal-total-out-of-range');
  }
  if (request.requiresPeerAssessment && request.minimumPeerResponses === undefined) {
    return refuse('review-template-peer-minimum-required');
  }
  if (request.minimumPeerResponses !== undefined && request.minimumPeerResponses < 1) {
    return refuse('review-template-peer-minimum-invalid');
  }

  return validateComponents(request);
};

const validateComponent = (
  component: DefineTemplateComponentRequest,
): PerformanceResult<CheckedComponent> => {
  if (!isScoreComponent(component.component)) {
    return refuse('review-template-component-unknown', { component: component.component });
  }
  if (
    !Number.isInteger(component.weightBasisPoints) ||
    component.weightBasisPoints < 0 ||
    component.weightBasisPoints > MAX_BASIS_POINTS
  ) {
    return refuse('review-template-component-weight-out-of-range', {
      component: component.component,
    });
  }

  return accept({
    templateComponentId: component.templateComponentId,
    component: component.component,
    weightBasisPoints: component.weightBasisPoints,
  });
};

/**
 * The components, checked as a set: known names, no duplicates, whole weights, and a total of
 * exactly 10,000.
 *
 * A component that assesses competencies is refused where the template names no framework, because
 * weighting part of a score against nothing at all is how a review comes out at a number that
 * cannot be explained to the person it belongs to.
 */
const validateComponents = (
  request: DefineTemplateRequest,
): PerformanceResult<readonly CheckedComponent[]> => {
  if (request.components.length === 0) return refuse('review-template-has-no-components');

  const checked: CheckedComponent[] = [];

  for (const component of request.components) {
    const one = validateComponent(component);

    if (!one.ok) return one;
    checked.push(one.value);
  }

  if (new Set(checked.map((component) => component.component)).size !== checked.length) {
    return refuse('review-template-component-duplicated');
  }

  const total = checked.reduce((running, component) => running + component.weightBasisPoints, 0);

  if (total !== MAX_BASIS_POINTS) {
    return refuse('review-template-component-weights-not-total', {
      total: String(total),
      required: String(MAX_BASIS_POINTS),
    });
  }

  const competencies = checked.find((component) => component.component === 'competencies');

  if (
    competencies !== undefined &&
    competencies.weightBasisPoints > 0 &&
    request.competencyFrameworkId === undefined
  ) {
    return refuse('review-template-competencies-without-framework');
  }

  return accept(checked);
};

/**
 * Retiring a template. Cycles already running against it keep it, because their reviews were
 * enrolled under its rules and a template that changed underneath them would change what those
 * reviews were measured by.
 */
export const retireTemplate = (
  state: ReviewTemplateState,
): PerformanceResult<ReviewTemplateState> => {
  if (!state.active) return refuse('review-template-already-retired');

  return accept({ ...state, active: false });
};
