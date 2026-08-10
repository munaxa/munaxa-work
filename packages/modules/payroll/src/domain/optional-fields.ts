/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` treats an explicit `undefined` as a different thing from an absent
 * key, and spreading a partial with undefined values would widen every optional field it touches.
 *
 * In this module the distinction carries meaning as well as types. An adjustment's `note` is
 * **omitted** for a caller who may not read it; a `null` would tell them a note exists, which is
 * itself a disclosure about somebody's pay.
 */
export const definedOnly = <TShape extends object>(
  shape: TShape,
): { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> } =>
  Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
  };
