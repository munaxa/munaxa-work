import type { ExclusionReason, ScoreComponent } from './performance-vocabulary.js';

/**
 * The shapes the scoring engine takes and returns.
 *
 * Separated from the arithmetic so `scoring.ts` is nothing but the seven approved decisions. Every
 * number in these shapes is an integer: scores are hundredths, weights are basis points, and no
 * field here is ever a floating-point value.
 */

/** One assessed line: a goal that was scored, or a competency that was rated. */
export interface ScoringItem {
  /** The goal or competency this line assessed. Used only to report exclusions. */
  readonly reference: string;
  /** Hundredths on the review's rating scale. Absent when nothing was scored. */
  readonly score?: number;
  /** Basis points. Absent where the framework carries no weights. */
  readonly weightBasisPoints?: number;
  /** Present when the line is known not to participate — a cancelled goal, say. */
  readonly exclusionReason?: ExclusionReason;
}

export interface ScoringComponentInput {
  readonly component: ScoreComponent;
  /** Basis points from the review template. The set across components must total 10,000. */
  readonly weightBasisPoints: number;
  /**
   * Whether the items carry their own weights.
   *
   * False for a competency framework that does not declare them, and the aggregate is then the
   * unweighted mean the third decision asks for.
   */
  readonly weighted: boolean;
  readonly items: readonly ScoringItem[];
}

export interface RatingLevelBand {
  readonly ratingLevelId: string;
  readonly ordinal: number;
  readonly minimumScore: number;
  readonly maximumScore: number;
}

export interface RatingScaleBand {
  readonly minimumScore: number;
  readonly maximumScore: number;
  readonly levels: readonly RatingLevelBand[];
}

export interface ScoringRequest {
  readonly components: readonly ScoringComponentInput[];
  readonly scale: RatingScaleBand;
}

export interface ExcludedItem {
  readonly reference: string;
  readonly reason: ExclusionReason;
}

export interface ComponentOutcome {
  readonly component: ScoreComponent;
  readonly weightBasisPoints: number;
  readonly included: boolean;
  /** Hundredths. Present only where the component participated. */
  readonly score?: number;
  readonly exclusionReason?: ExclusionReason;
  /** The weights that actually participated, in basis points. Zero when none did. */
  readonly denominatorBasisPoints: number;
  /**
   * This component's weighted share of the final score, in hundredths.
   *
   * It is rounded independently, so the shares may differ from the final score by a hundredth. The
   * final score is rounded once from the component scores and is the authoritative number; these
   * are the working, shown so that a rating somebody disagrees with can be talked through.
   */
  readonly contributedScore?: number;
  readonly excludedItems: readonly ExcludedItem[];
}

export interface ScoreOutcome {
  /** Hundredths, within the scale's range. */
  readonly score: number;
  readonly ratingLevelId: string;
  readonly components: readonly ComponentOutcome[];
}
