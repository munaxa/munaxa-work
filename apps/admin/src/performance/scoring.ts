import type { BasisPoints, ScoreHundredths } from '@work/performance/contracts';

/**
 * Presenting a score without becoming a second place that computes one.
 *
 * **Nothing in this file does arithmetic on a score, and that is the whole point.** The engine
 * decided what a review is worth; a screen that recalculated it would be a second, weaker answer to
 * a question the domain already settled, and the two would disagree in the fourth place years later
 * when somebody asks why their rating changed.
 *
 * Three rules run through it.
 *
 * **A score is a whole number of hundredths.** `370` is `3.70`. The conversion below is a *string*
 * operation — insert a decimal point two places from the right — and never `score / 100`, which is
 * floating-point division on a value the database holds exactly. For the magnitudes a rating scale
 * uses the two agree; agreeing by accident is not the same as agreeing, and the string cannot drift.
 *
 * **A weight is a whole number of basis points.** `6000` is `60%`. Same treatment, two more places.
 *
 * **An exact measurement is passed through untouched.** `observedValue` arrives as a decimal string
 * because it is a `bigint` that can exceed 2^53, and `Number('9007199254740993')` is
 * `9007199254740992`. It is rendered as it arrived and, if it is ever put back into a request, it
 * goes back as the same string. There is no round trip through a JavaScript number anywhere on this
 * screen.
 */

/** Insert a decimal point `places` from the right of an integer string, padding as needed. */
const pointed = (digits: string, places: number): string => {
  const negative = digits.startsWith('-');
  const magnitude = (negative ? digits.slice(1) : digits).padStart(places + 1, '0');
  const whole = magnitude.slice(0, magnitude.length - places);
  const fraction = magnitude.slice(magnitude.length - places);

  return `${negative ? '-' : ''}${whole}.${fraction}`;
};

/**
 * Hundredths as a decimal string. `370` renders `3.70`.
 *
 * `String(score)` and then string surgery. Never `(score / 100).toFixed(2)`: that is a division and
 * a rounding, and neither is this screen's to perform.
 */
export const scoreText = (score: ScoreHundredths | undefined): string =>
  score === undefined ? '—' : pointed(String(score), 2);

/** Basis points as a percentage string. `6000` renders `60.00%`. */
export const weightText = (weight: BasisPoints | undefined): string =>
  weight === undefined ? '—' : `${pointed(String(weight), 2)}%`;

/**
 * An exact measurement, rendered as it arrived.
 *
 * The identity function, deliberately and with a name. A future reader reaching for
 * `Number(observedValue)` to "format" it meets this instead, and the comment above explains why the
 * value is a string in the first place.
 */
export const exactText = (value: string | undefined): string => value ?? '—';

/**
 * Why there is no `ratingFor` here any more.
 *
 * There used to be one, and it did this:
 *
 * ```
 * final: scoreText(review?.finalScore ?? review?.calculatedScore)
 * ```
 *
 * A review the engine had scored and nobody had completed therefore displayed its **calculated**
 * score in a column headed *Final score*, on the queue and again on the rating block. That is not a
 * formatting choice: it tells a reader a rating has been settled when it has not, about a person
 * whose rating it is. The review screen now renders `calculatedScore` and `finalScore` as the two
 * separate published fields they are, and a review with no final score shows none.
 */
