/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **codes, dates, counts and identifiers — never a rationale somebody wrote, never
 * a readiness statement and never the reason a person was taken off a bench**. A refusal ends up in
 * a log, an error tracker and on a screen somebody left open, and "not ready to succeed the
 * operations director" is as disclosing about a colleague as a performance rating. A rejection may
 * say that a nomination already exists or that a plan is archived; it says nothing about what
 * anybody thought of anybody.
 */

export interface CareerRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never a rationale, a readiness statement or a reason.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type CareerResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: CareerRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): CareerResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `career.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): CareerResult<TValue> => ({ ok: true, value });

/** A bilingual value a tenant authored. This product renders it and never translates it. */
export interface LocalizedName {
  readonly en: string;
  readonly ar: string;
}

export const isLocalizedName = (value: LocalizedName | undefined): boolean =>
  value !== undefined && value.en.trim().length > 0 && value.ar.trim().length > 0;
