/**
 * A refused business rule, as a value rather than an exception.
 *
 * Returned rather than thrown for the reason every module before this returns them: a refusal is an
 * ordinary outcome of an operation working correctly, and a thrown one is indistinguishable at the
 * edge from a defect. The catalogue key travels with it instead of a sentence, so the message an
 * Arabic-speaking administrator reads is chosen at the edge from their language.
 *
 * `detail` carries **field names, codes, dates and counts — never file content, never a storage
 * reference and never a signed URL**. A refusal ends up in a log, an error tracker and on a screen
 * somebody left open; this module refuses documents whose very existence is sensitive, so a
 * rejection may say a document was not found or was confidential, and says nothing about what it
 * contained or where it lives.
 */

export interface DocumentsRejection {
  readonly reason: string;
  /** The catalogue key the portal renders. Never a rendered sentence. */
  readonly messageKey: string;
  /** Values the message interpolates. **Never content, a reference or a URL.** */
  readonly detail?: Readonly<Record<string, string>>;
}

export type DocumentsResult<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: DocumentsRejection };

export const refuse = <TValue>(
  reason: string,
  detail?: Readonly<Record<string, string>>,
): DocumentsResult<TValue> => ({
  ok: false,
  error: {
    reason,
    messageKey: `documents.rejection.${reason}`,
    ...(detail === undefined ? {} : { detail }),
  },
});

export const accept = <TValue>(value: TValue): DocumentsResult<TValue> => ({ ok: true, value });
