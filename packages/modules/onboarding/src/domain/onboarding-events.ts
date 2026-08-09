import {
  createDomainEvent,
  type DomainEvent,
  type EventOrigin,
  type EventSubject,
} from '@work/kernel';

/**
 * The events Onboarding publishes.
 *
 * Published where a consumer is identifiable — Communications (Phase 17), Workflow (Phase 16),
 * Employee and Manager Self-Service (18 and 19) and reporting (20). Events invented because a list
 * suggested them are noise every later version has to keep publishing.
 *
 * **No event carries a person's name, a task note, an acknowledgement's text or a document
 * reference.** Events fan out to consumers this module does not know and end up in their logs, and
 * an onboarding task is about a named human being on their first week.
 *
 * `onboarding.task.overdue` is deliberately **absent**. Overdue is derived from a date: nothing in
 * this product runs at the moment a due date passes, so an event would need a sweeper, and a
 * sweeper is Phase 24's. Reminders come from Communications reading the overdue *query*.
 *
 * The events are also, deliberately, **not published in this module's contracts**. No module in this
 * repository publishes its event names, there is no cross-module subscription contract, and Phase 7
 * was directed not to invent one for itself. A general published-event architecture belongs with
 * Workflow and Communications.
 */
export const OnboardingEvents = {
  /** An onboarding exists for an employment. Carries identifiers and dates, and nothing else. */
  instanceCreated: 'onboarding.instance.created',
  instanceStateChanged: 'onboarding.instance.state-changed',
  instanceCompleted: 'onboarding.instance.completed',
  instanceCancelled: 'onboarding.instance.cancelled',

  taskAssigned: 'onboarding.task.assigned',
  taskCompleted: 'onboarding.task.completed',

  planPublished: 'onboarding.plan.published',
} as const;

export type OnboardingEventName = (typeof OnboardingEvents)[keyof typeof OnboardingEvents];

/**
 * Version 1 of every event this phase introduces. A payload change that removes or repurposes a
 * field is version 2, published alongside version 1 until consumers have moved.
 */
export const ONBOARDING_EVENT_VERSION = 1;

export const onboardingEvent = <TPayload>(
  eventName: OnboardingEventName,
  subject: EventSubject,
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: ONBOARDING_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
