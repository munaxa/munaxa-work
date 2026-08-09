import type { Transaction } from '@work/kernel';

import type { ApplicationState } from '../domain/application.js';
import type { ApplicationEventState } from '../domain/application-event.js';
import type { BilingualText } from '../domain/recruitment-aggregate.js';
import type { CandidateState } from '../domain/candidate.js';
import type { CandidateProfileEntryState } from '../domain/candidate-profile.js';
import type { InterviewFeedbackState, InterviewState } from '../domain/interview.js';
import type { OfferState } from '../domain/offer.js';
import type { RequisitionDecisionState, RequisitionState } from '../domain/requisition.js';
import type { VacancyState } from '../domain/vacancy.js';

/**
 * What the application layer needs from persistence and from the modules Recruitment depends on,
 * stated as interfaces it owns.
 *
 * The dependency points inward: the application declares what it needs and infrastructure
 * implements it, which is what lets every use case in this module be tested against fakes with no
 * database present. Every persistence method takes the `Transaction`, so a use case cannot
 * accidentally read outside the unit of work it is writing in.
 */

export interface Paged {
  readonly limit: number;
  readonly offset: number;
}

export interface Page<TState> {
  readonly items: readonly TState[];
  readonly total: number;
}

export interface RequisitionQuery extends Paged {
  /** Matches the requisition number. Never a person's name — Recruitment holds none. */
  readonly term?: string;
  readonly status?: string;
  readonly positionId?: string;
  readonly unitId?: string;
  readonly hiringManagerEmploymentId?: string;
}

export interface RequisitionStore {
  byId(transaction: Transaction, id: string): Promise<RequisitionState | undefined>;
  search(transaction: Transaction, query: RequisitionQuery): Promise<Page<RequisitionState>>;
  all(transaction: Transaction): Promise<readonly RequisitionState[]>;
  insert(transaction: Transaction, state: RequisitionState): Promise<void>;
  update(transaction: Transaction, state: RequisitionState, expected: number): Promise<void>;
}

/** Decisions are appended, never updated — so the store offers no update. */
export interface RequisitionDecisionStore {
  forRequisition(
    transaction: Transaction,
    requisitionId: string,
  ): Promise<readonly RequisitionDecisionState[]>;
  insert(transaction: Transaction, state: RequisitionDecisionState): Promise<void>;
}

export interface VacancyQuery extends Paged {
  readonly status?: string;
  readonly requisitionId?: string;
}

export interface VacancyStore {
  byId(transaction: Transaction, id: string): Promise<VacancyState | undefined>;
  forRequisition(transaction: Transaction, requisitionId: string): Promise<readonly VacancyState[]>;
  search(transaction: Transaction, query: VacancyQuery): Promise<Page<VacancyState>>;
  all(transaction: Transaction): Promise<readonly VacancyState[]>;
  insert(transaction: Transaction, state: VacancyState): Promise<void>;
  update(transaction: Transaction, state: VacancyState, expected: number): Promise<void>;
}

/**
 * What a candidate search may filter on.
 *
 * `email` and `phone` are **normalized and indexed** — the two filters a recruiter actually has and
 * the two that are fast under row-level security. `term` matches the candidate number and the
 * display name, and the name half is a sequential scan for the documented reason: `ilike` is not
 * leakproof, so the planner will not use a trigram index ahead of the security qual. Measured
 * rather than assumed, and not fixed by weakening isolation (A-9).
 */
export interface CandidateQuery extends Paged {
  readonly term?: string;
  readonly status?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly sourceCode?: string;
  readonly personId?: string;
  /** Candidates holding a profile entry with this code — a skill, a language, a qualification. */
  readonly profileCode?: string;
}

export interface CandidateStore {
  byId(transaction: Transaction, id: string): Promise<CandidateState | undefined>;
  byIds(transaction: Transaction, ids: readonly string[]): Promise<readonly CandidateState[]>;
  /** The duplicate check a create runs. Normalized before it is compared. */
  byEmail(transaction: Transaction, email: string): Promise<CandidateState | undefined>;
  byPersonId(transaction: Transaction, personId: string): Promise<CandidateState | undefined>;
  search(transaction: Transaction, query: CandidateQuery): Promise<Page<CandidateState>>;
  all(transaction: Transaction): Promise<readonly CandidateState[]>;
  insert(transaction: Transaction, state: CandidateState): Promise<void>;
  update(transaction: Transaction, state: CandidateState, expected: number): Promise<void>;
}

export interface ProfileEntryStore {
  byId(transaction: Transaction, id: string): Promise<CandidateProfileEntryState | undefined>;
  forCandidate(
    transaction: Transaction,
    candidateId: string,
  ): Promise<readonly CandidateProfileEntryState[]>;
  forCandidates(
    transaction: Transaction,
    candidateIds: readonly string[],
  ): Promise<readonly CandidateProfileEntryState[]>;
  insert(transaction: Transaction, state: CandidateProfileEntryState): Promise<void>;
  update(
    transaction: Transaction,
    state: CandidateProfileEntryState,
    expected: number,
  ): Promise<void>;
}

export interface ApplicationQuery extends Paged {
  readonly term?: string;
  readonly status?: string;
  readonly vacancyId?: string;
  readonly candidateId?: string;
  readonly stageCode?: string;
  /** Applications whose hire started and did not finish — the reconciliation query. */
  readonly unfinishedHire?: boolean;
}

export interface ApplicationStore {
  byId(transaction: Transaction, id: string): Promise<ApplicationState | undefined>;
  /** The one-per-pair check a submission runs, so a re-application reopens rather than duplicates. */
  byCandidateAndVacancy(
    transaction: Transaction,
    candidateId: string,
    vacancyId: string,
  ): Promise<ApplicationState | undefined>;
  forCandidate(transaction: Transaction, candidateId: string): Promise<readonly ApplicationState[]>;
  search(transaction: Transaction, query: ApplicationQuery): Promise<Page<ApplicationState>>;
  /** Counts per status for one vacancy — the pipeline board, without loading its applications. */
  countByStatus(
    transaction: Transaction,
    vacancyId: string,
  ): Promise<Readonly<Record<string, number>>>;
  all(transaction: Transaction): Promise<readonly ApplicationState[]>;
  insert(transaction: Transaction, state: ApplicationState): Promise<void>;
  update(transaction: Transaction, state: ApplicationState, expected: number): Promise<void>;
}

/** Pipeline history is appended, never updated. */
export interface ApplicationEventStore {
  forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly ApplicationEventState[]>;
  insert(transaction: Transaction, state: ApplicationEventState): Promise<void>;
}

export interface InterviewStore {
  byId(transaction: Transaction, id: string): Promise<InterviewState | undefined>;
  forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly InterviewState[]>;
  forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly InterviewState[]>;
  /** Interviews in a window, for the schedule screen. Bounded by the window, never by the tenant. */
  scheduledBetween(
    transaction: Transaction,
    from: Date,
    to: Date,
  ): Promise<readonly InterviewState[]>;
  all(transaction: Transaction): Promise<readonly InterviewState[]>;
  insert(transaction: Transaction, state: InterviewState): Promise<void>;
  update(transaction: Transaction, state: InterviewState, expected: number): Promise<void>;
}

/** Feedback is written once and never updated — so the store offers no update. */
export interface FeedbackStore {
  forInterview(
    transaction: Transaction,
    interviewId: string,
  ): Promise<readonly InterviewFeedbackState[]>;
  forInterviews(
    transaction: Transaction,
    interviewIds: readonly string[],
  ): Promise<readonly InterviewFeedbackState[]>;
  byInterviewer(
    transaction: Transaction,
    interviewId: string,
    interviewerEmploymentId: string,
  ): Promise<InterviewFeedbackState | undefined>;
  insert(transaction: Transaction, state: InterviewFeedbackState): Promise<void>;
}

export interface OfferStore {
  byId(transaction: Transaction, id: string): Promise<OfferState | undefined>;
  forApplication(transaction: Transaction, applicationId: string): Promise<readonly OfferState[]>;
  forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly OfferState[]>;
  all(transaction: Transaction): Promise<readonly OfferState[]>;
  insert(transaction: Transaction, state: OfferState): Promise<void>;
  update(transaction: Transaction, state: OfferState, expected: number): Promise<void>;
}

/**
 * The counter recruitment's business numbers are drawn from.
 *
 * Recruitment's own, not Employment's (A-8). `allocate` takes the next value and locks the row for
 * the rest of the transaction, so two concurrent creates in one tenant cannot receive the same
 * number. A PostgreSQL sequence is refused for the reasons ADR-0039 gives: not tenant-scoped, and
 * not transactional.
 */
export interface NumberSequenceStore {
  allocate(transaction: Transaction, seriesKey: string): Promise<number>;
}

/** Everything this module's use cases persist, in one injectable bundle. */
export interface RecruitmentStores {
  readonly requisitions: RequisitionStore;
  readonly decisions: RequisitionDecisionStore;
  readonly vacancies: VacancyStore;
  readonly candidates: CandidateStore;
  readonly profileEntries: ProfileEntryStore;
  readonly applications: ApplicationStore;
  readonly applicationEvents: ApplicationEventStore;
  readonly interviews: InterviewStore;
  readonly feedback: FeedbackStore;
  readonly offers: OfferStore;
  readonly numbers: NumberSequenceStore;
}

/**
 * What Recruitment needs of People, and nothing more.
 *
 * A port rather than a query, because People owns the person and this module may not read its
 * tables. **Every method here runs under a bounded service grant** (ADR-0043): the recruiter is
 * authorized for the *recruitment* operation, and the module — not the user — holds the narrow
 * People permission the check needs. That is what keeps `people.person.manage` off every
 * recruiter's role.
 *
 * The shapes carry **no personal data beyond a name**: matching is by email and telephone, both of
 * which the caller already supplied.
 */
export interface MatchedPerson {
  readonly personId: string;
  readonly status: string;
  readonly mergedIntoPersonId?: string;
  /** Whatever People published, in whichever languages it holds. Never narrowed here. */
  readonly legalName?: Readonly<Record<string, string>>;
}

export interface CreatePersonForHire {
  /**
   * The customer's own person number.
   *
   * Supplied by the operator running the hire rather than generated here: People takes a
   * caller-supplied number because it is the *customer's* identifier, and a number Recruitment
   * invented would be this module deciding another module's numbering scheme (A-8's rule, applied
   * in the other direction).
   */
  readonly personNumber: string;
  readonly legalName: BilingualText;
  readonly email: string;
  readonly phone?: string;
}

export interface PeopleDirectoryPort {
  /**
   * Somebody already in the register with this contact point.
   *
   * Returns *candidates for a human decision*, never an automatic match. Two people share a family
   * email address more often than a product designer expects, and a system that merged on one would
   * attach somebody's career to their spouse.
   */
  findByContact(email: string, phone: string | undefined): Promise<readonly MatchedPerson[]>;
  find(personId: string): Promise<MatchedPerson | undefined>;
  /** Creates a Person through People's own application service. Never a row this module writes. */
  create(request: CreatePersonForHire): Promise<MatchedPerson>;
}

/**
 * What Recruitment needs of Organization: whether a reference is real, in this tenant.
 *
 * Existence only — a boolean, never data. The recruiter naming a position on a requisition does not
 * thereby become somebody who may browse the organization chart, which is the whole point of A-1.
 */
export interface OrganizationDirectoryPort {
  unitExists(unitId: string): Promise<boolean>;
}

/**
 * What Recruitment needs of Employment: that an employment is real and in this tenant, and the
 * ability to create one at hire through Employment's own application service.
 *
 * `create` is the one cross-module **write** in this module, and it is the reason the service grant
 * exists rather than a broad permission on every recruiter. Recruitment duplicates none of
 * Employment's logic and touches none of its repositories: it sends the command an administrator
 * would send.
 */
export interface CreateEmploymentForHire {
  readonly personId: string;
  readonly employmentTypeCode: string;
  readonly startDate: string;
}

export interface EmploymentDirectoryPort {
  exists(employmentId: string): Promise<boolean>;
  create(request: CreateEmploymentForHire): Promise<{ readonly employmentId: string }>;
}

/** The clock, injected so recorded instants are testable. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
