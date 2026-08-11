import type { BasisPoints, LocalizedTextView, ScoreHundredths } from './primitives.js';

/**
 * What Performance publishes, and what it deliberately does not.
 *
 * These are the shapes the API layer will serialize and other modules may consume. **No Prisma
 * type, no row, no domain aggregate and no `Map` appears here**: a view is a promise about what a
 * consumer will still receive after this module's tables are rearranged, and a promise made in
 * terms of a table is not one this module can keep.
 *
 * Three absences are deliberate and should stay absent.
 *
 *   * **No person's name.** A review carries an `employmentId`; a screen that wants a name asks
 *     People, which owns it and knows whether the caller may see it. Copying one here would give
 *     two answers to what somebody is called (AD-001, ADR-0037).
 *   * **No pay figure of any kind.** A performance review must not display a salary, so no view
 *     here has a field one could be put in.
 *   * **No anonymity claim.** `PeerResponseView` carries the reviewer's employment, because it
 *     exists. Where a template's minimum has not been met the aggregate is *withheld* — the view
 *     says `available: false` and carries no scores — which is a different and much weaker thing
 *     than anonymity, and is labelled as exactly that.
 */

export interface RatingLevelView {
  readonly ratingLevelId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly ordinal: number;
  readonly minimumScore: ScoreHundredths;
  readonly maximumScore: ScoreHundredths;
}

export interface RatingScaleView {
  readonly ratingScaleId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly minimumScore: ScoreHundredths;
  readonly maximumScore: ScoreHundredths;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly active: boolean;
  readonly levels: readonly RatingLevelView[];
  readonly version: number;
}

export interface CompetencyView {
  readonly competencyId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly category: string;
  /** Absent unless the framework declares itself weighted. No weight is invented for one that does not. */
  readonly weightBasisPoints?: BasisPoints;
  readonly displayOrder: number;
  readonly active: boolean;
}

export interface CompetencyFrameworkView {
  readonly frameworkId: string;
  readonly code: string;
  readonly frameworkVersion: number;
  readonly name: LocalizedTextView;
  readonly weighted: boolean;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
  readonly active: boolean;
  readonly competencies: readonly CompetencyView[];
  readonly version: number;
}

export interface TemplateComponentView {
  readonly component: string;
  readonly weightBasisPoints: BasisPoints;
}

export interface ReviewTemplateView {
  readonly templateId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly ratingScaleId: string;
  readonly competencyFrameworkId?: string;
  readonly requiresSelfAssessment: boolean;
  readonly requiresPeerAssessment: boolean;
  readonly requiresCalibration: boolean;
  readonly goalWeightTotalBasisPoints: BasisPoints;
  /**
   * Below this many multi-rater responses the aggregate is withheld.
   *
   * A display rule, and **not** anonymity: every response records its author.
   */
  readonly minimumPeerResponses?: number;
  readonly active: boolean;
  readonly components: readonly TemplateComponentView[];
  readonly version: number;
}

export interface GoalCategoryView {
  readonly goalCategoryId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly active: boolean;
  readonly version: number;
}

export interface GoalProgressView {
  readonly goalProgressId: string;
  readonly progressBasisPoints: BasisPoints;
  /**
   * The measurement behind the percentage, **as a decimal string**.
   *
   * A string because it is a `bigint`: an observed value can exceed 2^53 — a count of transactions,
   * of bytes, of parts — and `JSON.stringify` of a JavaScript number above that emits a value that
   * is not the one recorded. A key result whose measurement rounded is a key result nobody can
   * falsify, which is the opposite of what a measurement is for.
   */
  readonly observedValue?: string;
  readonly note?: string;
  readonly evidenceDocumentId?: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface GoalView {
  readonly goalId: string;
  readonly scope: string;
  readonly employmentId?: string;
  readonly organizationUnitId?: string;
  readonly cycleId?: string;
  readonly parentGoalId?: string;
  readonly goalCategoryId?: string;
  readonly title: string;
  readonly description?: string;
  readonly measurement: string;
  readonly targetDescription?: string;
  readonly weightBasisPoints: BasisPoints;
  readonly status: string;
  readonly startDate: string;
  readonly dueDate: string;
  readonly progressBasisPoints: BasisPoints;
  readonly approvedAt?: string;
  readonly approvedBy?: string;
  readonly closedAt?: string;
  readonly finalScore?: ScoreHundredths;
  readonly closureReason?: string;
  /** Documents' identifier and nothing else. This module holds no bytes and no file metadata. */
  readonly evidenceDocumentId?: string;
  readonly progress: readonly GoalProgressView[];
  readonly version: number;
}

export interface CycleView {
  readonly cycleId: string;
  readonly code: string;
  readonly name: LocalizedTextView;
  readonly reviewTemplateId: string;
  readonly kind: string;
  readonly status: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly selfAssessmentDue?: string;
  readonly managerAssessmentDue?: string;
  readonly peerAssessmentDue?: string;
  readonly calibrationDue?: string;
  readonly openedAt?: string;
  readonly closedAt?: string;
  readonly closedBy?: string;
  readonly participantCount: number;
  readonly version: number;
}

export type * from './primitives.js';
export type * from './review-views.js';
