import {
  ASSESSMENT_TRANSITIONS,
  MAX_BASIS_POINTS,
  isAssessmentKind,
  isExclusionReason,
  permits,
  type AssessmentKind,
  type AssessmentStatus,
  type ExclusionReason,
} from './performance-vocabulary.js';
import { accept, refuse, type PerformanceResult } from './performance-rejection.js';
import { withinScale, type RatingScaleBand } from './scoring.js';

/**
 * One assessor's assessment of one review, and the lines it is made of.
 *
 * **Separate rows per assessor and kind, never states of one record** (D-10). The specification
 * names SelfAssessment, ManagerAssessment and PeerAssessment as separate aggregate roots, and it is
 * right to: it is the only shape in which a manager cannot overwrite an employee's self-assessment,
 * because there is no column in which to do it. A final rating is then *derived* from these rather
 * than being a fourth assessment somebody types.
 *
 * **The assessor comes from the authenticated context, never from a request body.** An assessment
 * whose author is client-supplied is an assessment anybody can forge, which is why this file takes
 * the assessor as a parameter that the application layer resolves and the API layer cannot reach.
 *
 * **A draft belongs to its author; a submitted assessment belongs to the record.** Before
 * submission it may be rewritten freely. From submission the domain refuses every change, the
 * application refuses it again, and a database trigger refuses it from any path including SQL
 * nobody wrote in TypeScript.
 *
 * **An unscored line is excluded and says why.** The fifth approved scoring decision is that
 * missing or incomplete work leaves the denominator with its reason recorded, and never becomes a
 * zero — because a zero is a judgement somebody made and an absence is the fact that nobody did.
 */

export interface AssessmentItemState {
  readonly assessmentItemId: string;
  readonly assessmentId: string;
  readonly itemKind: 'goal' | 'competency';
  readonly goalId?: string;
  readonly competencyId?: string;
  readonly score?: number;
  readonly ratingLevelId?: string;
  readonly weightBasisPoints?: number;
  readonly comment?: string;
  readonly excluded: boolean;
  readonly exclusionReason?: ExclusionReason;
  readonly version: number;
}

export interface AssessmentState {
  readonly assessmentId: string;
  readonly reviewId: string;
  readonly reviewerAssignmentId?: string;
  readonly assessorEmploymentId: string;
  readonly assessmentKind: AssessmentKind;
  readonly status: AssessmentStatus;
  readonly goalScore?: number;
  readonly competencyScore?: number;
  readonly overallScore?: number;
  readonly ratingLevelId?: string;
  readonly overallComment?: string;
  readonly strengths?: string;
  readonly developmentAreas?: string;
  readonly submittedAt?: Date;
  readonly submittedBy?: string;
  readonly version: number;
}

export interface StartAssessmentRequest {
  readonly assessmentId: string;
  readonly reviewId: string;
  readonly reviewerAssignmentId?: string;
  /** Resolved from the authenticated context by the application layer. Never from a body. */
  readonly assessorEmploymentId: string;
  readonly assessmentKind: string;
}

export interface RecordItemRequest {
  readonly assessmentItemId: string;
  readonly itemKind: 'goal' | 'competency';
  readonly goalId?: string;
  readonly competencyId?: string;
  readonly score?: number;
  readonly ratingLevelId?: string;
  readonly weightBasisPoints?: number;
  readonly comment?: string;
  readonly exclusionReason?: string;
}

const optional = <TValue>(key: string, value: TValue | undefined): Record<string, TValue> =>
  value === undefined ? {} : { [key]: value };

export const startAssessment = (
  request: StartAssessmentRequest,
): PerformanceResult<AssessmentState> => {
  if (!isAssessmentKind(request.assessmentKind)) {
    return refuse('assessment-kind-unknown', { kind: request.assessmentKind });
  }

  return accept({
    assessmentId: request.assessmentId,
    reviewId: request.reviewId,
    assessorEmploymentId: request.assessorEmploymentId,
    assessmentKind: request.assessmentKind,
    status: 'draft',
    version: 1,
    ...optional('reviewerAssignmentId', request.reviewerAssignmentId),
  });
};

/**
 * One line of an assessment: a goal scored, or a competency rated, or either one recorded as not
 * assessable with the reason it was not.
 *
 * The subject is exclusive by construction — a goal line names a goal and no competency, and the
 * reverse — because a line that named both would be counted twice by an aggregate that filters on
 * kind.
 */
export const recordItem = (
  assessment: AssessmentState,
  request: RecordItemRequest,
  scale: RatingScaleBand,
): PerformanceResult<AssessmentItemState> => {
  if (assessment.status === 'submitted') return refuse('assessment-already-submitted');

  const subject = validateSubject(request);

  if (!subject.ok) return subject;

  const participation = validateParticipation(request, scale);

  if (!participation.ok) return participation;

  return accept({
    assessmentItemId: request.assessmentItemId,
    assessmentId: assessment.assessmentId,
    itemKind: request.itemKind,
    excluded: participation.value !== undefined,
    version: 1,
    ...optional('goalId', request.goalId),
    ...optional('competencyId', request.competencyId),
    ...optional('score', request.score),
    ...optional('ratingLevelId', request.ratingLevelId),
    ...optional('weightBasisPoints', request.weightBasisPoints),
    ...optional('comment', request.comment),
    ...optional('exclusionReason', participation.value),
  });
};

const validateSubject = (request: RecordItemRequest): PerformanceResult<true> => {
  const named = request.itemKind === 'goal' ? request.goalId : request.competencyId;
  const other = request.itemKind === 'goal' ? request.competencyId : request.goalId;

  if (named === undefined)
    return refuse('assessment-item-subject-missing', { kind: request.itemKind });
  if (other !== undefined) return refuse('assessment-item-subject-ambiguous');

  return accept(true);
};

/**
 * Whether this line participates, and what is recorded when it does not.
 *
 * An excluded line carries no score, because a score on a line that leaves the denominator is a
 * number that will eventually be read by something that does not know to ignore it.
 */
const validateParticipation = (
  request: RecordItemRequest,
  scale: RatingScaleBand,
): PerformanceResult<ExclusionReason | undefined> => {
  if (request.exclusionReason !== undefined) {
    if (!isExclusionReason(request.exclusionReason)) {
      return refuse('assessment-item-exclusion-unknown', { reason: request.exclusionReason });
    }
    if (request.score !== undefined) return refuse('assessment-item-excluded-carries-score');
    return accept(request.exclusionReason);
  }

  if (request.score === undefined) return accept('missing');
  if (!Number.isInteger(request.score)) return refuse('assessment-item-score-not-whole');
  // The out-of-range invariant where a score actually arrives from a person. It fails; it does not
  // clamp, because a clamped score is a wrong score that looks right.
  if (!withinScale(scale, request.score)) {
    return refuse('assessment-item-score-out-of-range', { score: String(request.score) });
  }
  if (!weightWithinRange(request.weightBasisPoints)) {
    return refuse('assessment-item-weight-out-of-range');
  }

  return accept(undefined);
};

const weightWithinRange = (weightBasisPoints: number | undefined): boolean =>
  weightBasisPoints === undefined ||
  (Number.isInteger(weightBasisPoints) &&
    weightBasisPoints >= 0 &&
    weightBasisPoints <= MAX_BASIS_POINTS);

export interface SubmitAssessmentRequest {
  readonly submittedBy: string;
  readonly submittedAt: Date;
  readonly goalScore?: number;
  readonly competencyScore?: number;
  readonly overallScore?: number;
  readonly ratingLevelId?: string;
  readonly overallComment?: string;
  readonly strengths?: string;
  readonly developmentAreas?: string;
}

/**
 * Submitting. From here the assessment is frozen everywhere it is stored.
 *
 * An assessment with no lines is refused: submitting nothing is not assessing, and an empty
 * submission would satisfy a completeness check while telling the person nothing about their work.
 */
export const submitAssessment = (
  state: AssessmentState,
  items: readonly AssessmentItemState[],
  request: SubmitAssessmentRequest,
): PerformanceResult<AssessmentState> => {
  if (!permits(ASSESSMENT_TRANSITIONS, state.status, 'submitted')) {
    return refuse('assessment-already-submitted');
  }
  if (items.length === 0) return refuse('assessment-has-no-items');

  return accept({
    ...state,
    status: 'submitted',
    submittedAt: request.submittedAt,
    submittedBy: request.submittedBy,
    ...optional('goalScore', request.goalScore),
    ...optional('competencyScore', request.competencyScore),
    ...optional('overallScore', request.overallScore),
    ...optional('ratingLevelId', request.ratingLevelId),
    ...optional('overallComment', request.overallComment),
    ...optional('strengths', request.strengths),
    ...optional('developmentAreas', request.developmentAreas),
  });
};

/** What a submitted assessment refuses, stated once so every caller refuses it the same way. */
export const editable = (state: AssessmentState): boolean => state.status === 'draft';
