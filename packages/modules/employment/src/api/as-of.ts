/**
 * The `asOf` parameter, parsed once.
 *
 * Every read in this module takes one, and a date that failed to parse must not silently become
 * "now" — a screen asking for last March and being answered with today is worse than an error,
 * because nothing about the answer says it is the wrong question's.
 *
 * An invalid value is dropped rather than thrown, and the handler defaults to now, matching how
 * Organization and People treat theirs. What is *not* done is `new Date('nonsense')`, which yields
 * an Invalid Date that propagates into a query as `null` and quietly matches nothing.
 */
export const asOfFrom = (value: string | undefined): { readonly asOf?: Date } => {
  if (value === undefined) return {};

  const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);

  return Number.isNaN(parsed.getTime()) ? {} : { asOf: parsed };
};
