/**
 * An object with its absent values dropped, so an optional field is *absent* rather than `undefined`.
 *
 * `exactOptionalPropertyTypes` distinguishes "key missing" from "key present, value undefined", and
 * every aggregate here has a handful of genuinely optional fields. Spelling the branch out per field
 * produces a factory with eight conditional spreads — which reads as a wall and exceeds the
 * complexity budget the standards set — so the branch lives here once, exactly as
 * `performance/infrastructure/row-writer.ts` does it for rows.
 *
 * It drops `undefined` and nothing else. `0`, `''` and `false` all survive, which matters: a duration
 * of zero and an empty note are values somebody chose, and a helper that swallowed them would lose
 * them silently.
 */

export type Defined<TShape> = {
  [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
};

export const definedOf = <TShape extends object>(candidate: TShape): Defined<TShape> =>
  Object.fromEntries(
    Object.entries(candidate).filter(([, value]) => value !== undefined),
  ) as Defined<TShape>;
