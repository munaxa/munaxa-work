/**
 * The ubiquitous language of Recruitment, in one file so the API, the contracts and the aggregates
 * cannot drift into three spellings of the same idea.
 *
 * Several words are deliberately absent, and their absence is a boundary being kept rather than
 * described. *Employee*, *employment contract*, *salary*, *grade*, *onboarding task*, *background
 * check*, *visa* and *work permit* appear nowhere: each belongs to another domain or to a country
 * pack. Neither does *national identifier*, *date of birth* or *nationality* — a candidate is not a
 * Person, and identity-sensitive data is collected by People at hire.
 *
 * Two closed sets and one open one is the pattern throughout. A **status** is product behaviour and
 * is checked in the database. A **code** — a reason, a source, a stage, a priority — is tenant or
 * country-pack data, validated by shape and never against a list this product ships (00B).
 */

/**
 * The lifecycle of a requisition: the internal authority to hire.
 *
 * `approved` and `open` are distinct because approval and recruiting are different acts by
 * different people at different times. A requisition approved in December and opened in March was
 * approved once, and the vacancy dates from March.
 *
 * `rejected` and `cancelled` are also distinct: rejected is a decision about the request, cancelled
 * is the business changing its mind. A headcount report that conflated them would misreport why
 * roles were not filled.
 */
export const REQUISITION_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'open',
  'closed',
  'cancelled',
] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export const REQUISITION_TRANSITIONS: Readonly<
  Record<RequisitionStatus, readonly RequisitionStatus[]>
> = {
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'rejected', 'draft', 'cancelled'],
  // A reversal of an approval returns the requisition to `pending_approval`, which is why the
  // decision record and the status move together and neither is edited in place.
  approved: ['open', 'pending_approval', 'cancelled'],
  rejected: ['draft', 'pending_approval'],
  open: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

/** A requisition that may still open vacancies and accept hires against it. */
export const isRequisitionOpen = (status: RequisitionStatus): boolean =>
  status === 'approved' || status === 'open';

export const VACANCY_STATUSES = ['draft', 'published', 'closed'] as const;
export type VacancyStatus = (typeof VACANCY_STATUSES)[number];

/**
 * The candidate's own status, which is **not** the status of any application.
 *
 * Somebody rejected for one role is not a rejected candidate — they are an active candidate with a
 * rejected application, and conflating the two is how a product loses its own talent pool. That is
 * also why `archived` exists and `rejected` does not.
 */
export const CANDIDATE_STATUSES = ['active', 'hired', 'archived'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * The application pipeline. This is the status set every recruitment screen means by "stage".
 *
 * It is **closed**, because it is product behaviour: reporting, permissions and the hire path all
 * branch on it. What a tenant configures is the `stageCode` *within* `interviewing` — "phone
 * screen", "panel", "founder chat" — which is how AD-005's configurable stages are honoured without
 * shipping a workflow builder (00B's rule applied to process rather than to law).
 */
export const APPLICATION_STATUSES = [
  'received',
  'screening',
  'shortlisted',
  'interviewing',
  'evaluated',
  'offered',
  'hired',
  'rejected',
  'withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Forward through the funnel, out of it at any point, and back in only by reopening.
 *
 * `rejected → received` and `withdrawn → received` exist because a candidate re-applying to the
 * same vacancy reopens the application they already have. A second row would make every pipeline
 * count wrong the first time somebody tried again.
 */
export const APPLICATION_TRANSITIONS: Readonly<
  Record<ApplicationStatus, readonly ApplicationStatus[]>
> = {
  received: ['screening', 'shortlisted', 'rejected', 'withdrawn'],
  screening: ['shortlisted', 'interviewing', 'rejected', 'withdrawn'],
  shortlisted: ['interviewing', 'evaluated', 'rejected', 'withdrawn'],
  interviewing: ['evaluated', 'offered', 'rejected', 'withdrawn'],
  evaluated: ['offered', 'shortlisted', 'rejected', 'withdrawn'],
  offered: ['hired', 'rejected', 'withdrawn'],
  hired: [],
  rejected: ['received'],
  withdrawn: ['received'],
};

/** An application that has concluded. Nothing further happens to it without reopening. */
export const isApplicationClosed = (status: ApplicationStatus): boolean =>
  status === 'hired' || status === 'rejected' || status === 'withdrawn';

export const SCREENING_OUTCOMES = ['passed', 'failed', 'on_hold'] as const;
export type ScreeningOutcome = (typeof SCREENING_OUTCOMES)[number];

/**
 * How far a hire got.
 *
 * The unit of work opens a new transaction per call, so creating a Person, creating an Employment
 * and completing the application cannot be one atomic act. This column is what makes a
 * half-finished hire **detectable and resumable** rather than a silently wrong answer: an
 * application in `hired` whose hire state is anything but `completed` is a reconciliation query,
 * not a mystery (ADR-0046).
 */
export const HIRE_STATES = [
  'pending',
  'person_linked',
  'employment_created',
  'completed',
  'failed',
] as const;
export type HireState = (typeof HIRE_STATES)[number];

export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

/**
 * What an interviewer concluded, on an ordered scale.
 *
 * Ordered so a screen may sort by it without this module publishing a numeric mapping it would then
 * have to keep stable. `no_decision` is not the middle of the scale — it is the interviewer saying
 * they cannot judge, which is different from judging neutrally and must not average as though it
 * were.
 */
export const RECOMMENDATIONS = ['strong_no', 'no', 'no_decision', 'yes', 'strong_yes'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const OFFER_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'issued',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_TRANSITIONS: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  draft: ['pending_approval', 'withdrawn'],
  pending_approval: ['approved', 'rejected', 'draft', 'withdrawn'],
  approved: ['issued', 'withdrawn'],
  rejected: ['draft', 'withdrawn'],
  // Only an issued offer can be accepted or declined: a candidate cannot respond to terms nobody
  // sent them.
  issued: ['accepted', 'declined', 'expired', 'withdrawn'],
  accepted: [],
  declined: [],
  expired: [],
  withdrawn: [],
};

/** An offer that is live: the candidate has it, or has taken it. At most one per application. */
export const isOfferLive = (status: OfferStatus): boolean =>
  status === 'issued' || status === 'accepted';

/** What a candidate claims about themselves. Self-declared, and never verified by this module. */
export const PROFILE_ENTRY_KINDS = [
  'skill',
  'language',
  'experience',
  'education',
  'certification',
] as const;
export type ProfileEntryKind = (typeof PROFILE_ENTRY_KINDS)[number];

/**
 * A stable, human-authored code, unique within its tenant and its kind.
 *
 * ASCII by design, for the same reason every other module's codes are: a code travels into an export
 * a customer opens in a spreadsheet and into an integration's payload.
 */
export const isEntityCode = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);

/** A civil date as `YYYY-MM-DD`. An applied date is the same date in every time zone. */
export const isCivilDate = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

/**
 * The shape of an email address, checked loosely on purpose.
 *
 * The same rule People applies: a strict RFC 5322 expression rejects addresses that work, and the
 * only authoritative test of an address is sending to it.
 */
export const isEmailAddress = (value: string): boolean =>
  /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value) && value.length <= 320;

/** Stored lower-cased and trimmed, because this is what candidate matching compares. */
export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** E.164-ish: a leading `+`, then digits. Separators stripped so one number is one number. */
export const isTelephoneNumber = (value: string): boolean => /^\+[1-9]\d{6,17}$/.test(value);

export const normalizeTelephone = (value: string): string => value.replace(/[\s()-]/g, '');

/** A reference into the document store. Recruitment stores no bytes and owns no documents. */
export const isDocumentReference = (value: string): boolean =>
  /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,127}$/.test(value);
