/**
 * The three units every published view is expressed in.
 *
 * They live in their own file so the view modules can share them without importing each other —
 * and, more importantly, so a reader meets the units before the shapes. **A score is a whole number
 * of hundredths and a weight is a whole number of basis points**, at every layer, because a score
 * that became a float on the way out would be a different number from the one the engine computed.
 */

export interface LocalizedTextView {
  readonly en: string;
  readonly ar: string;
}

/** Hundredths of a point. Never a float, at any layer. */
export type ScoreHundredths = number;

/** Basis points. 10,000 is one whole. Never a float, at any layer. */
export type BasisPoints = number;
