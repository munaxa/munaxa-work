import type { Transaction } from '@work/kernel';

import { normalizeEmail } from '../domain/recruitment-vocabulary.js';
import type { ApplicationState } from '../domain/application.js';
import type { ApplicationEventState } from '../domain/application-event.js';
import type { CandidateState } from '../domain/candidate.js';
import type { CandidateProfileEntryState } from '../domain/candidate-profile.js';
import type { InterviewFeedbackState, InterviewState } from '../domain/interview.js';
import type { OfferState } from '../domain/offer.js';
import type { RequisitionDecisionState, RequisitionState } from '../domain/requisition.js';
import type { VacancyState } from '../domain/vacancy.js';

import { InMemoryStore, equalWhereGiven, paged, scoped } from './in-memory-store.js';
import type {
  ApplicationQuery,
  ApplicationStore,
  CandidateQuery,
  CandidateStore,
  NumberSequenceStore,
  Page,
  RecruitmentStores,
  RequisitionQuery,
  RequisitionStore,
  VacancyQuery,
  VacancyStore,
} from './recruitment-ports.js';

/** In-memory implementations of every store, for the application and API suites. */

class InMemoryRequisitionStore extends InMemoryStore<RequisitionState> implements RequisitionStore {
  public search(
    transaction: Transaction,
    query: RequisitionQuery,
  ): Promise<Page<RequisitionState>> {
    const matched = this.scoped(transaction)
      .filter(
        (row) =>
          equalWhereGiven(row.status, query.status) &&
          equalWhereGiven(row.positionId, query.positionId) &&
          equalWhereGiven(row.unitId, query.unitId) &&
          equalWhereGiven(row.hiringManagerEmploymentId, query.hiringManagerEmploymentId) &&
          (query.term === undefined ||
            row.requisitionNumber.toLowerCase().includes(query.term.toLowerCase())),
      )
      .sort((left, right) => left.requisitionNumber.localeCompare(right.requisitionNumber));

    return Promise.resolve(paged(matched, query));
  }
}

class InMemoryDecisionStore {
  public readonly rows: RequisitionDecisionState[] = [];

  public forRequisition(
    transaction: Transaction,
    requisitionId: string,
  ): Promise<readonly RequisitionDecisionState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction)
        .filter((row) => row.requisitionId === requisitionId)
        .sort((left, right) => left.decidedAt.getTime() - right.decidedAt.getTime()),
    );
  }

  public insert(_transaction: Transaction, state: RequisitionDecisionState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryVacancyStore extends InMemoryStore<VacancyState> implements VacancyStore {
  public forRequisition(
    transaction: Transaction,
    requisitionId: string,
  ): Promise<readonly VacancyState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.requisitionId === requisitionId),
    );
  }

  public search(transaction: Transaction, query: VacancyQuery): Promise<Page<VacancyState>> {
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.status, query.status) &&
        equalWhereGiven(row.requisitionId, query.requisitionId),
    );

    return Promise.resolve(paged(matched, query));
  }
}

class InMemoryCandidateStore extends InMemoryStore<CandidateState> implements CandidateStore {
  public byEmail(transaction: Transaction, email: string): Promise<CandidateState | undefined> {
    const needle = normalizeEmail(email);

    return Promise.resolve(this.scoped(transaction).find((row) => row.email === needle));
  }

  public byPersonId(
    transaction: Transaction,
    personId: string,
  ): Promise<CandidateState | undefined> {
    return Promise.resolve(this.scoped(transaction).find((row) => row.personId === personId));
  }

  /**
   * The filters the fake answers.
   *
   * `profileCode` is deliberately absent: it is a subquery against the profile table, and
   * reimplementing it here would be a second, subtly different search that tests would pass against
   * and production would not. It is covered by the integration suite, against the real query.
   */
  public search(transaction: Transaction, query: CandidateQuery): Promise<Page<CandidateState>> {
    const term = query.term?.toLowerCase();
    const matched = this.scoped(transaction)
      .filter(
        (row) =>
          equalWhereGiven(row.status, query.status) &&
          equalWhereGiven(row.sourceCode, query.sourceCode) &&
          equalWhereGiven(row.personId, query.personId) &&
          equalWhereGiven(row.phone, query.phone) &&
          (query.email === undefined || row.email === normalizeEmail(query.email)) &&
          (term === undefined || matchesCandidateTerm(row, term)),
      )
      .sort((left, right) => left.candidateNumber.localeCompare(right.candidateNumber));

    return Promise.resolve(paged(matched, query));
  }
}

/** The same two languages the SQL matches on, so the fake and the real query agree. */
const matchesCandidateTerm = (row: CandidateState, term: string): boolean =>
  [row.candidateNumber, row.displayName.en, row.displayName.ar].some((value) =>
    value.toLowerCase().includes(term),
  );

class InMemoryProfileEntryStore extends InMemoryStore<CandidateProfileEntryState> {
  public forCandidate(
    transaction: Transaction,
    candidateId: string,
  ): Promise<readonly CandidateProfileEntryState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.candidateId === candidateId),
    );
  }

  public forCandidates(
    transaction: Transaction,
    candidateIds: readonly string[],
  ): Promise<readonly CandidateProfileEntryState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => candidateIds.includes(row.candidateId)),
    );
  }
}

class InMemoryApplicationStore extends InMemoryStore<ApplicationState> implements ApplicationStore {
  public byCandidateAndVacancy(
    transaction: Transaction,
    candidateId: string,
    vacancyId: string,
  ): Promise<ApplicationState | undefined> {
    return Promise.resolve(
      this.scoped(transaction).find(
        (row) => row.candidateId === candidateId && row.vacancyId === vacancyId,
      ),
    );
  }

  public forCandidate(
    transaction: Transaction,
    candidateId: string,
  ): Promise<readonly ApplicationState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => row.candidateId === candidateId),
    );
  }

  public search(
    transaction: Transaction,
    query: ApplicationQuery,
  ): Promise<Page<ApplicationState>> {
    const term = query.term?.toLowerCase();
    const matched = this.scoped(transaction).filter(
      (row) =>
        equalWhereGiven(row.status, query.status) &&
        equalWhereGiven(row.vacancyId, query.vacancyId) &&
        equalWhereGiven(row.candidateId, query.candidateId) &&
        equalWhereGiven(row.stageCode, query.stageCode) &&
        unfinishedWhereAsked(row, query.unfinishedHire) &&
        (term === undefined || row.applicationNumber.toLowerCase().includes(term)),
    );

    return Promise.resolve(paged(matched, query));
  }

  public countByStatus(
    transaction: Transaction,
    vacancyId: string,
  ): Promise<Readonly<Record<string, number>>> {
    const counts: Record<string, number> = {};

    for (const row of this.scoped(transaction).filter((item) => item.vacancyId === vacancyId)) {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
    }
    return Promise.resolve(counts);
  }
}

/** A hire that began and did not finish — the reconciliation filter (ADR-0046). */
const unfinishedWhereAsked = (row: ApplicationState, unfinished: boolean | undefined): boolean =>
  unfinished !== true ||
  (row.hireState !== undefined && row.hireState !== 'completed' && row.status !== 'hired');

class InMemoryApplicationEventStore {
  public readonly rows: ApplicationEventState[] = [];

  public forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly ApplicationEventState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.applicationId === applicationId),
    );
  }

  public insert(_transaction: Transaction, state: ApplicationEventState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryInterviewStore extends InMemoryStore<InterviewState> {
  public forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly InterviewState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.applicationId === applicationId)
        .sort((left, right) => left.roundNumber - right.roundNumber),
    );
  }

  public forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly InterviewState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => applicationIds.includes(row.applicationId)),
    );
  }

  public scheduledBetween(
    transaction: Transaction,
    from: Date,
    to: Date,
  ): Promise<readonly InterviewState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter(
        (row) =>
          row.scheduledFrom !== undefined &&
          row.scheduledFrom.getTime() >= from.getTime() &&
          row.scheduledFrom.getTime() < to.getTime(),
      ),
    );
  }
}

class InMemoryFeedbackStore {
  public readonly rows: InterviewFeedbackState[] = [];

  public forInterview(
    transaction: Transaction,
    interviewId: string,
  ): Promise<readonly InterviewFeedbackState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => row.interviewId === interviewId),
    );
  }

  public forInterviews(
    transaction: Transaction,
    interviewIds: readonly string[],
  ): Promise<readonly InterviewFeedbackState[]> {
    return Promise.resolve(
      scoped(this.rows, transaction).filter((row) => interviewIds.includes(row.interviewId)),
    );
  }

  public byInterviewer(
    transaction: Transaction,
    interviewId: string,
    interviewerEmploymentId: string,
  ): Promise<InterviewFeedbackState | undefined> {
    return Promise.resolve(
      scoped(this.rows, transaction).find(
        (row) =>
          row.interviewId === interviewId &&
          row.interviewerEmploymentId === interviewerEmploymentId,
      ),
    );
  }

  public insert(_transaction: Transaction, state: InterviewFeedbackState): Promise<void> {
    this.rows.push({ ...state, version: 1 });
    return Promise.resolve();
  }
}

class InMemoryOfferStore extends InMemoryStore<OfferState> {
  public forApplication(
    transaction: Transaction,
    applicationId: string,
  ): Promise<readonly OfferState[]> {
    return Promise.resolve(
      this.scoped(transaction)
        .filter((row) => row.applicationId === applicationId)
        .sort((left, right) => left.offerVersion - right.offerVersion),
    );
  }

  public forApplications(
    transaction: Transaction,
    applicationIds: readonly string[],
  ): Promise<readonly OfferState[]> {
    return Promise.resolve(
      this.scoped(transaction).filter((row) => applicationIds.includes(row.applicationId)),
    );
  }
}

/** One counter per tenant per series, exactly as the table is. */
class InMemoryNumberSequence implements NumberSequenceStore {
  private readonly counters = new Map<string, number>();

  public allocate(transaction: Transaction, seriesKey: string): Promise<number> {
    const key = `${transaction.tenantId}:${seriesKey}`;
    const next = this.counters.get(key) ?? 1;

    this.counters.set(key, next + 1);
    return Promise.resolve(next);
  }
}

export interface InMemoryRecruitmentStores extends RecruitmentStores {
  readonly requisitions: InMemoryRequisitionStore;
  readonly candidates: InMemoryCandidateStore;
  readonly applications: InMemoryApplicationStore;
  readonly offers: InMemoryOfferStore;
}

export const inMemoryRecruitmentStores = (): InMemoryRecruitmentStores => ({
  requisitions: new InMemoryRequisitionStore(),
  decisions: new InMemoryDecisionStore(),
  vacancies: new InMemoryVacancyStore(),
  candidates: new InMemoryCandidateStore(),
  profileEntries: new InMemoryProfileEntryStore(),
  applications: new InMemoryApplicationStore(),
  applicationEvents: new InMemoryApplicationEventStore(),
  interviews: new InMemoryInterviewStore(),
  feedback: new InMemoryFeedbackStore(),
  offers: new InMemoryOfferStore(),
  numbers: new InMemoryNumberSequence(),
});
