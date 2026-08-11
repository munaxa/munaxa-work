/**
 * The public contract of Recruitment.
 *
 * This is the entire surface other modules, the API and the SDK may depend on. Its repositories, its
 * tables and its aggregates are private and stay private.
 *
 * Three entries carry more weight than the rest.
 *
 * `CandidateView` is **not a person**. It carries no government identifier, no date of birth and no
 * nationality (A-2, ADR-0044); a consumer needing those is asking about somebody who works here, and
 * that question belongs to People.
 *
 * `OfferView.proposedCompensation` is **opaque** (A-5). It is what a recruiter proposed, stored as
 * authored and never computed with. Compensation (Phase 10) is authoritative for what anybody is
 * paid, and nothing here should be mistaken for a payroll figure.
 *
 * `ApplicationView.hireState` publishes how far a hire got, precisely so a partial one is visible
 * (ADR-0046). A consumer that reads only `status` will call a stopped hire "not hired", which is
 * true and incomplete; the reconciliation state is what makes it actionable.
 *
 * Contracts are versioned. A breaking change to anything exported here requires an ADR.
 */

export type {
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
 * The status sets themselves, not just their types.
 *
 * A consumer narrowing an untyped string — a request parameter, a row — needs the set, and the
 * alternative is every consumer writing its own copy of the list.
 */
export {
  APPLICATION_STATUSES,
  APPLICATION_TRANSITIONS,
  CANDIDATE_STATUSES,
  HIRE_STATES,
  INTERVIEW_STATUSES,
  OFFER_STATUSES,
  OFFER_TRANSITIONS,
  PROFILE_ENTRY_KINDS,
  RECOMMENDATIONS,
  REQUISITION_STATUSES,
  REQUISITION_TRANSITIONS,
  SCREENING_OUTCOMES,
  VACANCY_STATUSES,
} from '../domain/recruitment-vocabulary.js';

export type {
  ApplicationEventView,
  ApplicationSnapshot,
  ApplicationView,
  CandidateSnapshot,
  CandidateView,
  FeedbackView,
  InterviewView,
  OfferView,
  PipelineView,
  ProfileEntryView,
  RecruitmentExport,
  RequisitionDecisionView,
  RequisitionSnapshot,
  RequisitionView,
  VacancyView,
} from './views.js';
