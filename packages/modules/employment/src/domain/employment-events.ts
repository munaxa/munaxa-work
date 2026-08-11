import {
  createDomainEvent,
  type DomainEvent,
  type EventOrigin,
  type EventSubject,
} from '@work/kernel';

/**
 * The events Employment publishes.
 *
 * Employment is the backbone every later operational module consumes — attendance, leave, payroll,
 * benefits, performance, offboarding — and none of them may read this module's tables. These are
 * how a hire, a transfer, a suspension and a termination reach them.
 *
 * **No event carries personal data, and none carries an employee number.** An `EmploymentCreated`
 * names the employment and the person by identifier and nothing else; an `EmploymentEnded` names
 * the reason *code*, never a sentence somebody typed about why. Events are immutable, they fan out
 * to consumers this module does not know, and they end up in logs — which makes an event payload
 * the easiest place in a product to leak something permanently. A consumer entitled to more asks
 * the application service, where the permission is checked.
 */
export const EmploymentEvents = {
  employmentCreated: 'employment.employment.created',
  /**
   * Every transition raises this, carrying where it came from and where it went.
   *
   * Two transitions raise a *second*, named event as well — activation and ending — and that is
   * deliberate rather than redundant. They are the two a later module keys off: payroll starts at
   * one and final settlement at the other. Making every consumer filter a generic event by
   * `to === 'active'` is the kind of condition that gets written wrong exactly once, in the module
   * whose author was thinking about something else.
   */
  employmentStatusChanged: 'employment.employment.status-changed',
  employmentActivated: 'employment.employment.activated',
  employmentEnded: 'employment.employment.ended',
  employmentAmended: 'employment.employment.amended',
  employmentMetadataChanged: 'employment.employment.metadata-changed',

  assignmentCreated: 'employment.assignment.created',
  assignmentChanged: 'employment.assignment.changed',
  assignmentClosed: 'employment.assignment.closed',

  managerChanged: 'employment.reporting-line.changed',
  reportingLineClosed: 'employment.reporting-line.closed',

  contractRecorded: 'employment.contract.recorded',
  contractClosed: 'employment.contract.closed',
  probationConcluded: 'employment.contract.probation-concluded',
} as const;

export type EmploymentEventName = (typeof EmploymentEvents)[keyof typeof EmploymentEvents];

/**
 * Version 1 of every event this phase introduces. A payload change that removes or repurposes a
 * field is version 2, published alongside version 1 until consumers have moved.
 */
export const EMPLOYMENT_EVENT_VERSION = 1;

export const employmentEvent = <TPayload>(
  eventName: EmploymentEventName,
  subject: EventSubject,
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: EMPLOYMENT_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
