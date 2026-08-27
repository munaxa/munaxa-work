import type {
  ApplicationEventView,
  ApplicationSnapshot,
  ApplicationView,
  CandidateSnapshot,
  CandidateView,
  FeedbackView,
  InterviewView,
  OfferView,
  PipelineView,
  RequisitionDecisionView,
  RequisitionSnapshot,
  RequisitionView,
  VacancyView,
} from '@work/recruitment/contracts';

import type {
  ApplicationForDisplay,
  HiringForDisplay,
  InterviewFeedback,
  Listing,
  RequisitionForDisplay,
  VacancyPipeline,
} from './api';

/**
 * A tenant's hiring, as Recruitment would answer it.
 *
 * Every value is shaped by the module's published contract, so a change to one these screens have
 * not followed fails to compile rather than rendering something wrong. Nothing is invented: no field
 * appears that a contract does not carry.
 *
 * Three properties of these fixtures are the point rather than decoration.
 *
 * **Every total is larger than its page.** A section that reported `items.length` would tell a
 * recruiter with four hundred applicants that they have two, and a fixture whose total happened to
 * equal its length could not catch it.
 *
 * **An offer carries a proposed compensation.** It is here so that a screen which started rendering
 * one would fail a test rather than ship — the figure is in the data and must not reach the markup.
 *
 * **A hire is stopped and a panel disagrees.** `failed` must stay visible, and five verdicts that do
 * not agree must stay five verdicts rather than becoming an average.
 */

const REQUISITION = '01900000-0000-7000-8000-0000000000r1';
const VACANCY = '01900000-0000-7000-8000-0000000000v1';
const APPLICATION = '01900000-0000-7000-8000-0000000000a1';
const CANDIDATE = '01900000-0000-7000-8000-0000000000c1';
const INTERVIEW = '01900000-0000-7000-8000-0000000000i1';
const POSITION = '01900000-0000-7000-8000-0000000000p1';
const UNIT = '01900000-0000-7000-8000-0000000000u1';
const EMPLOYMENT = '01900000-0000-7000-8000-0000000000e1';
const PANELLIST = '01900000-0000-7000-8000-0000000000e2';

export const aRequisition = (): RequisitionView => ({
  requisitionId: REQUISITION,
  requisitionNumber: 'REQ-000417',
  status: 'open',
  positionId: POSITION,
  unitId: UNIT,
  costCenterId: '01900000-0000-7000-8000-0000000000k1',
  headcountRequested: 4,
  headcountFilled: 1,
  headcountRemaining: 3,
  reasonCode: 'growth',
  priorityCode: 'high',
  targetStartDate: '2026-10-01',
  requestedByEmploymentId: EMPLOYMENT,
  hiringManagerEmploymentId: EMPLOYMENT,
  metadata: {},
  version: 3,
});

/** A requisition a routed approval decided, which is a different fact from one decided in-module. */
export const anApprovedRequisition = (): RequisitionView => ({
  ...aRequisition(),
  status: 'approved',
  approvalId: '01900000-0000-7000-8000-0000000000w1',
});

export const aDecision = (): RequisitionDecisionView => ({
  decisionId: '01900000-0000-7000-8000-0000000000d1',
  requisitionId: REQUISITION,
  decision: 'approved',
  reasonCode: 'within_plan',
  note: 'Approved against the annual plan.',
  decidedBy: '01900000-0000-7000-8000-0000000000m1',
  decidedAt: new Date('2026-08-01T08:30:00.000Z'),
});

export const aReversal = (): RequisitionDecisionView => ({
  ...aDecision(),
  decisionId: '01900000-0000-7000-8000-0000000000d2',
  decision: 'reversed',
  reversesId: '01900000-0000-7000-8000-0000000000d1',
  decidedAt: new Date('2026-08-02T11:00:00.000Z'),
});

export const aVacancy = (): VacancyView => ({
  vacancyId: VACANCY,
  requisitionId: REQUISITION,
  title: { en: 'Senior Nurse', ar: 'ممرض أول' },
  status: 'published',
  channels: ['careers-site', 'linkedin'],
  openedOn: '2026-08-05',
  closesOn: '2026-09-30',
  metadata: {},
  version: 2,
});

export const aPipeline = (): PipelineView => ({
  vacancyId: VACANCY,
  countsByStatus: { received: 118, screening: 40, shortlisted: 12, interviewing: 5, offered: 1 },
  total: 176,
});

export const aCandidate = (): CandidateView => ({
  candidateId: CANDIDATE,
  candidateNumber: 'CAN-004192',
  status: 'active',
  displayName: { en: 'Layla Haddad', ar: 'ليلى حداد' },
  email: 'layla.haddad@example.com',
  phone: '+962790000000',
  sourceCode: 'referral',
  metadata: {},
  version: 1,
});

export const anApplication = (): ApplicationView => ({
  applicationId: APPLICATION,
  applicationNumber: 'APP-009913',
  candidateId: CANDIDATE,
  vacancyId: VACANCY,
  status: 'interviewing',
  stageCode: 'panel',
  sourceCode: 'referral',
  appliedOn: '2026-08-11',
  screeningOutcome: 'passed',
  version: 5,
});

/** A hire that registered a person and stopped. The fact ADR-0046 keeps `hireState` for. */
export const aStoppedHire = (): ApplicationView => ({
  ...anApplication(),
  status: 'hired',
  hireState: 'failed',
  hireFailureReason: 'employment_creation_failed',
});

export const anEvent = (): ApplicationEventView => ({
  eventId: '01900000-0000-7000-8000-0000000000h1',
  applicationId: APPLICATION,
  fromStatus: 'shortlisted',
  toStatus: 'interviewing',
  stageCode: 'panel',
  reasonCode: 'panel_scheduled',
  occurredAt: new Date('2026-08-18T13:00:00.000Z'),
  recordedBy: '01900000-0000-7000-8000-0000000000m1',
});

export const anInterview = (): InterviewView => ({
  interviewId: INTERVIEW,
  applicationId: APPLICATION,
  roundNumber: 2,
  stageCode: 'panel',
  modeCode: 'on_site',
  status: 'completed',
  scheduledFrom: new Date('2026-08-20T09:00:00.000Z'),
  scheduledTo: new Date('2026-08-20T10:00:00.000Z'),
  locationText: 'Amman, Room 4',
  interviewerEmploymentIds: [EMPLOYMENT, PANELLIST],
  version: 2,
});

const verdict = (id: string, score: number, recommendation: FeedbackView['recommendation']) => ({
  feedbackId: id,
  interviewId: INTERVIEW,
  interviewerEmploymentId: PANELLIST,
  score,
  recommendation,
  submittedAt: new Date('2026-08-20T11:00:00.000Z'),
});

/** A panel that does not agree. Five verdicts must stay five verdicts. */
export const aPanel = (): readonly FeedbackView[] => [
  verdict('01900000-0000-7000-8000-0000000000f1', 5, 'strong_yes'),
  verdict('01900000-0000-7000-8000-0000000000f2', 4, 'yes'),
  verdict('01900000-0000-7000-8000-0000000000f3', 2, 'no'),
];

export const anOffer = (): OfferView => ({
  offerId: '01900000-0000-7000-8000-0000000000o1',
  applicationId: APPLICATION,
  offerNumber: 'OFF-000221',
  offerVersion: 2,
  status: 'issued',
  proposedStartDate: '2026-11-01',
  expiresOn: '2026-10-10',
  // Present on purpose: the figure is in the contract and must never reach the markup.
  proposedCompensation: { base: '1850.000', allowance: '250.000' },
  currencyCode: 'JOD',
  issuedAt: new Date('2026-09-01T07:00:00.000Z'),
  version: 2,
});

const listing = <TItem>(items: readonly TItem[], total: number): Listing<TItem> => ({
  items,
  total,
});

const pipelines = (): readonly VacancyPipeline[] => [
  { vacancy: aVacancy(), pipeline: aPipeline() },
];

/** Everything answered, with every total larger than its page. */
export const aFullWorkspace = (): HiringForDisplay => ({
  requisitions: listing([aRequisition()], 26),
  vacancies: listing([aVacancy()], 9),
  candidates: listing([aCandidate()], 412),
  applications: listing([anApplication()], 176),
  pipelines: pipelines(),
});

/** Every read refused. The ordinary state of this deployment. */
export const aRefusedWorkspace = (): HiringForDisplay => ({
  requisitions: undefined,
  vacancies: undefined,
  candidates: undefined,
  applications: undefined,
  pipelines: undefined,
});

/** Every read answered with nothing. Deliberately not the same as the above. */
export const anEmptyWorkspace = (): HiringForDisplay => ({
  requisitions: listing([], 0),
  vacancies: listing([], 0),
  candidates: listing([], 0),
  applications: listing([], 0),
  pipelines: [],
});

export const aRequisitionSnapshot = (): RequisitionSnapshot => ({
  requisition: aRequisition(),
  decisions: [aDecision(), aReversal()],
  vacancies: [aVacancy()],
});

export const aRequisitionDetail = (): RequisitionForDisplay => ({
  snapshot: aRequisitionSnapshot(),
  pipelines: pipelines(),
  requestedByName: { en: 'Nadia Fakhoury', ar: 'نادية فاخوري' },
  hiringManagerName: undefined,
});

export const anApplicationSnapshot = (): ApplicationSnapshot => ({
  application: anApplication(),
  history: [anEvent()],
  interviews: [anInterview()],
  offers: [anOffer()],
});

export const aCandidateSnapshot = (): CandidateSnapshot => ({
  candidate: aCandidate(),
  profile: [],
  applications: [anApplication()],
});

const panels = (feedback: readonly FeedbackView[] | undefined): readonly InterviewFeedback[] => [
  { interviewId: INTERVIEW, feedback },
];

export const anApplicationDetail = (): ApplicationForDisplay => ({
  snapshot: anApplicationSnapshot(),
  candidate: aCandidateSnapshot(),
  panels: panels(aPanel()),
});

/** The application reads, and the panel's opinion of the candidate does not. */
export const aWithheldPanel = (): ApplicationForDisplay => ({
  ...anApplicationDetail(),
  panels: panels(undefined),
});

/** The panel answered and nobody has recorded anything yet. Not the same as withheld. */
export const anEmptyPanel = (): ApplicationForDisplay => ({
  ...anApplicationDetail(),
  panels: panels([]),
});

/** The application reads and the candidate does not. */
export const aWithheldCandidate = (): ApplicationForDisplay => ({
  ...anApplicationDetail(),
  candidate: undefined,
});

/** A hire that stopped part way through. */
export const aStoppedHireDetail = (): ApplicationForDisplay => ({
  ...anApplicationDetail(),
  snapshot: { ...anApplicationSnapshot(), application: aStoppedHire() },
});
