import type { BilingualText, Metadata } from '../domain/recruitment-aggregate.js';
import type {
  ApplicationStatus,
  CandidateStatus,
  HireState,
  InterviewStatus,
  OfferStatus,
  ProfileEntryKind,
  Recommendation,
  RequisitionStatus,
  ScreeningOutcome,
  VacancyStatus,
} from '../domain/recruitment-vocabulary.js';

/**
 * What Recruitment publishes, and the shape every consumer of it sees.
 *
 * Three omissions are the contract rather than accidents of scope.
 *
 * **No candidate carries a government identifier, a date of birth or a nationality** (A-2). A
 * candidate is not a Person, and identity-sensitive data is collected by People at hire from
 * somebody who has agreed to join.
 *
 * **An offer's compensation is opaque** (A-5): a map this module stores as authored, publishes
 * unchanged and never computes with. Compensation (Phase 10) is authoritative for what anybody is
 * actually paid, and a resolved figure published here would re-resolve to next year's numbers when
 * somebody asked what was accepted last year.
 *
 * **A hire publishes its state, not just its success.** `hireState` is on the application view
 * because a hire that stopped half way is a fact operations must be able to see (ADR-0046) — a view
 * that showed only `hired` or `not hired` would make a partial transition invisible.
 *
 * Absent rather than null throughout: a consumer receiving `rejectionReasonCode: null` cannot tell
 * "not rejected" from "we did not record why".
 */

export interface RequisitionView {
  readonly requisitionId: string;
  readonly requisitionNumber: string;
  readonly status: RequisitionStatus;
  readonly positionId: string;
  readonly unitId: string;
  readonly costCenterId?: string;
  readonly headcountRequested: number;
  readonly headcountFilled: number;
  readonly headcountRemaining: number;
  readonly reasonCode: string;
  readonly priorityCode?: string;
  readonly targetStartDate?: string;
  readonly requestedByEmploymentId: string;
  readonly hiringManagerEmploymentId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

/** Who decided, when, and why. Append-only: a reversal is another row, never an edit. */
export interface RequisitionDecisionView {
  readonly decisionId: string;
  readonly requisitionId: string;
  readonly decision: 'approved' | 'rejected' | 'reversed';
  readonly reasonCode?: string;
  readonly note?: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
  readonly reversesId?: string;
}

export interface RequisitionSnapshot {
  readonly requisition: RequisitionView;
  readonly decisions: readonly RequisitionDecisionView[];
  readonly vacancies: readonly VacancyView[];
}

export interface VacancyView {
  readonly vacancyId: string;
  readonly requisitionId: string;
  readonly title: BilingualText;
  readonly description?: BilingualText;
  readonly status: VacancyStatus;
  readonly channels: readonly string[];
  readonly openedOn?: string;
  readonly closesOn?: string;
  readonly closedReasonCode?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CandidateView {
  readonly candidateId: string;
  readonly candidateNumber: string;
  readonly status: CandidateStatus;
  readonly displayName: BilingualText;
  readonly email: string;
  readonly phone?: string;
  readonly sourceCode: string;
  /** Present only once a recruiter linked this candidate to a Person, or a hire did. */
  readonly personId?: string;
  /** Set when personal data was removed under a retention policy. The record still resolves. */
  readonly anonymizedAt?: Date;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface ProfileEntryView {
  readonly entryId: string;
  readonly candidateId: string;
  readonly kind: ProfileEntryKind;
  readonly code?: string;
  readonly title: BilingualText;
  readonly organizationName?: BilingualText;
  readonly fromDate?: string;
  readonly toDate?: string;
  readonly levelCode?: string;
  readonly documentReference?: string;
  readonly version: number;
}

export interface CandidateSnapshot {
  readonly candidate: CandidateView;
  readonly profile: readonly ProfileEntryView[];
  readonly applications: readonly ApplicationView[];
}

export interface ApplicationView {
  readonly applicationId: string;
  readonly applicationNumber: string;
  readonly candidateId: string;
  readonly vacancyId: string;
  readonly status: ApplicationStatus;
  readonly stageCode?: string;
  readonly sourceCode: string;
  readonly appliedOn: string;
  readonly screeningOutcome?: ScreeningOutcome;
  readonly rejectionReasonCode?: string;
  /** How far a hire got. Absent means none was attempted. */
  readonly hireState?: HireState;
  readonly hireFailureReason?: string;
  readonly employmentId?: string;
  readonly version: number;
}

export interface ApplicationEventView {
  readonly eventId: string;
  readonly applicationId: string;
  readonly fromStatus?: ApplicationStatus;
  readonly toStatus: ApplicationStatus;
  readonly stageCode?: string;
  readonly reasonCode?: string;
  readonly note?: string;
  readonly occurredAt: Date;
  readonly recordedBy: string;
}

export interface ApplicationSnapshot {
  readonly application: ApplicationView;
  readonly history: readonly ApplicationEventView[];
  readonly interviews: readonly InterviewView[];
  readonly offers: readonly OfferView[];
}

export interface InterviewView {
  readonly interviewId: string;
  readonly applicationId: string;
  readonly roundNumber: number;
  readonly stageCode?: string;
  readonly modeCode: string;
  readonly status: InterviewStatus;
  readonly scheduledFrom?: Date;
  readonly scheduledTo?: Date;
  readonly locationText?: string;
  readonly meetingReference?: string;
  /** Employments, never names. Recruitment stores no copy of an employee's details (A-6). */
  readonly interviewerEmploymentIds: readonly string[];
  readonly cancelledReasonCode?: string;
  readonly version: number;
}

/**
 * One interviewer's verdict.
 *
 * Published behind its own permission, and **never aggregated by this module**: whether three fours
 * beat one five is a hiring policy, and a formula shipped here would be a business rule invented
 * where the specification is silent.
 */
export interface FeedbackView {
  readonly feedbackId: string;
  readonly interviewId: string;
  readonly interviewerEmploymentId: string;
  readonly score?: number;
  readonly recommendation: Recommendation;
  readonly strengths?: string;
  readonly concerns?: string;
  readonly submittedAt: Date;
}

export interface OfferView {
  readonly offerId: string;
  readonly applicationId: string;
  readonly offerNumber: string;
  readonly offerVersion: number;
  readonly status: OfferStatus;
  readonly proposedStartDate: string;
  readonly expiresOn?: string;
  readonly proposedPositionId?: string;
  readonly proposedUnitId?: string;
  readonly proposedEmploymentTypeCode?: string;
  /** As authored, never interpreted (A-5). */
  readonly proposedCompensation: Metadata;
  readonly currencyCode?: string;
  readonly decisionNote?: string;
  readonly issuedAt?: Date;
  readonly decidedAt?: Date;
  readonly decidedBy?: string;
  readonly documentReference?: string;
  readonly version: number;
}

/** The pipeline board for one vacancy: counts per status, without loading its applications. */
export interface PipelineView {
  readonly vacancyId: string;
  readonly countsByStatus: Readonly<Record<string, number>>;
  readonly total: number;
}

/** What an export produces. Candidate contact details are personal data; the permission is separate. */
export interface RecruitmentExport {
  readonly generatedAt: Date;
  readonly candidates: readonly CandidateView[];
  readonly applications: readonly ApplicationView[];
}
