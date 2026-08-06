import type { Transaction } from '@work/kernel';

import {
  matchAgainst,
  type DuplicateMatch,
  type MatchSubject,
} from '../domain/duplicate-matching.js';
import { namesIn } from '../domain/person-name.js';

import type { PeopleStores } from './people-ports.js';

/**
 * The application service that runs duplicate detection, in the three places the specification
 * requires it: before a create, before an import row, and on demand for a whole register.
 *
 * The domain decides *whether* two subjects match; this decides *which* subjects to compare, and
 * it does so by index rather than by scan. Comparing a new person against every existing one would
 * be linear in the size of the register on every single create, and the check that becomes slow is
 * the check that gets switched off.
 *
 * So the three signals are three indexed lookups:
 *
 * - the identifier **digests** — never the numbers,
 * - the normalized contact values,
 * - and, only for a subject that has a date of birth, people sharing it.
 *
 * The third is the reason `name-and-date-of-birth` requires a date of birth on both sides: without
 * one there is nothing to look the candidate set up by, and the alternative is the full scan.
 */

export interface DetectionResult {
  readonly matches: readonly DuplicateMatch[];
}

/**
 * Everything known about somebody not yet written — what a create command carries before the
 * person exists.
 */
export interface ProspectiveSubject {
  readonly personId?: string;
  readonly identifierKeys: readonly string[];
  readonly contactValues: readonly string[];
  readonly names: readonly string[];
  readonly dateOfBirth?: string;
}

export const detectDuplicates = async (
  transaction: Transaction,
  stores: PeopleStores,
  subject: ProspectiveSubject,
): Promise<DetectionResult> => {
  const candidateIds = await candidatesFor(transaction, stores, subject);
  const strongest = new Map<string, DuplicateMatch>();

  for (const candidateId of candidateIds) {
    if (candidateId === subject.personId) continue;

    const existing = await subjectFor(transaction, stores, candidateId);
    const match = matchAgainst(asMatchSubject(subject), existing);

    if (match === undefined) continue;

    const held = strongest.get(match.personId);

    if (held === undefined || match.confidence > held.confidence) {
      strongest.set(match.personId, match);
    }
  }
  return {
    matches: [...strongest.values()].sort((left, right) => right.confidence - left.confidence),
  };
};

/** The people worth comparing against, found through indexes rather than by scanning. */
const candidatesFor = async (
  transaction: Transaction,
  stores: PeopleStores,
  subject: ProspectiveSubject,
): Promise<readonly string[]> => {
  const byIdentifier = await stores.identifiers.byMatchKeys(transaction, subject.identifierKeys);
  const byContact = await stores.contacts.byValues(transaction, subject.contactValues);
  const byBirth =
    subject.dateOfBirth === undefined
      ? []
      : await stores.people.byDateOfBirth(transaction, subject.dateOfBirth, NAME_CANDIDATE_LIMIT);

  return [
    ...new Set([
      ...byIdentifier.map((row) => row.personId),
      ...byContact.map((row) => row.personId),
      ...byBirth.map((row) => row.id),
    ]),
  ];
};

/**
 * How many same-birthday records are worth pulling names for.
 *
 * A bound rather than an unbounded read: in a register of a hundred thousand people roughly three
 * hundred share any given date of birth, and a create that read all of them to compare names would
 * be the slowest write in the product. Beyond the bound the weakest of the three signals is not
 * evaluated, which is stated in the debt register rather than silently true.
 */
const NAME_CANDIDATE_LIMIT = 200;

const subjectFor = async (
  transaction: Transaction,
  stores: PeopleStores,
  personId: string,
): Promise<MatchSubject> => {
  const person = await stores.people.byId(transaction, personId);
  const names = await stores.names.forPerson(transaction, personId);
  const identifiers = await stores.identifiers.forPerson(transaction, personId);
  const contacts = await stores.contacts.forPerson(transaction, personId);

  return {
    personId,
    identifierKeys: identifiers
      .filter((row) => row.withdrawnAt === undefined)
      .map((r) => r.matchKey),
    contactValues: contacts.map((row) => row.value),
    names: names.flatMap(namesIn),
    ...(person?.dateOfBirth === undefined ? {} : { dateOfBirth: person.dateOfBirth }),
  };
};

const asMatchSubject = (subject: ProspectiveSubject): MatchSubject => ({
  ...(subject.personId === undefined ? {} : { personId: subject.personId }),
  identifierKeys: subject.identifierKeys,
  contactValues: subject.contactValues,
  names: subject.names,
  ...(subject.dateOfBirth === undefined ? {} : { dateOfBirth: subject.dateOfBirth }),
});

/** Everything known about somebody already written, for a re-check after a change. */
export const subjectForPerson = subjectFor;
