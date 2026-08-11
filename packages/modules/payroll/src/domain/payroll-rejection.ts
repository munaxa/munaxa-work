/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **field names, dates, codes and counts — never a monetary amount**. Payroll holds
 * the most sensitive figures in this product, and a rejection's detail map ends up in a log, in an
 * error tracker and on a screen somebody left open. A refusal can say that net pay would have been
 * negative; it does not say by how much.
 */

export interface PayrollRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates — a field name, a date, a code, a count. **Never money.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type PayrollResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: PayrollRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): PayrollResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `payroll.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): PayrollResult<TValue> => ({
  ok: true,
  value,
});
