/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **field names, codes, scores, weights and counts — never the text of an
 * assessment, never a comment and never a body of feedback**. A refusal ends up in a log, an error
 * tracker and on a screen somebody left open, and this module holds what one named person wrote
 * about another's work. A rejection may say that a review was not found or that its components do
 * not total 10,000; it says nothing about what anybody wrote.
 */

export interface PerformanceRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never assessment text, a comment or feedback.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type PerformanceResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: PerformanceRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): PerformanceResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `performance.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): PerformanceResult<TValue> => ({ ok: true, value });
