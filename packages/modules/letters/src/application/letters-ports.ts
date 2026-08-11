import type { Transaction } from '@work/kernel';

import type { ApprovalDecisionState } from '../domain/letter-approval.js';
import type { IssuedLetterState, LetterRequestState } from '../domain/letter-generation.js';
import type { LetterTemplateState, LetterTemplateVersionState } from '../domain/letter-template.js';
import type { ExposableField } from '../domain/letters-vocabulary.js';

/**
 * The persistence and the cross-module reads this module needs, as interfaces the domain never
 * sees.
 *
 * Two stores are **deliberately narrower than the rest**. `IssuedLetterStore` offers an insert, a
 * read and a single `supersede` stamp — there is no update, because an issued letter is what a bank
 * is holding a printed copy of, and a correction is a *new* letter. `ApprovalDecisionStore` offers
 * an insert and a read, because a wrong decision is reversed rather than edited. The database
 * refuses both too, with triggers; these are the same rules expressed where a developer meets them
 * first.
 *
 * Every read is tenant-scoped by the transaction's `app.tenant_id`, and every collection read takes
 * a bound.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TItem> {
  readonly items: readonly TItem[];
  readonly total: number;
}

export interface TemplateStore {
  byId(transaction: Transaction, id: string): Promise<LetterTemplateState | undefined>;
  byCode(transaction: Transaction, code: string): Promise<LetterTemplateState | undefined>;
  all(transaction: Transaction): Promise<readonly LetterTemplateState[]>;
  insert(transaction: Transaction, state: LetterTemplateState): Promise<void>;
  update(transaction: Transaction, state: LetterTemplateState, expected: number): Promise<void>;
}

export interface TemplateVersionStore {
  byId(transaction: Transaction, id: string): Promise<LetterTemplateVersionState | undefined>;
  forTemplate(
    transaction: Transaction,
    templateId: string,
  ): Promise<readonly LetterTemplateVersionState[]>;
  /** The highest version number written for a template, or 0. Read inside the writing transaction. */
  highestVersionNumber(transaction: Transaction, templateId: string): Promise<number>;
  insert(transaction: Transaction, state: LetterTemplateVersionState): Promise<void>;
  /**
   * Updates a version that has issued nothing.
   *
   * A version that has issued a letter is frozen: editing it would silently change what a
   * historical letter claims to have been generated from. The domain refuses it, and a trigger
   * refuses it again.
   */
  update(
    transaction: Transaction,
    state: LetterTemplateVersionState,
    expected: number,
  ): Promise<void>;
  /** Stamps the moment this version first issued a letter. The freeze, recorded. */
  markFirstIssued(transaction: Transaction, id: string, moment: Date): Promise<void>;
}

/** How the letter register may be narrowed. Every field optional; the tenant bound is not. */
export interface LetterFilters {
  readonly letterTemplateId?: string;
  readonly employmentId?: string;
  readonly personId?: string;
  readonly status?: string;
}

export interface LetterRequestStore {
  byId(transaction: Transaction, id: string): Promise<LetterRequestState | undefined>;
  search(
    transaction: Transaction,
    filters: LetterFilters,
    paged: Paged,
  ): Promise<Page<LetterRequestState>>;
  insert(transaction: Transaction, state: LetterRequestState): Promise<void>;
  update(transaction: Transaction, state: LetterRequestState, expected: number): Promise<void>;
}

export interface IssuedLetterStore {
  byId(transaction: Transaction, id: string): Promise<IssuedLetterState | undefined>;
  byRequest(transaction: Transaction, requestId: string): Promise<IssuedLetterState | undefined>;
  /** The third-party verification lookup. Takes the token and nothing else. */
  byVerificationToken(
    transaction: Transaction,
    token: string,
  ): Promise<IssuedLetterState | undefined>;
  search(
    transaction: Transaction,
    filters: LetterFilters,
    paged: Paged,
  ): Promise<Page<IssuedLetterState>>;
  insert(transaction: Transaction, state: IssuedLetterState): Promise<void>;
  /** The only permitted touch, and it is a stamp: a correction supersedes, it does not rewrite. */
  supersede(
    transaction: Transaction,
    id: string,
    supersededById: string,
    moment: Date,
  ): Promise<void>;
}

export interface ApprovalDecisionStore {
  forRequest(
    transaction: Transaction,
    requestId: string,
  ): Promise<readonly ApprovalDecisionState[]>;
  insert(transaction: Transaction, state: ApprovalDecisionState): Promise<void>;
}

/**
 * The tenant-scoped, gapless counter behind a letter's reference number.
 *
 * Its own table rather than Employment's: the schema records that sharing a counter across modules
 * would couple them (D-20). Deliberately not a PostgreSQL sequence — a sequence is neither
 * tenant-scoped nor transactional, and a rolled-back issue would burn a number and leave a
 * permanent gap in a customer's letter register that nobody could explain (ADR-0039).
 */
export interface NumberSequenceStore {
  allocate(transaction: Transaction, seriesKey: string): Promise<number>;
}

/** What reconciliation found. It reports; it repairs nothing (D-22). */
export interface ReconciliationFinding {
  readonly finding: string;
  readonly letterRequestId: string;
  readonly issuedLetterId?: string;
  readonly detail?: Readonly<Record<string, string>>;
}

export interface LettersReconciliationStore {
  /** Requests stuck mid-flight: `generating` with nothing issued, or `issued` with no letter row. */
  incompleteIssuance(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
  /** Issued letters whose template version is not the one the request named. */
  templateVersionMismatch(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
  /** Requests approved by a chain that no longer stands, and issued anyway. */
  approvalInconsistency(
    transaction: Transaction,
    limit: number,
  ): Promise<readonly ReconciliationFinding[]>;
}

export interface LettersStores {
  readonly templates: TemplateStore;
  readonly templateVersions: TemplateVersionStore;
  readonly requests: LetterRequestStore;
  readonly issued: IssuedLetterStore;
  readonly decisions: ApprovalDecisionStore;
  readonly numbers: NumberSequenceStore;
  readonly reconciliation: LettersReconciliationStore;
}

/** Who a letter is about. Both identifiers, because the sources are keyed differently. */
export interface LetterSubject {
  readonly employmentId: string;
  readonly personId: string;
}

/**
 * One source's answer, and the version of what it answered from.
 *
 * `sourceVersion` is frozen beside the values on issue. It is what makes a letter reproducible: an
 * investigator can say which revision of the employment record a March certificate was generated
 * from, without re-reading a record that has since changed.
 */
export interface SourceFacts {
  readonly values: Readonly<Record<string, string>>;
  readonly sourceVersion: string;
}

/**
 * A module that can answer for one exposable field.
 *
 * Every one of these is implemented by the composition root against the owning module's **published
 * queries** under a bounded service grant (ADR-0043). Letters reads no other module's tables.
 *
 * Returning `undefined` means **could not be asked** — an outage — and is not the same as "no
 * facts". The distinction matters here more than almost anywhere: a source that fails silently
 * produces a bank letter stating an employee earns nothing.
 */
export interface LetterSourcePort {
  factsFor(subject: LetterSubject): Promise<SourceFacts | undefined>;
}

export type LetterSources = Readonly<Partial<Record<ExposableField, LetterSourcePort>>>;

/**
 * The unguessable half of a letter's identity.
 *
 * Separate from the reference number by design (D-20): the reference is printed on the letter and
 * is sequential, so it is guessable by construction. Third-party verification takes the token and
 * nothing else, and reveals authenticity **without** employee data — so a token somebody could
 * enumerate would be a public register of who works where.
 */
export interface VerificationTokenPort {
  issue(): string;
}

export interface Clock {
  now(): Date;
}
