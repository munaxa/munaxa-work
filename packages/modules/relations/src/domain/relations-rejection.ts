/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * **`detail` carries field names and codes — never a description, never an employment identifier
 * and never anything about the person.** This module refuses things whose subject is somebody's
 * disciplinary record, and a refusal ends up in a log, an error tracker and on a screen somebody
 * left open. A rejection may say a violation was not found; it must not say whose.
 */

export interface RelationsRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never a description, an employment or a person.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type RelationsResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: RelationsRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): RelationsResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `relations.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): RelationsResult<TValue> => ({ ok: true, value });
