import {
  ASSIGNMENT_TRANSITIONS,
  isCivilDate,
  type AssignmentSource,
  type AssignmentStatus,
} from './learning-vocabulary.js';
import { accept, refuse, type LearningResult } from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * One person being asked to learn one thing, by one date.
 *
 * **`overdue` is not a state.** It is a function of `dueOn` and today, derived on read — the same
 * position Documents takes about expiry and Performance takes about a late review, and for the same
 * reason: a stored flag needs something to move it on the right morning, `JobPort` has no adapter
 * anywhere in this repository, and a flag nothing maintains would show `assigned` for training that
 * lapsed in March while everybody believed it (ADR-0071).
 *
 * **`source` records why somebody was asked.** A queue of eleven things with no explanation is a
 * queue nobody can act on: "your manager assigned this", "the safety policy requires it", "it is part
 * of the induction path" are three different conversations. It is a column rather than an inference
 * from which foreign key is null.
 *
 * **`occurrenceKey` is what makes reconciliation idempotent** (ADR-0071). It is the civil date on
 * which the occurrence this assignment belongs to began — derived from the rule's interval, never a
 * counter — and a partial unique index over it is what makes a second reconciliation run create
 * nothing. Absent for a direct or path assignment, which recur no more than somebody asks them to.
 */

export interface AssignmentState {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  readonly source: AssignmentSource;
  /** Present when the source is `mandatory_rule`. */
  readonly mandatoryRuleId?: string;
  /** Present when the source is `learning_path`. */
  readonly pathId?: string;
  /** The occurrence this assignment belongs to. Derived civil date; see ADR-0071. */
  readonly occurrenceKey?: string;
  readonly status: AssignmentStatus;
  /** A civil date. A deadline is the same day in every time zone. */
  readonly dueOn?: string;
  readonly assignedAt: Date;
  readonly assignedBy: string;
  /** The enrolment that satisfied it, where one did. */
  readonly satisfiedByEnrolmentId?: string;
  /** The certification that satisfied it, where one did. */
  readonly satisfiedByCertificationId?: string;
  readonly satisfiedAt?: Date;
  readonly waivedAt?: Date;
  readonly waivedBy?: string;
  readonly waiverReason?: string;
  readonly cancelledAt?: Date;
  readonly cancelledBy?: string;
  readonly version: number;
}

export interface AssignRequest {
  readonly assignmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  readonly source: AssignmentSource;
  readonly mandatoryRuleId?: string;
  readonly pathId?: string;
  readonly occurrenceKey?: string;
  readonly dueOn?: string;
  readonly at: Date;
  readonly by: string;
}

const AUTO_APPROVAL = 'system:auto-approval';

/**
 * Creating an assignment, and the two things that must agree.
 *
 * A `mandatory_rule` assignment with no rule behind it could not be explained to the person who
 * received it, and a `learning_path` assignment with no path behind it could not be re-derived when
 * the path changed. The source is a claim about provenance, so the provenance has to be there.
 */
export const assign = (request: AssignRequest): LearningResult<AssignmentState> => {
  if (request.dueOn !== undefined && !isCivilDate(request.dueOn)) {
    return refuse('assignment-due-date-invalid');
  }
  if (request.occurrenceKey !== undefined && !isCivilDate(request.occurrenceKey)) {
    return refuse('assignment-occurrence-key-invalid');
  }
  if (request.source === 'mandatory_rule' && request.mandatoryRuleId === undefined) {
    return refuse('assignment-rule-required');
  }
  if (request.source === 'learning_path' && request.pathId === undefined) {
    return refuse('assignment-path-required');
  }

  return accept({
    assignmentId: request.assignmentId,
    employmentId: request.employmentId,
    courseId: request.courseId,
    source: request.source,
    status: 'assigned',
    assignedAt: request.at,
    assignedBy: request.by,
    version: 1,
    ...definedOf({
      mandatoryRuleId: request.mandatoryRuleId,
      pathId: request.pathId,
      occurrenceKey: request.occurrenceKey,
      dueOn: request.dueOn,
    }),
  });
};

const permits = (from: AssignmentStatus, to: AssignmentStatus): boolean =>
  ASSIGNMENT_TRANSITIONS[from].includes(to);

export interface SatisfyRequest {
  readonly at: Date;
  readonly enrolmentId?: string;
  readonly certificationId?: string;
}

/**
 * Satisfying an assignment names what satisfied it.
 *
 * Either a completed enrolment or an existing certification — a tenant recording that somebody
 * already holds the forklift licence the rule demands should not have to send them on the course
 * again (D-2). What is refused is satisfying it with **nothing**: an assignment closed with no
 * evidence behind it is indistinguishable from one somebody quietly dismissed, and a compliance
 * report built on those would be worthless.
 */
export const satisfyAssignment = (
  state: AssignmentState,
  request: SatisfyRequest,
): LearningResult<AssignmentState> => {
  if (!permits(state.status, 'satisfied')) {
    return refuse('assignment-transition-refused', { from: state.status, to: 'satisfied' });
  }
  if (request.enrolmentId === undefined && request.certificationId === undefined) {
    return refuse('assignment-satisfaction-requires-evidence');
  }

  return accept({
    ...state,
    status: 'satisfied',
    satisfiedAt: request.at,
    ...definedOf({
      satisfiedByEnrolmentId: request.enrolmentId,
      satisfiedByCertificationId: request.certificationId,
    }),
  });
};

/**
 * Waiving is a named human excusing a named person from a named requirement, in writing.
 *
 * The reason is mandatory and the waiver's author is recorded, because this is the one place in the
 * module where somebody is let off a compliance obligation. An auditor a year later must be able to
 * ask who decided and why, and `system:auto-approval` is refused for the seventh time in this
 * product: nothing waives safety training on its own.
 */
export const waiveAssignment = (
  state: AssignmentState,
  at: Date,
  by: string,
  reason: string,
): LearningResult<AssignmentState> => {
  if (!permits(state.status, 'waived')) {
    return refuse('assignment-transition-refused', { from: state.status, to: 'waived' });
  }
  if (reason.trim().length === 0) return refuse('assignment-waiver-reason-required');
  if (by === AUTO_APPROVAL) return refuse('assignment-waiver-not-human');

  return accept({ ...state, status: 'waived', waivedAt: at, waivedBy: by, waiverReason: reason });
};

/** Cancelling withdraws the request itself — the rule was retired, or it never applied. */
export const cancelAssignment = (
  state: AssignmentState,
  at: Date,
  by: string,
): LearningResult<AssignmentState> => {
  if (!permits(state.status, 'cancelled')) {
    return refuse('assignment-transition-refused', { from: state.status, to: 'cancelled' });
  }

  return accept({ ...state, status: 'cancelled', cancelledAt: at, cancelledBy: by });
};

/**
 * Whether an assignment is overdue — **derived, never stored** (ADR-0071).
 *
 * An assignment already satisfied, waived or cancelled is never overdue whatever its date says: the
 * status is checked first, because training completed in January against a February deadline is
 * exactly the case a bare date comparison gets wrong.
 */
export const isOverdue = (
  state: Pick<AssignmentState, 'status' | 'dueOn'>,
  today: string,
): boolean => state.status === 'assigned' && state.dueOn !== undefined && state.dueOn < today;
