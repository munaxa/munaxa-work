/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking supervisor reads is chosen at the edge from their language.
 */

export interface AttendanceRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates — a field name, a from and a to. Never personal data. */
  readonly detail?: Readonly<Record<string, string>>;
}

export type AttendanceResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: AttendanceRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): AttendanceResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `attendance.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): AttendanceResult<TValue> => ({ ok: true, value });
