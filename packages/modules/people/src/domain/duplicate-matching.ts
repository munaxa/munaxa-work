/**
 * Duplicate detection: the domain service behind AD-001, *a Person is created once*.
 *
 * The failure this prevents is not untidy data. A second Person for one human being splits their
 * service period in two, so an end-of-service gratuity is computed on four years instead of
 * eleven; it splits their leave balance, their loan repayments and their medical claim
 * entitlement; and it produces two social-insurance registrations for one national identifier,
 * which is a filing offence in several of this product's markets.
 *
 * **Nothing here decides.** Detection produces *candidates* with a stated reason, and a human
 * confirms or dismisses each one. Automatic merging is deliberately absent: merging two people is
 * effectively irreversible for every module that has since referenced the loser, and a matcher
 * confident enough to merge on its own would eventually merge two brothers with the same name and
 * the same date of birth. The specification says duplicate candidates require review, and this is
 * what that means in code.
 *
 * **Matching never reads a plaintext identifier.** A government identifier is compared through the
 * digest computed when it was recorded, so the query that finds "who else holds this number" never
 * needs the number.
 */

import { normalizeIdentifier } from './person-identifier.js';

/** Why two records are suspected of being one person. Ordered strongest first. */
export const MATCH_REASONS = [
  'government-identifier',
  'contact-value',
  'name-and-date-of-birth',
] as const;
export type MatchReason = (typeof MATCH_REASONS)[number];

/**
 * How strongly each reason implies the same human being, as a percentage.
 *
 * A **government identifier** is issued to one person by an authority that took steps to make it
 * unique, so a collision is a duplicate or a data-entry error and either way needs a human.
 *
 * A **contact value** — the same mobile number or the same mailbox — is strong but not conclusive:
 * a family shares a landline, and a small employer's site office shares one email address across
 * a crew.
 *
 * A **name with a date of birth** is the weakest and the one that must never auto-merge. In
 * several of this product's markets a very large share of the population shares a given name with
 * a patronymic, and identical twins share a birthday.
 *
 * These are the *evidence*, not a threshold to act on. Nothing in this module compares a score to
 * a cutoff and takes a decision.
 */
export const MATCH_CONFIDENCE: Readonly<Record<MatchReason, number>> = {
  'government-identifier': 95,
  'contact-value': 70,
  'name-and-date-of-birth': 45,
};

/** What a candidate person looks like to the matcher. No plaintext identifier appears. */
export interface MatchSubject {
  readonly personId?: string;
  /** Digests of the person's identifiers, as `PersonIdentifier.matchKey` computed them. */
  readonly identifierKeys: readonly string[];
  /** Normalized contact values — lower-cased email, E.164 telephone. */
  readonly contactValues: readonly string[];
  /** Every form of the person's name, in both languages. */
  readonly names: readonly string[];
  readonly dateOfBirth?: string;
}

export interface DuplicateMatch {
  readonly personId: string;
  readonly reason: MatchReason;
  readonly confidence: number;
}

/**
 * Names compared after collapsing everything that is presentation.
 *
 * Case, punctuation and runs of whitespace are formatting. Arabic diacritics and the tatweel are
 * decoration a keyboard may or may not produce, and the several forms of alef and of the final
 * yaa are keyboard layouts rather than different letters — `أحمد` and `احمد` are one name typed on
 * two machines. A matcher that treated them as different names would miss precisely the duplicates
 * that arise in this product's first markets.
 */
export const normalizeName = (value: string): string =>
  value
    // Compose first. Decomposing before the letter folding below splits `أ` into a bare alef and
    // a combining hamza, and the punctuation pass then turns that hamza into a *space* — so
    // `أحمد` becomes two words and stops matching `احمد`, which is the one case this function
    // exists for. The suite caught exactly that.
    .normalize('NFKC')
    // Arabic diacritics (harakat), the superscript alef and the tatweel: decoration, not letters.
    .replace(/[ً-ْٰـ]/g, '')
    // The alef forms, the two final yaa forms and the taa marbuta: keyboard layouts rather than
    // different letters. `أحمد` and `احمد` are one name typed on two machines.
    .replace(/[آأإٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    // Latin diacritics, folded now that no Arabic letter carries a mark to lose.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * The strongest match between a subject and one existing person, or nothing.
 *
 * One result per person rather than one per matching field: a screen that told an administrator
 * the same two people match on four different things has told them one thing four times.
 */
export const matchAgainst = (
  subject: MatchSubject,
  existing: MatchSubject,
): DuplicateMatch | undefined => {
  if (existing.personId === undefined || existing.personId === subject.personId) return undefined;

  const reason = strongestReason(subject, existing);

  if (reason === undefined) return undefined;
  return { personId: existing.personId, reason, confidence: MATCH_CONFIDENCE[reason] };
};

const strongestReason = (
  subject: MatchSubject,
  existing: MatchSubject,
): MatchReason | undefined => {
  if (intersects(subject.identifierKeys, existing.identifierKeys)) return 'government-identifier';
  if (intersects(subject.contactValues, existing.contactValues)) return 'contact-value';
  if (sharesNameAndBirth(subject, existing)) return 'name-and-date-of-birth';
  return undefined;
};

const intersects = (left: readonly string[], right: readonly string[]): boolean => {
  const held = new Set(right);
  return left.some((value) => value !== '' && held.has(value));
};

/**
 * A name match requires a date of birth on **both** sides.
 *
 * Without that, every person sharing a common name in a large workforce would be flagged against
 * every other, and a review queue that is mostly noise is a review queue nobody reads — which is
 * how the real duplicate gets confirmed away with the rest.
 */
const sharesNameAndBirth = (subject: MatchSubject, existing: MatchSubject): boolean => {
  if (subject.dateOfBirth === undefined || existing.dateOfBirth === undefined) return false;
  if (subject.dateOfBirth !== existing.dateOfBirth) return false;

  const held = new Set(existing.names.map(normalizeName));
  return subject.names.some((name) => {
    const normalized = normalizeName(name);
    return normalized !== '' && held.has(normalized);
  });
};

/**
 * The digest of a raw identifier value, for a caller matching against something not yet recorded.
 *
 * The normalization is the aggregate's, reused rather than repeated: a create-time check that
 * normalized differently from the stored key would miss every duplicate it exists to find.
 */
export const matchKeyFor = (
  identifierType: string,
  value: string,
  digest: (identifierType: string, normalizedValue: string) => string,
): string => digest(identifierType, normalizeIdentifier(value));
