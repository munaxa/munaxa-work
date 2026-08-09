import {
  createDomainEvent,
  type DomainEvent,
  type EventOrigin,
  type EventSubject,
} from '@work/kernel';

/**
 * The events Recruitment publishes.
 *
 * Published where a consumer is identifiable — Onboarding (Phase 7), Communications (Phase 17),
 * Workflow (Phase 16) and reporting. Events invented because a list suggested them are noise that
 * every later version has to keep publishing.
 *
 * **No event carries a candidate's name, email address, telephone number, résumé or proposed
 * salary.** Events fan out to consumers this module does not know and end up in logs, and this is
 * the module holding personal data about people who never consented to being in this system. A
 * consumer entitled to more asks the application service, where the permission is checked.
 *
 * `candidateHired` is the one Phase 7 is built on: it names the application, the candidate, the
 * resolved person and the created employment, and nothing else.
 */
export const RecruitmentEvents = {
  requisitionCreated: 'recruitment.requisition.created',
  requisitionSubmitted: 'recruitment.requisition.submitted',
  /** Carries the decision and the actor. Reversal is a decision too, and says so. */
  requisitionDecided: 'recruitment.requisition.decided',
  requisitionClosed: 'recruitment.requisition.closed',

  vacancyOpened: 'recruitment.vacancy.opened',
  vacancyPublished: 'recruitment.vacancy.published',
  vacancyClosed: 'recruitment.vacancy.closed',

  candidateCreated: 'recruitment.candidate.created',
  /** Hired or archived. Distinct from `created`, because a consumer filtering on one means it. */
  candidateStatusChanged: 'recruitment.candidate.status-changed',
  candidateLinkedToPerson: 'recruitment.candidate.linked-to-person',
  candidateAnonymized: 'recruitment.candidate.anonymized',

  applicationReceived: 'recruitment.application.received',
  applicationStatusChanged: 'recruitment.application.status-changed',
  applicationRejected: 'recruitment.application.rejected',

  interviewScheduled: 'recruitment.interview.scheduled',
  interviewRescheduled: 'recruitment.interview.rescheduled',
  interviewCancelled: 'recruitment.interview.cancelled',
  interviewCompleted: 'recruitment.interview.completed',
  feedbackSubmitted: 'recruitment.interview.feedback-submitted',

  offerDrafted: 'recruitment.offer.drafted',
  offerDecided: 'recruitment.offer.decided',
  offerIssued: 'recruitment.offer.issued',
  offerAccepted: 'recruitment.offer.accepted',
  offerDeclined: 'recruitment.offer.declined',

  /** The handoff. Phase 7 subscribes to this rather than polling for hired applications. */
  candidateHired: 'recruitment.candidate.hired',
  /** A hire that started and did not finish. Published so operations can see it, not only a query. */
  hireIncomplete: 'recruitment.candidate.hire-incomplete',
} as const;

export type RecruitmentEventName = (typeof RecruitmentEvents)[keyof typeof RecruitmentEvents];

/**
 * Version 1 of every event this phase introduces. A payload change that removes or repurposes a
 * field is version 2, published alongside version 1 until consumers have moved.
 */
export const RECRUITMENT_EVENT_VERSION = 1;

export const recruitmentEvent = <TPayload>(
  eventName: RecruitmentEventName,
  subject: EventSubject,
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: RECRUITMENT_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
