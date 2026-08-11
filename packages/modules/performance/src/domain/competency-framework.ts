import {
  MAX_BASIS_POINTS,
  isCompetencyCategory,
  isEntityCode,
  type CompetencyCategory,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import type { LocalizedName } from './rating-scale.js';

/**
 * A named, versioned set of competencies, and what each of them looks like when demonstrated.
 *
 * **The boundary with People and Learning is the most consequential line in this phase (D-9), and
 * it is drawn here.** `person_capability` (Phase 4) holds what a person *claims* about themselves.
 * Learning (Phase 14) will hold what a person has *attained* — a certification, an assessment, a
 * course completed. This module holds what a manager *observed of the job*, in a cycle, against a
 * definition a tenant wrote. Three different questions with three different owners, and this file
 * answers only the third.
 *
 * **`framework_version` is part of the identity, not a mutable column.** Redefining a competency
 * publishes a new version, because a review completed against version 2 must still read as version
 * 2 after somebody edits the wording in version 3. The completion snapshot keeps the definitions
 * for exactly this reason (§15).
 *
 * **Weights exist only where a framework says they do.** The third approved scoring decision is
 * that a competency aggregate is an unweighted mean unless the framework explicitly carries
 * weights, and that none are invented where it does not. So `weighted` is a property of the
 * framework, a competency in an unweighted framework may not carry one, and a competency in a
 * weighted framework must.
 */

export interface CompetencyLevelState {
  readonly competencyLevelId: string;
  readonly competencyId: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly behaviouralIndicators: readonly LocalizedName[];
  readonly score: number;
  readonly version: number;
}

export interface CompetencyState {
  readonly competencyId: string;
  readonly frameworkId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly category: CompetencyCategory;
  readonly weightBasisPoints?: number;
  readonly displayOrder: number;
  readonly active: boolean;
  readonly version: number;
}

export interface CompetencyFrameworkState {
  readonly frameworkId: string;
  readonly code: string;
  readonly frameworkVersion: number;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly weighted: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly active: boolean;
  readonly version: number;
}

export interface DefineCompetencyLevelRequest {
  readonly competencyLevelId: string;
  readonly ordinal: number;
  readonly name: LocalizedName;
  readonly behaviouralIndicators?: readonly LocalizedName[];
  readonly score: number;
}

export interface DefineCompetencyRequest {
  readonly competencyId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly category: string;
  readonly weightBasisPoints?: number;
  readonly displayOrder: number;
  readonly levels: readonly DefineCompetencyLevelRequest[];
}

export interface DefineFrameworkRequest {
  readonly frameworkId: string;
  readonly code: string;
  readonly frameworkVersion: number;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly weighted: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

export interface DefinedCompetency {
  readonly competency: CompetencyState;
  readonly levels: readonly CompetencyLevelState[];
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const defineFramework = (
  request: DefineFrameworkRequest,
): PerformanceResult<CompetencyFrameworkState> => {
  if (!isEntityCode(request.code)) {
    return refuse('competency-framework-code-invalid', { code: request.code });
  }
  if (!Number.isInteger(request.frameworkVersion) || request.frameworkVersion < 1) {
    return refuse('competency-framework-version-invalid');
  }
  if (request.effectiveTo !== undefined && request.effectiveTo < request.effectiveFrom) {
    return refuse('competency-framework-period-inverted');
  }

  return accept({
    frameworkId: request.frameworkId,
    code: request.code,
    frameworkVersion: request.frameworkVersion,
    name: request.name,
    weighted: request.weighted,
    effectiveFrom: request.effectiveFrom,
    active: true,
    version: 1,
    ...optional('description', request.description),
    ...optional('effectiveTo', request.effectiveTo),
  });
};

export const defineCompetency = (
  framework: CompetencyFrameworkState,
  request: DefineCompetencyRequest,
): PerformanceResult<DefinedCompetency> => {
  const checked = validateCompetency(framework, request);

  if (!checked.ok) return checked;

  return accept({
    competency: {
      competencyId: request.competencyId,
      frameworkId: framework.frameworkId,
      code: request.code,
      name: request.name,
      category: checked.value,
      displayOrder: request.displayOrder,
      active: true,
      version: 1,
      ...optional('description', request.description),
      ...optional('weightBasisPoints', request.weightBasisPoints),
    },
    levels: [...request.levels]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((level) => ({
        competencyLevelId: level.competencyLevelId,
        competencyId: request.competencyId,
        ordinal: level.ordinal,
        name: level.name,
        behaviouralIndicators: level.behaviouralIndicators ?? [],
        score: level.score,
        version: 1,
      })),
  });
};

const validateCompetency = (
  framework: CompetencyFrameworkState,
  request: DefineCompetencyRequest,
): PerformanceResult<CompetencyCategory> => {
  if (!framework.active) return refuse('competency-framework-retired');
  if (!isEntityCode(request.code)) return refuse('competency-code-invalid', { code: request.code });
  if (!isCompetencyCategory(request.category)) {
    return refuse('competency-category-unknown', { category: request.category });
  }

  const weight = validateWeight(framework, request.weightBasisPoints);

  if (!weight.ok) return weight;

  const levels = validateLevels(request.levels);

  return levels.ok ? accept(request.category) : levels;
};

/**
 * The one rule that makes the third scoring decision true at the point of configuration.
 *
 * A weighted framework's competencies must carry weights, because an aggregate that silently
 * treated a missing weight as equal would be inventing one. An unweighted framework's competencies
 * must not, because a weight nothing reads is a number a reader will assume is used.
 */
const validateWeight = (
  framework: CompetencyFrameworkState,
  weightBasisPoints: number | undefined,
): PerformanceResult<true> => {
  if (framework.weighted && weightBasisPoints === undefined) {
    return refuse('competency-weight-required');
  }
  if (!framework.weighted && weightBasisPoints !== undefined) {
    return refuse('competency-weight-not-permitted');
  }
  if (weightBasisPoints === undefined) return accept(true);
  if (
    !Number.isInteger(weightBasisPoints) ||
    weightBasisPoints < 0 ||
    weightBasisPoints > MAX_BASIS_POINTS
  ) {
    return refuse('competency-weight-out-of-range', { weight: String(weightBasisPoints) });
  }
  return accept(true);
};

/**
 * The behavioural levels, checked as a set.
 *
 * Distinct ordinals, and scores that rise with them. A framework whose "outstanding" level scores
 * below its "developing" one would rate somebody down for doing better, and no amount of care at
 * assessment time would recover from it.
 */
const validateLevels = (
  levels: readonly DefineCompetencyLevelRequest[],
): PerformanceResult<true> => {
  if (levels.length === 0) return refuse('competency-has-no-levels');

  const ordered = [...levels].sort((left, right) => left.ordinal - right.ordinal);

  if (new Set(ordered.map((level) => level.ordinal)).size !== ordered.length) {
    return refuse('competency-level-ordinals-duplicated');
  }
  if (ordered.some((level) => !Number.isInteger(level.score) || level.score < 0)) {
    return refuse('competency-level-score-invalid');
  }

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (previous === undefined || current === undefined) continue;
    if (current.score <= previous.score) {
      return refuse('competency-levels-not-ascending', { ordinal: String(current.ordinal) });
    }
  }

  return accept(true);
};

/**
 * Retiring a framework version. It is never edited in place: a review assessed against it must read
 * the same next year, and the completion snapshot keeps the definitions to make that so.
 */
export const retireFramework = (
  state: CompetencyFrameworkState,
  on: Date,
): PerformanceResult<CompetencyFrameworkState> => {
  if (!state.active) return refuse('competency-framework-already-retired');
  if (on < state.effectiveFrom) return refuse('competency-framework-period-inverted');

  return accept({ ...state, active: false, effectiveTo: on });
};
