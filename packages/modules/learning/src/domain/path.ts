import { isCode, isWholeWithin, type PathKind, type PathStatus } from './learning-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type LearningResult,
  type LocalizedName,
} from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * An ordered set of courses a tenant grouped together, and nothing cleverer than that.
 *
 * **A path recommends; it does not certify** (AD-002). Finishing every course in a leadership path
 * says somebody attended those courses. It does not say they are competent to lead, and this module
 * writes no `competency_id` anywhere — `person_capability` holds what somebody claims,
 * `performance_competency` holds what a manager observed of the job, and neither is inferable from
 * attendance.
 *
 * **`kind` is a label and nothing branches on it** (AD-003). A `certification` path is not treated
 * differently from a `custom` one anywhere in this module; the word is documentation of the tenant's
 * own filing, and a product that acted on it would be acting on the customer's taxonomy.
 *
 * **`sequence` is an order, not a gate.** The steps say what a tenant intends somebody to do first;
 * nothing here refuses an enrolment because an earlier step is unfinished. Prerequisites were not
 * specified, and enforcing an unspecified one would block real people from real training on a rule
 * nobody wrote.
 */

export interface PathState {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: PathKind;
  readonly status: PathStatus;
  readonly stepCount: number;
  readonly archivedAt?: Date;
  readonly archivedBy?: string;
  readonly version: number;
}

export interface CreatePathRequest {
  readonly pathId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly description?: LocalizedName;
  readonly kind: PathKind;
}

export const createPath = (request: CreatePathRequest): LearningResult<PathState> => {
  if (!isCode(request.code)) return refuse('path-code-invalid', { code: request.code });
  if (!isLocalizedName(request.name)) return refuse('path-name-required');
  if (request.description !== undefined && !isLocalizedName(request.description)) {
    return refuse('path-description-incomplete');
  }

  return accept({
    pathId: request.pathId,
    code: request.code,
    name: request.name,
    kind: request.kind,
    status: 'draft',
    stepCount: 0,
    version: 1,
    ...definedOf({ description: request.description }),
  });
};

/** One course's place in a path. `optional` is the tenant's own distinction, recorded not enforced. */
export interface PathStepState {
  readonly stepId: string;
  readonly pathId: string;
  readonly courseId: string;
  readonly sequence: number;
  readonly optional: boolean;
  readonly version: number;
}

export interface AddStepRequest {
  readonly stepId: string;
  readonly pathId: string;
  readonly courseId: string;
  readonly sequence: number;
  readonly optional: boolean;
}

const MAX_SEQUENCE = 500;

export const addStep = (request: AddStepRequest): LearningResult<PathStepState> => {
  if (!isWholeWithin(request.sequence, 1, MAX_SEQUENCE)) {
    return refuse('path-step-sequence-invalid');
  }

  return accept({
    stepId: request.stepId,
    pathId: request.pathId,
    courseId: request.courseId,
    sequence: request.sequence,
    optional: request.optional,
    version: 1,
  });
};

/**
 * A path with no steps publishes nothing.
 *
 * Publishing is what makes a path assignable, and assigning an empty path would put a requirement on
 * somebody's queue that they could satisfy by doing nothing at all.
 */
export const publishPath = (state: PathState, stepCount: number): LearningResult<PathState> => {
  if (state.status === 'archived') return refuse('path-archived', { pathId: state.pathId });
  if (stepCount < 1) return refuse('path-requires-steps');

  return accept({ ...state, status: 'published', stepCount });
};

export const archivePath = (state: PathState, at: Date, by: string): LearningResult<PathState> => {
  if (state.status === 'archived') return refuse('path-already-archived');

  return accept({ ...state, status: 'archived', archivedAt: at, archivedBy: by });
};

/**
 * How far somebody has got along a path — **derived on read from their completions**.
 *
 * Not a stored counter. A stored one would need updating from every completion, every withdrawal and
 * every change to the path's steps, and the first missed update would leave a screen confidently
 * showing 4 of 6 for somebody who had done two. Counting is cheap; a wrong count is not.
 *
 * Optional steps are counted separately rather than folded in, because "finished the path" and
 * "finished everything in the path" are different sentences and a tenant marked those steps optional
 * for a reason.
 */
export interface PathProgress {
  readonly requiredTotal: number;
  readonly requiredCompleted: number;
  readonly optionalTotal: number;
  readonly optionalCompleted: number;
  readonly complete: boolean;
}

export const progressOf = (
  steps: readonly Pick<PathStepState, 'courseId' | 'optional'>[],
  completedCourseIds: ReadonlySet<string>,
): PathProgress => {
  const required = steps.filter((step) => !step.optional);
  const optional = steps.filter((step) => step.optional);
  const done = (items: readonly Pick<PathStepState, 'courseId'>[]): number =>
    items.filter((step) => completedCourseIds.has(step.courseId)).length;
  const requiredCompleted = done(required);

  return {
    requiredTotal: required.length,
    requiredCompleted,
    optionalTotal: optional.length,
    optionalCompleted: done(optional),
    // An empty path is not complete. Publishing refuses one, and this refuses to flatter it.
    complete: required.length > 0 && requiredCompleted === required.length,
  };
};
