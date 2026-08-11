/**
 * A refused business rule, as a value rather than an exception.
 *
 * The catalogue key travels with the refusal instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries field names, codes and counts — **never a substituted value**. A letter's
 * substituted values include salary, and a refusal ends up in a log and an error tracker. A refusal
 * may say that a required variable was missing; it does not say what the resolved ones were.
 */

export interface LettersRejection {
  readonly reason: string;
  readonly messageKey: string;
  /** Field names, codes, counts. **Never a substituted value.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type LettersResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: LettersRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): LettersResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `letters.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): LettersResult<TValue> => ({ ok: true, value });
