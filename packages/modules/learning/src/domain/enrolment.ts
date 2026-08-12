import {
  ENROLMENT_TRANSITIONS,
  isCivilDate,
  isEnrolmentClosed,
  type EnrolmentStatus,
} from './learning-vocabulary.js';
import { accept, refuse, type LearningResult } from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * One employment's participation in one version of one course.
 *
 * **It references a course *version*, not a course.** That single choice is what makes §12's
 * requirement hold: publish version 4 tomorrow and this enrolment still names version 3, which is
 * still readable and can never be edited. A completed enrolment therefore describes what was
 * actually completed, without needing the snapshot a review needs — the version row is already
 * immutable, so there is nothing to freeze a second time (D-7).
 *
 * **Enrolling is not completing.** They are separate states reached by separate commands, and
 * nothing moves between them on its own. `in_progress` is somebody having started; `completed` is an
 * authorized human recording that they finished.
 *
 * **Completion is immutable.** A completed enrolment has no outgoing transition: the domain refuses
 * it, and a database trigger refuses it again. A correction is a new enrolment, exactly as a
 * correction to an issued letter is a new letter and a correction to a finalized payroll is a
 * reversal. What somebody completed is a thing that happened.
 *
 * **Withdrawing is not failing.** A compliance report that could not tell "left the course" from
 * "did not pass it" would describe two very different people identically.
 */

export interface EnrolmentState {
  readonly enrolmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  /** Pinned at enrolment. The reason history stays reproducible without a snapshot. */
  readonly courseVersionId: string;
  /** Present when this enrolment satisfies an assignment. */
  readonly assignmentId?: string;
  readonly status: EnrolmentStatus;
  readonly enrolledAt: Date;
  readonly enrolledBy: string;
  readonly startedAt?: Date;
  readonly completedAt?: Date;
  /**
   * The civil date the course was completed on.
   *
   * Separate from `completedAt` because they answer different questions: the instant is when the
   * record was written, and the date is the day the person finished — which is what the recurrence
   * arithmetic reads, and a due date computed from an instant would move with the reader's timezone.
   */
  readonly completedOn?: string;
  readonly completedBy?: string;
  readonly outcomeNote?: string;
  readonly version: number;
}

export interface EnrolRequest {
  readonly enrolmentId: string;
  readonly employmentId: string;
  readonly courseId: string;
  readonly courseVersionId: string;
  readonly assignmentId?: string;
  readonly at: Date;
  readonly by: string;
}

export const enrol = (request: EnrolRequest): LearningResult<EnrolmentState> =>
  accept({
    enrolmentId: request.enrolmentId,
    employmentId: request.employmentId,
    courseId: request.courseId,
    courseVersionId: request.courseVersionId,
    status: 'enrolled',
    enrolledAt: request.at,
    enrolledBy: request.by,
    version: 1,
    ...definedOf({ assignmentId: request.assignmentId }),
  });

const permits = (from: EnrolmentStatus, to: EnrolmentStatus): boolean =>
  ENROLMENT_TRANSITIONS[from].includes(to);

export const startEnrolment = (state: EnrolmentState, at: Date): LearningResult<EnrolmentState> => {
  if (!permits(state.status, 'in_progress')) {
    return refuse('enrolment-transition-refused', { from: state.status, to: 'in_progress' });
  }

  return accept({ ...state, status: 'in_progress', startedAt: at });
};

/** The auto-approver decides nothing here, as it decides nothing in six modules before this one. */
const AUTO_APPROVAL = 'system:auto-approval';

export interface CompleteRequest {
  readonly at: Date;
  /** The civil date they finished. Defaults to nothing: the caller states it, never the clock. */
  readonly on: string;
  readonly by: string;
  /** Whether the course version this enrolment pins requires a passed assessment. */
  readonly requiresAssessment: boolean;
  /** Whether a passed assessment result exists for it. */
  readonly hasPassedAssessment: boolean;
  readonly outcomeNote?: string;
}

/**
 * Completion, and the two things it refuses.
 *
 * **A named human completes a course.** `system:auto-approval` is refused here, by a check
 * constraint at the table, and for the same reason it is refused in six previous modules: a
 * completion is somebody's statement that another person finished, and a completion with nobody's
 * name against it cannot be questioned later by the person it belongs to.
 *
 * **An assessment requirement is the tenant's, and it binds.** Where the course version says an
 * assessment is required, completion needs a passed outcome. This product decides neither what
 * passing means nor how it is scored — the specification defines no threshold and none was invented
 * — it enforces the configuration the tenant set and records the outcome an authorized assessor
 * gave.
 */
export const completeEnrolment = (
  state: EnrolmentState,
  request: CompleteRequest,
): LearningResult<EnrolmentState> => {
  if (!permits(state.status, 'completed')) {
    return refuse('enrolment-transition-refused', { from: state.status, to: 'completed' });
  }
  if (!isCivilDate(request.on)) return refuse('completion-date-invalid');
  if (request.by === AUTO_APPROVAL) return refuse('completion-not-human');
  if (request.requiresAssessment && !request.hasPassedAssessment) {
    return refuse('completion-requires-assessment');
  }

  return accept({
    ...state,
    status: 'completed',
    completedAt: request.at,
    completedOn: request.on,
    completedBy: request.by,
    ...definedOf({ outcomeNote: request.outcomeNote }),
  });
};

export const failEnrolment = (
  state: EnrolmentState,
  at: Date,
  by: string,
  note?: string,
): LearningResult<EnrolmentState> => {
  if (!permits(state.status, 'failed')) {
    return refuse('enrolment-transition-refused', { from: state.status, to: 'failed' });
  }
  if (by === AUTO_APPROVAL) return refuse('completion-not-human');

  return accept({
    ...state,
    status: 'failed',
    completedAt: at,
    completedBy: by,
    ...definedOf({ outcomeNote: note }),
  });
};

export const withdrawEnrolment = (
  state: EnrolmentState,
  at: Date,
  note?: string,
): LearningResult<EnrolmentState> => {
  if (!permits(state.status, 'withdrawn')) {
    return refuse('enrolment-transition-refused', { from: state.status, to: 'withdrawn' });
  }

  return accept({
    ...state,
    status: 'withdrawn',
    completedAt: at,
    ...definedOf({ outcomeNote: note }),
  });
};

/** Whether this enrolment has ended, whichever way it ended. */
export const hasEnded = (state: EnrolmentState): boolean => isEnrolmentClosed(state.status);
