import {
  AUTO_APPROVAL,
  DEVELOPMENT_ITEM_TRANSITIONS,
  DEVELOPMENT_PLAN_TRANSITIONS,
  isCivilDate,
  type DevelopmentCategory,
  type DevelopmentItemKind,
  type DevelopmentItemStatus,
  type DevelopmentPlanStatus,
} from './career-vocabulary.js';
import { accept, refuse, type CareerResult } from './career-rejection.js';
import { definedOf } from './defined.js';

/**
 * A development plan and the items on it.
 *
 * **A course-shaped item is a reference to Learning, and Career keeps no status for it**
 * (ADR-0073, AD-006). An item of kind `course` carries a `learningAssignmentId`, and this module
 * refuses to start, complete or cancel it: whether somebody finished a course is Learning's answer,
 * already stored in `learning_enrolment`, and a second copy here would be the one that goes stale.
 * The refusal is the boundary made executable rather than described — `startItem` and `completeItem`
 * return `item-owned-by-learning`, and a screen reads the real status through
 * `learning.search-assignments`.
 *
 * What Career genuinely owns is everything Learning has no concept of: **coaching, mentoring,
 * projects, stretch assignments** and the target dates against them. Those have no owner anywhere in
 * this repository, and they are the reason a development plan is a Career aggregate at all.
 *
 * **The 70-20-10 mix is `NOT VERIFIED`** (ADR-0074, D-12). An item carries a category because that
 * is a fact somebody states about it, and `categoryCountsOf` counts them. There is no target, no
 * tolerance, no percentage, no verdict and no validation anywhere in this file. The specification
 * gives a default weighting and the word "validated" and defines neither the rule, nor the
 * tolerance, nor how contribution is measured, nor what an uncategorized item does — so a plan is
 * never refused for being unbalanced, and no field here could be mistaken for a balance.
 *
 * **Joint ownership is `NOT VERIFIED`** (D-9). The specification asks for a plan "jointly owned by
 * the employee and the manager", and this product cannot identify either: there is no
 * principal → employment resolution (ADR-0032). So the plan records *acknowledgements* — that an
 * administrator recorded the employee acknowledged it, and that the manager did — each with the
 * authenticated actor's name and a civil day. It does not claim either person pressed a button,
 * because neither can sign in.
 */

export interface DevelopmentPlanState {
  readonly developmentPlanId: string;
  readonly employmentId: string;
  /** The career plan this supports, where it supports one. Optional, as a career plan is (D-18). */
  readonly careerPlanId?: string;
  /** The tenant's own label for the round this belongs to. A string they wrote; nothing parses it. */
  readonly cycleLabel?: string;
  readonly status: DevelopmentPlanStatus;
  readonly startedOn: string;
  readonly targetDate?: string;
  /** Recorded by an administrator. **Not a signature** — see the file note and D-9. */
  readonly employeeAcknowledgedOn?: string;
  readonly employeeAcknowledgementRecordedBy?: string;
  readonly managerAcknowledgedOn?: string;
  readonly managerAcknowledgementRecordedBy?: string;
  readonly closedOn?: string;
  readonly closedBy?: string;
  readonly version: number;
}

/**
 * One thing somebody is going to do.
 *
 * `learningAssignmentId` is present exactly when `kind` is `course`, and it is the whole of what
 * Career stores about that course: no title, no completion date, no progress.
 */
export interface DevelopmentItemState {
  readonly developmentItemId: string;
  readonly developmentPlanId: string;
  readonly category: DevelopmentCategory;
  readonly kind: DevelopmentItemKind;
  readonly title: string;
  /** Learning's identifier, for a `course` item. Career keeps no status of its own for one. */
  readonly learningAssignmentId?: string;
  readonly targetDate?: string;
  readonly status: DevelopmentItemStatus;
  readonly completedOn?: string;
  readonly completedBy?: string;
  readonly version: number;
}

export interface CreateDevelopmentPlanRequest {
  readonly developmentPlanId: string;
  readonly employmentId: string;
  readonly careerPlanId?: string;
  readonly cycleLabel?: string;
  readonly startedOn: string;
  readonly targetDate?: string;
}

export const createDevelopmentPlan = (
  request: CreateDevelopmentPlanRequest,
): CareerResult<DevelopmentPlanState> => {
  if (!isCivilDate(request.startedOn)) return refuse('development-start-date-invalid');
  if (request.targetDate !== undefined && !isCivilDate(request.targetDate)) {
    return refuse('development-target-date-invalid');
  }
  if (request.targetDate !== undefined && request.targetDate < request.startedOn) {
    return refuse('development-target-before-start');
  }

  return accept({
    developmentPlanId: request.developmentPlanId,
    employmentId: request.employmentId,
    status: 'draft',
    startedOn: request.startedOn,
    version: 1,
    ...definedOf({
      careerPlanId: request.careerPlanId,
      cycleLabel: request.cycleLabel,
      targetDate: request.targetDate,
    }),
  });
};

const planPermits = (from: DevelopmentPlanStatus, to: DevelopmentPlanStatus): boolean =>
  DEVELOPMENT_PLAN_TRANSITIONS[from].includes(to);

export interface MoveDevelopmentPlanRequest {
  readonly to: DevelopmentPlanStatus;
  readonly on: string;
  readonly by: string;
}

/**
 * Moving a plan.
 *
 * **A plan with nothing on it activates nothing** — an empty development plan presented as active
 * reads as "we have a plan for this person" when nobody has written one down.
 */
export const moveDevelopmentPlan = (
  state: DevelopmentPlanState,
  itemCount: number,
  request: MoveDevelopmentPlanRequest,
): CareerResult<DevelopmentPlanState> => {
  if (!planPermits(state.status, request.to)) return refuse('development-transition-refused');
  if (!isCivilDate(request.on)) return refuse('development-move-date-invalid');
  if (request.to === 'active' && itemCount === 0) return refuse('development-plan-has-no-items');
  if (request.to === 'active') return accept({ ...state, status: 'active' });

  return accept({ ...state, status: request.to, closedOn: request.on, closedBy: request.by });
};

/**
 * The two parties whose acknowledgement a development plan records.
 *
 * A runtime list rather than a bare union, because the edge has to reject a third value at the wire
 * before it becomes a command — and a union alone is gone by then. It names *which party
 * acknowledged*, which is a fact somebody records; it is never an assertion about who is calling
 * (D-9), because this repository cannot resolve a principal to an employment.
 */
export const ACKNOWLEDGERS = ['employee', 'manager'] as const;
export type Acknowledger = (typeof ACKNOWLEDGERS)[number];

export interface AcknowledgeRequest {
  readonly by: Acknowledger;
  readonly on: string;
  readonly recordedBy: string;
}

/**
 * Recording that somebody acknowledged the plan.
 *
 * **This is not a signature and the field names say so.** `employeeAcknowledgementRecordedBy` is the
 * authenticated administrator who wrote it down, because the employee cannot sign in: there is no
 * principal → employment resolution in this product (ADR-0032, D-9). Naming the field
 * `employeeSignedBy` would claim something the platform cannot deliver.
 *
 * An acknowledgement is recorded once. A second one would overwrite the day the first recorded, and
 * that day is the historical fact.
 */
export const acknowledgeDevelopmentPlan = (
  state: DevelopmentPlanState,
  request: AcknowledgeRequest,
): CareerResult<DevelopmentPlanState> => {
  if (!isCivilDate(request.on)) return refuse('acknowledgement-date-invalid');
  if (request.recordedBy === AUTO_APPROVAL) return refuse('acknowledgement-requires-a-person');
  if (alreadyAcknowledged(state, request.by)) return refuse('already-acknowledged');

  return accept(
    request.by === 'employee'
      ? {
          ...state,
          employeeAcknowledgedOn: request.on,
          employeeAcknowledgementRecordedBy: request.recordedBy,
        }
      : {
          ...state,
          managerAcknowledgedOn: request.on,
          managerAcknowledgementRecordedBy: request.recordedBy,
        },
  );
};

const alreadyAcknowledged = (state: DevelopmentPlanState, by: Acknowledger): boolean =>
  by === 'employee'
    ? state.employeeAcknowledgedOn !== undefined
    : state.managerAcknowledgedOn !== undefined;

export interface AddItemRequest {
  readonly developmentItemId: string;
  readonly category: DevelopmentCategory;
  readonly kind: DevelopmentItemKind;
  readonly title: string;
  readonly learningAssignmentId?: string;
  readonly targetDate?: string;
}

/**
 * Adding an item.
 *
 * A `course` item must name a Learning assignment, and only a `course` item may: the identifier is
 * what makes it a reference rather than a copy, and putting one on a coaching item would claim a
 * relationship Learning knows nothing about.
 */
export const addDevelopmentItem = (
  plan: DevelopmentPlanState,
  request: AddItemRequest,
): CareerResult<DevelopmentItemState> => {
  if (plan.status === 'completed' || plan.status === 'abandoned')
    return refuse('development-plan-closed');
  if (request.title.trim().length === 0) return refuse('development-item-title-required');
  if (request.kind === 'course' && request.learningAssignmentId === undefined) {
    return refuse('course-item-requires-a-learning-assignment');
  }
  if (request.kind !== 'course' && request.learningAssignmentId !== undefined) {
    return refuse('only-a-course-item-references-learning');
  }
  if (request.targetDate !== undefined && !isCivilDate(request.targetDate)) {
    return refuse('development-item-target-date-invalid');
  }

  return accept({
    developmentItemId: request.developmentItemId,
    developmentPlanId: plan.developmentPlanId,
    category: request.category,
    kind: request.kind,
    title: request.title,
    status: 'planned',
    version: 1,
    ...definedOf({
      learningAssignmentId: request.learningAssignmentId,
      targetDate: request.targetDate,
    }),
  });
};

export interface MoveItemRequest {
  readonly to: DevelopmentItemStatus;
  readonly on: string;
  readonly by: string;
}

/**
 * Moving an item — and refusing to move one Learning owns.
 *
 * This is ADR-0073 made executable. An item that references a `learningAssignmentId` takes its
 * progress from Learning; recording `completed` here would be Career storing a second answer to
 * "did they finish the course", and the two would disagree the first time somebody withdrew from
 * the enrolment.
 */
export const moveDevelopmentItem = (
  state: DevelopmentItemState,
  request: MoveItemRequest,
): CareerResult<DevelopmentItemState> => {
  if (state.learningAssignmentId !== undefined) return refuse('item-owned-by-learning');
  if (!DEVELOPMENT_ITEM_TRANSITIONS[state.status].includes(request.to)) {
    return refuse('development-item-transition-refused');
  }
  if (!isCivilDate(request.on)) return refuse('development-item-date-invalid');
  if (request.to !== 'completed') return accept({ ...state, status: request.to });

  return accept({
    ...state,
    status: 'completed',
    completedOn: request.on,
    completedBy: request.by,
  });
};

export interface CategoryCounts {
  readonly experience: number;
  readonly exposure: number;
  readonly education: number;
}

/**
 * How many items sit in each category.
 *
 * **A count, and deliberately nothing more.** No percentage, no target, no tolerance and no verdict:
 * the 70-20-10 model the specification names has no validation rule attached to it, and the
 * parameters were not supplied (D-12). A tenant reading these three numbers can judge the balance
 * themselves; this product does not judge it for them, and no field it returns could be mistaken
 * for a judgement.
 *
 * Counting items rather than hours or effort is itself the un-specified choice — which is exactly
 * why it feeds no rule. It is a tally of rows a screen displays beside the items it counted.
 */
export const categoryCountsOf = (items: readonly DevelopmentItemState[]): CategoryCounts => ({
  experience: items.filter((item) => item.category === 'experience').length,
  exposure: items.filter((item) => item.category === 'exposure').length,
  education: items.filter((item) => item.category === 'education').length,
});

/**
 * Whether an item's target date has passed, on the day somebody asked.
 *
 * Derived and never stored, and it notifies nobody. A cancelled or completed item is never overdue.
 */
export const isOverdue = (state: DevelopmentItemState, on: string): boolean =>
  state.targetDate !== undefined &&
  state.targetDate < on &&
  state.status !== 'completed' &&
  state.status !== 'cancelled';
