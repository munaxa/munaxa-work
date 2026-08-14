import {
  CAREER_PATH_TRANSITIONS,
  MAX_STAGE_SEQUENCE,
  isCivilDate,
  isWholeWithin,
  type CareerPathKind,
  type CareerPathStatus,
} from './career-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type CareerResult,
  type LocalizedName,
} from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * A career path: the progression of roles a tenant says somebody can plan towards, and the stages
 * along it.
 *
 * **A stage's sequence is an order, not a gate** (D-17). Nothing in this module enforces progression
 * — a plan may target stage four without having passed through stages two and three, and no command
 * refuses it. Prerequisites were never specified, and enforcing an unspecified one would block a
 * real career on a rule nobody wrote. Learning took the same position on path steps, and for the
 * same reason.
 *
 * **A stage may name a position, and stores nothing about it.** `targetPositionId` is Organization's
 * identifier and nothing more: no title, no grade, and above all no criticality (ADR-0072). A screen
 * that wants those asks Organization.
 *
 * **Archival is terminal and it is not deletion.** A career plan created against this path in 2024
 * still names it, and removing the path would make the plan unexplainable — the same reasoning that
 * keeps an archived Learning course in the catalogue.
 */

export interface CareerStageState {
  readonly stageId: string;
  readonly pathId: string;
  /** Position in the path. An order, never a prerequisite. */
  readonly sequence: number;
  readonly name: LocalizedName;
  /** Organization's identifier, where the tenant named one. Career stores nothing else about it. */
  readonly targetPositionId?: string;
}

export interface CareerPathState {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: CareerPathKind;
  readonly status: CareerPathStatus;
  /** Configuration is effective-dated; a plan is not (D-11, Phase 13 D-28). Civil dates. */
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly archivedAt?: Date;
  readonly archivedBy?: string;
  readonly version: number;
}

export interface CreatePathRequest {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: CareerPathKind;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export const createPath = (request: CreatePathRequest): CareerResult<CareerPathState> => {
  if (!isLocalizedName(request.name)) return refuse('path-name-required');
  // **Both days are checked before they are compared**, and the comparison alone is not enough. Two
  // strings order fine whether or not either names a day that exists, so `2026-02-30` would pass
  // the period rule, reach a `date` column and come back as a driver error — a 500 for what is
  // plainly a bad request. `isCivilDate` parses and compares the result back to the string, which
  // is what refuses a February thirtieth rather than rolling it into March.
  if (!isCivilDate(request.effectiveFrom)) return refuse('path-effective-from-invalid');
  if (request.effectiveTo !== undefined && !isCivilDate(request.effectiveTo)) {
    return refuse('path-effective-to-invalid');
  }
  if (request.effectiveTo !== undefined && request.effectiveTo <= request.effectiveFrom) {
    return refuse('path-effective-period-invalid');
  }

  return accept({
    pathId: request.pathId,
    code: request.code,
    name: request.name,
    kind: request.kind,
    status: 'draft',
    effectiveFrom: request.effectiveFrom,
    version: 1,
    ...definedOf({ description: request.description, effectiveTo: request.effectiveTo }),
  });
};

const permits = (from: CareerPathStatus, to: CareerPathStatus): boolean =>
  CAREER_PATH_TRANSITIONS[from].includes(to);

/**
 * Publishing a path, which makes it something a plan may be created against.
 *
 * **A path with no stages publishes nothing.** It describes no progression at all, and a plan
 * targeting it could name no stage — the same emptiness Learning refuses when publishing a path
 * with no steps.
 */
export const publishPath = (
  state: CareerPathState,
  stageCount: number,
): CareerResult<CareerPathState> => {
  if (!permits(state.status, 'published')) return refuse('path-transition-refused');
  if (stageCount === 0) return refuse('path-has-no-stages');

  return accept({ ...state, status: 'published' });
};

export const archivePath = (
  state: CareerPathState,
  at: Date,
  by: string,
): CareerResult<CareerPathState> => {
  if (!permits(state.status, 'archived')) return refuse('path-transition-refused');

  return accept({ ...state, status: 'archived', archivedAt: at, archivedBy: by });
};

export interface AddStageRequest {
  readonly stageId: string;
  readonly pathId: string;
  readonly sequence: number;
  readonly name: LocalizedName;
  readonly targetPositionId?: string;
}

/**
 * Adding a stage to a path.
 *
 * Refused on an archived path: archival is terminal, and a stage added afterwards would change what
 * a historical plan was planning towards.
 */
export const addStage = (
  path: CareerPathState,
  request: AddStageRequest,
): CareerResult<CareerStageState> => {
  if (path.status === 'archived') return refuse('path-archived');
  if (!isWholeWithin(request.sequence, 1, MAX_STAGE_SEQUENCE)) {
    return refuse('stage-sequence-invalid');
  }
  if (!isLocalizedName(request.name)) return refuse('stage-name-required');

  return accept({
    stageId: request.stageId,
    pathId: path.pathId,
    sequence: request.sequence,
    name: request.name,
    ...definedOf({ targetPositionId: request.targetPositionId }),
  });
};

/**
 * Whether a path is in force on a civil day.
 *
 * Derived, never stored — the same treatment Learning gives certificate validity. A path effective
 * from next quarter is configuration somebody has already written down, and it is not yet something
 * a plan may be created against.
 */
export const isInForce = (state: CareerPathState, on: string): boolean =>
  state.effectiveFrom <= on && (state.effectiveTo === undefined || on <= state.effectiveTo);
