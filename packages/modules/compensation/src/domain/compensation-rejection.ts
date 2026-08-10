/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **field names, dates and codes — never a monetary amount**. Compensation is the
 * most sensitive data this product holds, and a rejection's detail map ends up in a log, in an
 * error tracker and on a screen somebody left open. A refusal can say that an amount fell outside a
 * grade's range; it does not say what the amount was.
 */

export interface CompensationRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates — a field name, a date, a code. **Never money.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type CompensationResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: CompensationRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): CompensationResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `compensation.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): CompensationResult<TValue> => ({
  ok: true,
  value,
});
