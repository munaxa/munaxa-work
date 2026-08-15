import {
  AUTO_APPROVAL,
  MAX_READINESS_ORDINAL,
  isCivilDate,
  isWholeWithin,
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
 * Readiness: a tenant's levels, and a person's statement that somebody is at one of them.
 *
 * **Readiness is stated by a person. Nothing computes it** (ADR-0074, D-10).
 *
 * The specification names levels — "Not Ready", "Ready in 1–2 Years", "Ready in 6–12 Months",
 * "Ready Now" — and gives no derivation. The inputs are all sitting there: Performance publishes a
 * potential band, Learning publishes completions and certifications, Employment publishes tenure.
 * Something like *potential band 3 plus the leadership path completed equals Ready Now* would be ten
 * lines and indistinguishable in its output from a specified rule.
 *
 * It is refused because a readiness level decides who is put forward for a director's post and who
 * is not; it is read by people who will act on it, and the person it describes is not in the room.
 * There is therefore **no score field, no weighting, no derived level and no input reference** on
 * this aggregate — only who said it, on which day, at which level, and why.
 *
 * **An assessment is append-only** (D-14). There is no transition and no amendment function in this
 * file: a correction is a *new* assessment, so the trail shows what was thought and when it changed.
 * The database enforces it too, with a trigger, because an application-level rule is not a
 * guarantee.
 *
 * **A level is ordered, and no numeric scale is published.** `ordinal` sorts the levels least to
 * most ready so a screen can order them and a consumer can compare by index. Publishing a number
 * would mean promising it stays stable and means something, and neither is true of a vocabulary the
 * tenant wrote — the construction Organization uses for `POSITION_CRITICALITIES`.
 */

export interface ReadinessLevelState {
  readonly readinessLevelId: string;
  readonly code: string;
  readonly name: LocalizedName;
  /** Orders the levels least to most ready. Not a score, and never published as one. */
  readonly ordinal: number;
  readonly active: boolean;
  readonly version: number;
}

/**
 * One statement that somebody is at one level, on one day.
 *
 * Either against a position generally or against a specific succession plan — a tenant may assess
 * "ready for a finance director role" or "ready to succeed *this* finance director", and the two are
 * different questions.
 */
export interface ReadinessAssessmentState {
  readonly readinessAssessmentId: string;
  readonly employmentId: string;
  readonly readinessLevelId: string;
  /** Organization's identifier, where the assessment is against a position generally. */
  readonly positionId?: string;
  /** Where the assessment is against one succession plan. */
  readonly successionPlanId?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
  /** Why the assessor said it. Free text they wrote; nothing parses or scores it. */
  readonly rationale?: string;
  readonly recordedAt: Date;
}

export interface DefineReadinessLevelRequest {
  readonly readinessLevelId: string;
  readonly code: string;
  readonly name: LocalizedName;
  readonly ordinal: number;
}

export const defineReadinessLevel = (
  request: DefineReadinessLevelRequest,
): CareerResult<ReadinessLevelState> => {
  if (!isLocalizedName(request.name)) return refuse('readiness-level-name-required');
  if (!isWholeWithin(request.ordinal, 1, MAX_READINESS_ORDINAL)) {
    return refuse('readiness-level-ordinal-invalid');
  }

  return accept({
    readinessLevelId: request.readinessLevelId,
    code: request.code,
    name: request.name,
    ordinal: request.ordinal,
    active: true,
    version: 1,
  });
};

/**
 * Retiring a level.
 *
 * Deactivation and not deletion: assessments recorded at this level are historical statements, and
 * removing the level would make them unreadable.
 */
export const deactivateReadinessLevel = (
  state: ReadinessLevelState,
): CareerResult<ReadinessLevelState> => {
  if (!state.active) return refuse('readiness-level-already-inactive');

  return accept({ ...state, active: false });
};

export interface RecordReadinessRequest {
  readonly readinessAssessmentId: string;
  readonly employmentId: string;
  readonly readinessLevelId: string;
  readonly positionId?: string;
  readonly successionPlanId?: string;
  readonly assessedOn: string;
  readonly assessedBy: string;
  readonly rationale?: string;
  readonly at: Date;
}

/**
 * Recording one assessor's statement.
 *
 * The assessment must be *about* something: a position or a succession plan. An assessment attached
 * to neither is "this person is ready" with no answer to "ready for what", which is not a statement
 * anybody can act on or challenge.
 *
 * `system:auto-approval` is refused. A readiness level with no human behind it is precisely the
 * derived score this module exists not to produce.
 */
export const recordReadiness = (
  request: RecordReadinessRequest,
): CareerResult<ReadinessAssessmentState> => {
  if (!isCivilDate(request.assessedOn)) return refuse('readiness-assessed-date-invalid');
  if (request.positionId === undefined && request.successionPlanId === undefined) {
    return refuse('readiness-subject-required');
  }
  if (request.assessedBy === AUTO_APPROVAL) return refuse('readiness-requires-a-person');

  return accept({
    readinessAssessmentId: request.readinessAssessmentId,
    employmentId: request.employmentId,
    readinessLevelId: request.readinessLevelId,
    assessedOn: request.assessedOn,
    assessedBy: request.assessedBy,
    recordedAt: request.at,
    ...definedOf({
      positionId: request.positionId,
      successionPlanId: request.successionPlanId,
      rationale: request.rationale,
    }),
  });
};

/**
 * The most recent statement in a set, by the day it was made.
 *
 * A *selection*, not a computation: it picks the assessment somebody wrote most recently and returns
 * it whole. It does not average, does not weight, and does not combine two assessors' views into a
 * third that neither of them holds.
 *
 * Ties break on `recordedAt`, so two assessments made on the same civil day resolve to the one
 * recorded later — the correction, which is the point of an append-only trail.
 */
export const latestAssessment = (
  assessments: readonly ReadinessAssessmentState[],
): ReadinessAssessmentState | undefined =>
  assessments.reduce<ReadinessAssessmentState | undefined>(
    (latest, candidate) =>
      latest === undefined || isMoreRecent(candidate, latest) ? candidate : latest,
    undefined,
  );

const isMoreRecent = (
  candidate: ReadinessAssessmentState,
  incumbent: ReadinessAssessmentState,
): boolean =>
  candidate.assessedOn > incumbent.assessedOn ||
  (candidate.assessedOn === incumbent.assessedOn &&
    candidate.recordedAt.getTime() > incumbent.recordedAt.getTime());
