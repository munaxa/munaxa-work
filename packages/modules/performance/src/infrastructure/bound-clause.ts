/**
 * The authorization bound, as SQL.
 *
 * An empty bound is an empty array rather than an absent clause. `= any('{}')` is false for every
 * row, which is what "this caller may see nothing" has to mean; omitting the clause would silently
 * mean "this caller may see everything", and that is the shape of every scope bug this repository
 * has found so far.
 */
export const boundClause = (
  bound: readonly string[] | undefined,
  column: string,
  parameters: unknown[],
): string | undefined => {
  if (bound === undefined) return undefined;

  parameters.push([...bound]);
  return `${column} = any($${String(parameters.length)}::uuid[])`;
};
