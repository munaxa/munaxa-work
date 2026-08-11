/**
 * The fingerprint that makes staleness detectable and a figure explainable.
 *
 * Two digests matter in this module and they answer different questions. A **snapshot digest** says
 * "this is the content Payroll consumed"; comparing it to a freshly-read source's digest is how
 * reconciliation finds a change nobody was told about (ADR-0064). A **rule-set digest** says "this
 * is the configuration the calculation ran under"; it catches the case a version number misses
 * entirely — the code did not change, but a tenant edited a deduction definition between two runs.
 *
 * FNV-1a, 32 bits, unsigned hex — the same function Attendance, Leave and Compensation publish
 * theirs with, so a digest computed here is comparable with one computed there. Deterministic
 * across processes, cheap enough to run per employment per batch, and not a security primitive:
 * nothing here defends against an adversary choosing a collision, only against a change going
 * unnoticed.
 */

const OFFSET_BASIS = 0x811c9dc5;
const PRIME = 0x01000193;

export const fingerprint = (value: string): string => {
  let hash = OFFSET_BASIS;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, PRIME) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

/**
 * A digest over an ordered list of parts.
 *
 * The separator is a character no identifier, date or code contains, so `['ab', 'c']` and
 * `['a', 'bc']` cannot collide — the trivial collision that makes a naive concatenation useless.
 */
const SEPARATOR = '\u001f';

export const digestOf = (parts: readonly string[]): string => fingerprint(parts.join(SEPARATOR));

/**
 * A digest over a set whose order is not meaningful — a population, a set of identifiers.
 *
 * Sorted first, because "the same people" must give the same digest however the page arrived.
 */
export const digestOfSet = (values: readonly string[]): string => digestOf([...values].sort());
