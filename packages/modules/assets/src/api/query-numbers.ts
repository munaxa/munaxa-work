/**
 * A query-string number, or nothing.
 *
 * A page parameter arrives as text, and an unparseable one must not become `NaN` on the query: the
 * handler bounds what it receives, and a `NaN` would fall through its integer check to the default
 * anyway — but only by accident. Omitting it says the caller did not ask.
 *
 * Extracted from `asset.controller.ts` when the custody controllers needed the same rule. One copy, so
 * a second cannot be written slightly differently and let a `NaN` reach a `limit`.
 */
export const numbered = (
  field: string,
  value: string | undefined,
): Readonly<Record<string, number>> => {
  if (value === undefined) return {};

  const parsed = Number(value);

  return Number.isInteger(parsed) ? { [field]: parsed } : {};
};
