/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * **`detail` carries field names and nothing else.** An asset tag is a tenant's own identifier and a
 * serial number is a manufacturer's; neither belongs in a refusal that ends up in a log, an error
 * tracker or on a screen somebody left open.
 */

export interface AssetsRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never an identifier, a tag or a serial number.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type AssetsResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: AssetsRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): AssetsResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `assets.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): AssetsResult<TValue> => ({ ok: true, value });
