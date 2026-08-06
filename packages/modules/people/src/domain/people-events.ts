import {
  createDomainEvent,
  type DomainEvent,
  type EventOrigin,
  type EventSubject,
} from '@work/kernel';

/**
 * The events People publishes.
 *
 * Every future workforce module references Person and none of them may read this module's
 * tables, so these are how a change to somebody's identity reaches Employment, Payroll or the
 * Integration Hub.
 *
 * **No event in this module carries personal data.** A `PersonCreated` names the person's
 * identifier and nothing else; a `PersonIdentifierRecorded` names the *kind* of identifier, never
 * its value; a rename carries the fact of the rename rather than the two names. Events are
 * immutable, they fan out to consumers this module does not know, and they end up in logs — which
 * makes an event payload the single easiest place to leak a national identifier permanently.
 * Consumers that are entitled to the data ask the application service, where the permission is
 * checked and the disclosure is recorded.
 */
export const PeopleEvents = {
  personCreated: 'people.person.created',
  personRenamed: 'people.person.renamed',
  personNameClosed: 'people.person.name-closed',
  personDetailsAmended: 'people.person.details-amended',
  personStatusChanged: 'people.person.status-changed',
  personMetadataChanged: 'people.person.metadata-changed',
  personPhotoChanged: 'people.person.photo-changed',
  personMerged: 'people.person.merged',

  nationalityRecorded: 'people.nationality.recorded',
  nationalityWithdrawn: 'people.nationality.withdrawn',

  identifierRecorded: 'people.identifier.recorded',
  identifierAmended: 'people.identifier.amended',
  identifierWithdrawn: 'people.identifier.withdrawn',

  contactChanged: 'people.contact.changed',
  contactClosed: 'people.contact.closed',
  addressChanged: 'people.address.changed',
  addressClosed: 'people.address.closed',
  emergencyContactChanged: 'people.emergency-contact.changed',
  emergencyContactClosed: 'people.emergency-contact.closed',
  preferenceChanged: 'people.preference.changed',

  capabilityRecorded: 'people.capability.recorded',
  capabilityWithdrawn: 'people.capability.withdrawn',
  historyRecorded: 'people.history.recorded',
  historyWithdrawn: 'people.history.withdrawn',

  tagApplied: 'people.tag.applied',
  tagRemoved: 'people.tag.removed',
  noteRecorded: 'people.note.recorded',

  duplicateSuspected: 'people.duplicate.suspected',
  duplicateReviewed: 'people.duplicate.reviewed',
} as const;

export type PeopleEventName = (typeof PeopleEvents)[keyof typeof PeopleEvents];

/**
 * Version 1 of every event this phase introduces. A payload change that removes or repurposes a
 * field is version 2, published alongside version 1 until consumers have moved.
 */
export const PEOPLE_EVENT_VERSION = 1;

export const peopleEvent = <TPayload>(
  eventName: PeopleEventName,
  subject: EventSubject,
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: PEOPLE_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
