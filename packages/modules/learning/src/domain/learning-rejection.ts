/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **codes, dates, counts and identifiers — never the text of an assessment, never
 * an assessor's note and never a reason somebody wrote for a waiver**. A refusal ends up in a log,
 * an error tracker and on a screen somebody left open, and a failed safety assessment is as
 * disclosing about a person as a performance rating. A rejection may say that an enrolment already
 * exists or that a certification has been revoked; it says nothing about what anybody wrote.
 */

export interface LearningRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never assessment text, a note or a waiver reason.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type LearningResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: LearningRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): LearningResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `learning.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): LearningResult<TValue> => ({ ok: true, value });

/** A bilingual value a tenant authored. This product renders it and never translates it. */
export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export const isLocalizedName = (value: LocalizedName | undefined): boolean =>
  value !== undefined && value.en.trim().length > 0 && value.ar.trim().length > 0;
