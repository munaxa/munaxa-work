/**
 * An operation that can fail in a way the caller is expected to handle.
 *
 * Domain rules return `Result`; they do not throw. A rejected leave request, an insufficient
 * balance and a concurrency conflict are outcomes, not exceptions, and modelling them as values
 * means the compiler — rather than a reviewer — checks that every one is handled.
 *
 * Exceptions remain for the genuinely exceptional: a bug, a lost database connection, a
 * violated invariant that should have been impossible.
 */
export type Result<TValue, TError> =
  { readonly ok: true; readonly value: TValue } | { readonly ok: false; readonly error: TError };

export const ok = <TValue, TError = never>(value: TValue): Result<TValue, TError> => ({
  ok: true,
  value,
});

export const err = <TError, TValue = never>(error: TError): Result<TValue, TError> => ({
  ok: false,
  error,
});

export const isOk = <TValue, TError>(
  result: Result<TValue, TError>,
): result is { ok: true; value: TValue } => result.ok;

export const isErr = <TValue, TError>(
  result: Result<TValue, TError>,
): result is { ok: false; error: TError } => !result.ok;

/** Applies a function to the value of a successful result, leaving a failure untouched. */
export const map = <TValue, TNext, TError>(
  result: Result<TValue, TError>,
  transform: (value: TValue) => TNext,
): Result<TNext, TError> => (result.ok ? ok(transform(result.value)) : result);

/** Chains an operation that itself may fail. */
export const flatMap = <TValue, TNext, TError>(
  result: Result<TValue, TError>,
  transform: (value: TValue) => Result<TNext, TError>,
): Result<TNext, TError> => (result.ok ? transform(result.value) : result);

/** Collects results, returning the first failure or every value in order. */
export const all = <TValue, TError>(
  results: readonly Result<TValue, TError>[],
): Result<readonly TValue[], TError> => {
  const values: TValue[] = [];

  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
};

/**
 * Extracts the value, throwing if the result is a failure. Intended for tests and for call
 * sites that have already proven success; production code branches on `ok` instead.
 */
export const unwrap = <TValue, TError>(result: Result<TValue, TError>): TValue => {
  if (!result.ok) {
    throw new Error(`Called unwrap on a failed result: ${JSON.stringify(result.error)}`);
  }
  return result.value;
};
