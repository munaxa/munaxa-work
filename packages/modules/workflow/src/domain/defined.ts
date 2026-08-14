/**
 * Building an object without the keys whose values are absent.
 *
 * `exactOptionalPropertyTypes` is on, so `{ comment: undefined }` and `{}` are different types and
 * only the second satisfies `comment?: string`. Spreading the result of this is how every module in
 * this repository constructs a state with optional fields without reaching for a cast.
 */
export const definedOf = <TShape extends object>(
  shape: TShape,
): { [TKey in keyof TShape]?: NonNullable<TShape[TKey]> } =>
  Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: NonNullable<TShape[TKey]>;
  };
