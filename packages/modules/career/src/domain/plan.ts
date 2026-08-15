import {
  CAREER_PLAN_TRANSITIONS,
  isCivilDate,
  type CareerPlanStatus,
} from './career-vocabulary.js';
import { accept, refuse, type CareerResult } from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * One person's career plan: where they are, where they are heading, and how it ended.
 *
 * **A plan names an employment, never a person** (AD-001). Everything about who that is — their
 * name, their manager, whether they still work here — is Employment's and People's, read through
 * published contracts when a screen needs it.
 *
 * **A path is optional** (D-18). A tenant may plan somebody towards a target stage without
 * committing to a whole published path, and requiring one would make an ad-hoc plan impossible to
 * record. Where a path *is* named, the stages come from it.
 *
 * **Nothing enforces stage progression** (D-17). A plan may target any stage on its path from any
 * current stage, because a sequence is an order and not a prerequisite.
 *
 * **`achieved` and `abandoned` are both endings, and both are kept.** "We planned this and they got
 * there" and "we planned this and stopped" are different answers a year later, and a single
 * terminal state would lose the second. Neither reopens: a new intention is a new plan, so the
 * record of what was intended before stays intact.
 */

export interface CareerPlanState {
  readonly careerPlanId: string;
  readonly employmentId: string;
  /** Optional (D-18). A plan may target a stage without naming a whole path. */
  readonly pathId?: string;
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly status: CareerPlanStatus;
  /** A civil date. The day the plan was written, not the instant it was typed. */
  readonly startedOn: string;
  readonly targetDate?: string;
  readonly notes?: string;
  readonly closedOn?: string;
  readonly closedBy?: string;
  readonly version: number;
}

export interface CreateCareerPlanRequest {
  readonly careerPlanId: string;
  readonly employmentId: string;
  readonly pathId?: string;
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly startedOn: string;
  readonly targetDate?: string;
  readonly notes?: string;
}

/**
 * Creating a plan.
 *
 * A stage may only be named where a path is: a `targetStageId` with no `pathId` names a stage
 * belonging to a path this plan does not claim, and nothing could later check that the two agree.
 */
export const createCareerPlan = (
  request: CreateCareerPlanRequest,
): CareerResult<CareerPlanState> => {
  if (!isCivilDate(request.startedOn)) return refuse('plan-start-date-invalid');
  if (request.targetDate !== undefined && !isCivilDate(request.targetDate)) {
    return refuse('plan-target-date-invalid');
  }
  if (request.targetDate !== undefined && request.targetDate < request.startedOn) {
    return refuse('plan-target-before-start');
  }
  if (request.pathId === undefined && namesAStage(request))
    return refuse('plan-stage-without-path');

  return accept({
    careerPlanId: request.careerPlanId,
    employmentId: request.employmentId,
    status: 'draft',
    startedOn: request.startedOn,
    version: 1,
    ...definedOf({
      pathId: request.pathId,
      currentStageId: request.currentStageId,
      targetStageId: request.targetStageId,
      targetDate: request.targetDate,
      notes: request.notes,
    }),
  });
};

const namesAStage = (request: CreateCareerPlanRequest): boolean =>
  request.currentStageId !== undefined || request.targetStageId !== undefined;

const permits = (from: CareerPlanStatus, to: CareerPlanStatus): boolean =>
  CAREER_PLAN_TRANSITIONS[from].includes(to);

export interface AmendCareerPlanRequest {
  readonly currentStageId?: string;
  readonly targetStageId?: string;
  readonly targetDate?: string;
  readonly notes?: string;
}

/**
 * Amending a plan that has not ended.
 *
 * `employmentId`, `pathId` and `startedOn` are absent deliberately. A plan is *this person's* plan
 * along *this* path from *that* day; changing any of the three would silently make it a different
 * plan while keeping its history, and the honest way to do that is to abandon this one and write a
 * new one.
 */
export const amendCareerPlan = (
  state: CareerPlanState,
  request: AmendCareerPlanRequest,
): CareerResult<CareerPlanState> => {
  if (CAREER_PLAN_TRANSITIONS[state.status].length === 0) return refuse('plan-closed');
  if (request.targetDate !== undefined && !isCivilDate(request.targetDate)) {
    return refuse('plan-target-date-invalid');
  }
  if (request.targetDate !== undefined && request.targetDate < state.startedOn) {
    return refuse('plan-target-before-start');
  }
  if (state.pathId === undefined && amendmentNamesAStage(request)) {
    return refuse('plan-stage-without-path');
  }

  return accept({
    ...state,
    ...definedOf({
      currentStageId: request.currentStageId,
      targetStageId: request.targetStageId,
      targetDate: request.targetDate,
      notes: request.notes,
    }),
  });
};

const amendmentNamesAStage = (request: AmendCareerPlanRequest): boolean =>
  request.currentStageId !== undefined || request.targetStageId !== undefined;

export interface CloseCareerPlanRequest {
  readonly to: CareerPlanStatus;
  readonly on: string;
  readonly by: string;
}

/**
 * Moving a plan, including to one of its endings.
 *
 * The civil day is required on a closure and refused on an activation: "when did they achieve it"
 * is a question somebody asks, and "when did the plan become active" is the day it was written.
 */
export const moveCareerPlan = (
  state: CareerPlanState,
  request: CloseCareerPlanRequest,
): CareerResult<CareerPlanState> => {
  if (!permits(state.status, request.to)) return refuse('plan-transition-refused');
  if (!isCivilDate(request.on)) return refuse('plan-close-date-invalid');
  if (request.to === 'active') return accept({ ...state, status: 'active' });

  return accept({ ...state, status: request.to, closedOn: request.on, closedBy: request.by });
};
