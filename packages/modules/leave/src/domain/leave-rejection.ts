/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking employee reads is chosen at the edge from their language.
 *
 * `detail` carries **field names and figures, never personal data and never leave content**. A
 * sick-leave justification is close to health data (§30); it does not travel in a rejection.
 */

export interface LeaveRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates — a field name, a from and a to. Never personal data. */
  readonly detail?: Readonly<Record<string, string>>;
}

export type LeaveResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: LeaveRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): LeaveResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `leave.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): LeaveResult<TValue> => ({ ok: true, value });
