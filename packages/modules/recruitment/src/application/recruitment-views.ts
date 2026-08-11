import type { ApplicationState } from '../domain/application.js';
import type { ApplicationEventState } from '../domain/application-event.js';
import type { CandidateState } from '../domain/candidate.js';
import type { CandidateProfileEntryState } from '../domain/candidate-profile.js';
import type { InterviewFeedbackState, InterviewState } from '../domain/interview.js';
import type { OfferState } from '../domain/offer.js';
import type { RequisitionDecisionState, RequisitionState } from '../domain/requisition.js';
import type { VacancyState } from '../domain/vacancy.js';
import type {
  ApplicationEventView,
  ApplicationView,
  CandidateView,
  FeedbackView,
  InterviewView,
  OfferView,
  ProfileEntryView,
  RequisitionDecisionView,
  RequisitionView,
  VacancyView,
} from '../contracts/views.js';

/**
 * Domain state to published view.
 *
 * In the application layer rather than the domain, because a view answers a consumer's question and
 * the domain has no consumers. Two rules hold throughout: an absent value is **omitted** rather than
 * published as null, and nothing is computed here that the domain does not already assert — the one
 * derived field, `headcountRemaining`, is arithmetic on two published numbers rather than a rule.
 */

export const requisitionView = (state: RequisitionState): RequisitionView => ({
  requisitionId: state.id,
  requisitionNumber: state.requisitionNumber,
  status: state.status,
  positionId: state.positionId,
  unitId: state.unitId,
  ...(state.costCenterId === undefined ? {} : { costCenterId: state.costCenterId }),
  headcountRequested: state.headcountRequested,
  headcountFilled: state.headcountFilled,
  headcountRemaining: state.headcountRequested - state.headcountFilled,
  reasonCode: state.reasonCode,
  ...(state.priorityCode === undefined ? {} : { priorityCode: state.priorityCode }),
  ...(state.targetStartDate === undefined ? {} : { targetStartDate: state.targetStartDate }),
  requestedByEmploymentId: state.requestedByEmploymentId,
  ...(state.hiringManagerEmploymentId === undefined
    ? {}
    : { hiringManagerEmploymentId: state.hiringManagerEmploymentId }),
  metadata: state.metadata,
  version: state.version,
});

export const requisitionDecisionView = (
  state: RequisitionDecisionState,
): RequisitionDecisionView => ({
  decisionId: state.id,
  requisitionId: state.requisitionId,
  decision: state.decision,
  ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  ...(state.note === undefined ? {} : { note: state.note }),
  decidedBy: state.decidedBy,
  decidedAt: state.decidedAt,
  ...(state.reversesId === undefined ? {} : { reversesId: state.reversesId }),
});

export const vacancyView = (state: VacancyState): VacancyView => ({
  vacancyId: state.id,
  requisitionId: state.requisitionId,
  title: state.title,
  ...(state.description === undefined ? {} : { description: state.description }),
  status: state.status,
  channels: state.channels,
  ...(state.openedOn === undefined ? {} : { openedOn: state.openedOn }),
  ...(state.closesOn === undefined ? {} : { closesOn: state.closesOn }),
  ...(state.closedReasonCode === undefined ? {} : { closedReasonCode: state.closedReasonCode }),
  metadata: state.metadata,
  version: state.version,
});

/** The address published is the one the customer typed, not the normalized one matching compares. */
export const candidateView = (state: CandidateState): CandidateView => ({
  candidateId: state.id,
  candidateNumber: state.candidateNumber,
  status: state.status,
  displayName: state.displayName,
  email: state.displayEmail,
  ...(state.phone === undefined ? {} : { phone: state.phone }),
  sourceCode: state.sourceCode,
  ...(state.personId === undefined ? {} : { personId: state.personId }),
  ...(state.anonymizedAt === undefined ? {} : { anonymizedAt: state.anonymizedAt }),
  metadata: state.metadata,
  version: state.version,
});

export const profileEntryView = (state: CandidateProfileEntryState): ProfileEntryView => ({
  entryId: state.id,
  candidateId: state.candidateId,
  kind: state.kind,
  ...(state.code === undefined ? {} : { code: state.code }),
  title: state.title,
  ...(state.organizationName === undefined ? {} : { organizationName: state.organizationName }),
  ...(state.fromDate === undefined ? {} : { fromDate: state.fromDate }),
  ...(state.toDate === undefined ? {} : { toDate: state.toDate }),
  ...(state.levelCode === undefined ? {} : { levelCode: state.levelCode }),
  ...(state.documentReference === undefined ? {} : { documentReference: state.documentReference }),
  version: state.version,
});

/**
 * The application, including how far a hire got.
 *
 * `hireState` is published deliberately: a partial hire is a fact operations must be able to see,
 * and a view that showed only the status would make one invisible until somebody complained.
 */
export const applicationView = (state: ApplicationState): ApplicationView => ({
  applicationId: state.id,
  applicationNumber: state.applicationNumber,
  candidateId: state.candidateId,
  vacancyId: state.vacancyId,
  status: state.status,
  ...(state.stageCode === undefined ? {} : { stageCode: state.stageCode }),
  sourceCode: state.sourceCode,
  appliedOn: state.appliedOn,
  ...(state.screeningOutcome === undefined ? {} : { screeningOutcome: state.screeningOutcome }),
  ...(state.rejectionReasonCode === undefined
    ? {}
    : { rejectionReasonCode: state.rejectionReasonCode }),
  ...(state.hireState === undefined ? {} : { hireState: state.hireState }),
  ...(state.hireFailureReason === undefined ? {} : { hireFailureReason: state.hireFailureReason }),
  ...(state.employmentId === undefined ? {} : { employmentId: state.employmentId }),
  version: state.version,
});

export const applicationEventView = (state: ApplicationEventState): ApplicationEventView => ({
  eventId: state.id,
  applicationId: state.applicationId,
  ...(state.fromStatus === undefined ? {} : { fromStatus: state.fromStatus }),
  toStatus: state.toStatus,
  ...(state.stageCode === undefined ? {} : { stageCode: state.stageCode }),
  ...(state.reasonCode === undefined ? {} : { reasonCode: state.reasonCode }),
  ...(state.note === undefined ? {} : { note: state.note }),
  occurredAt: state.occurredAt,
  recordedBy: state.recordedBy,
});

export const interviewView = (state: InterviewState): InterviewView => ({
  interviewId: state.id,
  applicationId: state.applicationId,
  roundNumber: state.roundNumber,
  ...(state.stageCode === undefined ? {} : { stageCode: state.stageCode }),
  modeCode: state.modeCode,
  status: state.status,
  ...(state.scheduledFrom === undefined ? {} : { scheduledFrom: state.scheduledFrom }),
  ...(state.scheduledTo === undefined ? {} : { scheduledTo: state.scheduledTo }),
  ...(state.locationText === undefined ? {} : { locationText: state.locationText }),
  ...(state.meetingReference === undefined ? {} : { meetingReference: state.meetingReference }),
  interviewerEmploymentIds: state.interviewerEmploymentIds,
  ...(state.cancelledReasonCode === undefined
    ? {}
    : { cancelledReasonCode: state.cancelledReasonCode }),
  version: state.version,
});

export const feedbackView = (state: InterviewFeedbackState): FeedbackView => ({
  feedbackId: state.id,
  interviewId: state.interviewId,
  interviewerEmploymentId: state.interviewerEmploymentId,
  ...(state.score === undefined ? {} : { score: state.score }),
  recommendation: state.recommendation,
  ...(state.strengths === undefined ? {} : { strengths: state.strengths }),
  ...(state.concerns === undefined ? {} : { concerns: state.concerns }),
  submittedAt: state.submittedAt,
});

export const offerView = (state: OfferState): OfferView => ({
  offerId: state.id,
  applicationId: state.applicationId,
  offerNumber: state.offerNumber,
  offerVersion: state.offerVersion,
  status: state.status,
  proposedStartDate: state.proposedStartDate,
  proposedCompensation: state.proposedCompensation,
  ...proposedTermsOf(state),
  ...offerDecisionOf(state),
  version: state.version,
});

/** The terms an offer may not name, hoisted so the view stays inside its complexity budget. */
const proposedTermsOf = (state: OfferState): Partial<OfferView> => ({
  ...(state.expiresOn === undefined ? {} : { expiresOn: state.expiresOn }),
  ...(state.proposedPositionId === undefined
    ? {}
    : { proposedPositionId: state.proposedPositionId }),
  ...(state.proposedUnitId === undefined ? {} : { proposedUnitId: state.proposedUnitId }),
  ...(state.proposedEmploymentTypeCode === undefined
    ? {}
    : { proposedEmploymentTypeCode: state.proposedEmploymentTypeCode }),
  ...(state.currencyCode === undefined ? {} : { currencyCode: state.currencyCode }),
  ...(state.documentReference === undefined ? {} : { documentReference: state.documentReference }),
});

/** What happened to it: issued when, decided when, and by whom. */
const offerDecisionOf = (state: OfferState): Partial<OfferView> => ({
  ...(state.decisionNote === undefined ? {} : { decisionNote: state.decisionNote }),
  ...(state.issuedAt === undefined ? {} : { issuedAt: state.issuedAt }),
  ...(state.decidedAt === undefined ? {} : { decidedAt: state.decidedAt }),
  ...(state.decidedBy === undefined ? {} : { decidedBy: state.decidedBy }),
});

/** Newest first, which is how a pipeline history is read on screen. */
export const byOccurredAtDescending = <TState extends { readonly occurredAt: Date }>(
  left: TState,
  right: TState,
): number => right.occurredAt.getTime() - left.occurredAt.getTime();
