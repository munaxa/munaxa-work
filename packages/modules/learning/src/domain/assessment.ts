import { isCivilDate, type AssessmentKind, type AssessmentOutcome } from './learning-vocabulary.js';
import {
  accept,
  isLocalizedName,
  refuse,
  type LearningResult,
  type LocalizedName,
} from './learning-rejection.js';
import { definedOf } from './defined.js';

/**
 * An assessment, and the formula this product refused to invent.
 *
 * The specification's Assessments section reads, in full: five kinds — quiz, practical assessment,
 * assignment, observation, external result — and the sentence "assessments measure learning progress
 * only". It defines **no scoring formula, no pass threshold, no weighting, no rounding, no retake
 * policy and no attempt limit**.
 *
 * Inventing one would not be a small liberty. A threshold decides who passes mandatory safety
 * training; a weighting decides whose practical result outranks whose quiz; a rounding rule decides
 * whether 69.5 is a pass. Those are the customer's decisions about their own business (00B), and a
 * number this product computed would be believed precisely because it looked computed.
 *
 * So: an authorized assessor records **the outcome**, and that outcome is the fact. `rawMark` and
 * `rawMarkScale` may be stored beside it for the tenant's own records and are **never read, compared,
 * thresholded, ranked or aggregated anywhere in this module** — no query orders by them, no
 * completion rule consults them, and no screen computes a total from them.
 *
 * **Aggregate scoring is `NOT VERIFIED`.** It is not approximated, not partially built, and not
 * hinted at by a column that would let somebody assume it exists.
 *
 * `recorded` is a first-class outcome because an observation or an assignment frequently has neither
 * a pass nor a fail: it happened, and somebody noted what they saw. Collapsing that into `passed`
 * would state a judgement nobody made.
 */

export interface AssessmentDefinitionState {
  readonly assessmentId: string;
  readonly courseVersionId: string;
  readonly title: LocalizedName;
  readonly kind: AssessmentKind;
  /** Whether an outcome here is required before the enrolment may be completed. */
  readonly required: boolean;
  readonly version: number;
}

export interface DefineAssessmentRequest {
  readonly assessmentId: string;
  readonly courseVersionId: string;
  readonly title: LocalizedName;
  readonly kind: AssessmentKind;
  readonly required: boolean;
}

export const defineAssessment = (
  request: DefineAssessmentRequest,
): LearningResult<AssessmentDefinitionState> => {
  if (!isLocalizedName(request.title)) return refuse('assessment-title-required');

  return accept({
    assessmentId: request.assessmentId,
    courseVersionId: request.courseVersionId,
    title: request.title,
    kind: request.kind,
    required: request.required,
    version: 1,
  });
};

/**
 * One assessor's record of how one enrolment went on one assessment.
 *
 * **The result is insert-only.** A correction is a new result, exactly as a correction to a completed
 * enrolment is a new enrolment: what an assessor recorded on a date is a thing that happened, and an
 * editable result would make every completion that depended on it unverifiable afterwards. Later
 * results supersede earlier ones by being later; nothing is overwritten.
 *
 * `notes` is the assessor's own text. It never travels in a rejection's `detail`, never appears in a
 * log line and never reaches a queue view — a failed safety assessment is as disclosing about a
 * person as a performance rating, and Learning treats it that way.
 */
export interface AssessmentResultState {
  readonly resultId: string;
  readonly assessmentId: string;
  readonly enrolmentId: string;
  readonly employmentId: string;
  readonly outcome: AssessmentOutcome;
  /**
   * The tenant's own raw mark, stored verbatim as an exact decimal string.
   *
   * **Nothing in this module reads it.** Not a completion rule, not a query, not a screen total. It
   * is a string rather than a number for the reason every other exact value in this repository is:
   * a float would silently alter what the assessor typed.
   */
  readonly rawMark?: string;
  /** What the mark was out of, in the tenant's own words. Never interpreted. */
  readonly rawMarkScale?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
  readonly notes?: string;
  readonly recordedAt: Date;
}

export interface RecordResultRequest {
  readonly resultId: string;
  readonly assessmentId: string;
  readonly enrolmentId: string;
  readonly employmentId: string;
  readonly outcome: AssessmentOutcome;
  readonly rawMark?: string;
  readonly rawMarkScale?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
  readonly notes?: string;
  readonly recordedAt: Date;
}

const AUTO_APPROVAL = 'system:auto-approval';
const EXACT_DECIMAL = /^-?\d{1,12}(\.\d{1,4})?$/;

export const recordResult = (
  request: RecordResultRequest,
): LearningResult<AssessmentResultState> => {
  if (!isCivilDate(request.assessedOn)) return refuse('assessment-date-invalid');
  // A person assesses another person. Nothing in this product decides that somebody passed, because
  // nothing in this product was told what passing means.
  if (request.assessedBy === AUTO_APPROVAL) return refuse('assessment-not-human');
  if (request.rawMark !== undefined && !EXACT_DECIMAL.test(request.rawMark)) {
    return refuse('assessment-mark-invalid');
  }
  // A mark with nothing to measure it against is a number nobody can read back. The scale is the
  // tenant's own text — "out of 40", "بالمائة" — and this module never parses either.
  if (request.rawMark !== undefined && request.rawMarkScale === undefined) {
    return refuse('assessment-mark-scale-required');
  }

  return accept({
    resultId: request.resultId,
    assessmentId: request.assessmentId,
    enrolmentId: request.enrolmentId,
    employmentId: request.employmentId,
    outcome: request.outcome,
    assessedOn: request.assessedOn,
    assessedBy: request.assessedBy,
    recordedAt: request.recordedAt,
    ...definedOf({
      rawMark: request.rawMark,
      rawMarkScale: request.rawMarkScale,
      notes: request.notes,
    }),
  });
};

/**
 * Whether an enrolment has satisfied every assessment its course version requires.
 *
 * This is a **presence check over outcomes, not a calculation**. It asks whether a `passed` outcome
 * exists for each required assessment — it does not add marks, compare them, weight them or decide
 * what proportion is enough, because none of those were specified and inventing them would be
 * inventing how somebody qualifies.
 *
 * A later result wins: an assessor who re-assessed somebody records a new result, and the question
 * "did they pass in the end" is answered by the most recent outcome for that assessment rather than
 * by the first, the best, or an average of them.
 */
export const hasPassedRequiredAssessments = (
  required: readonly Pick<AssessmentDefinitionState, 'assessmentId'>[],
  results: readonly Pick<AssessmentResultState, 'assessmentId' | 'outcome' | 'assessedOn'>[],
): boolean => {
  const latest = new Map<string, Pick<AssessmentResultState, 'outcome' | 'assessedOn'>>();

  for (const result of results) {
    const held = latest.get(result.assessmentId);

    if (held === undefined || result.assessedOn >= held.assessedOn) {
      latest.set(result.assessmentId, result);
    }
  }

  return required.every((item) => latest.get(item.assessmentId)?.outcome === 'passed');
};
