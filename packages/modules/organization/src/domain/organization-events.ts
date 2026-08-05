import { createDomainEvent, type DomainEvent, type EventOrigin } from '@work/kernel';

/**
 * Every fact Organization publishes.
 *
 * Names are `organization.<aggregate>.<past participle>`, because an event is something that has
 * already happened — the convention Workforce Identity established and every module keeps.
 *
 * Two of these are the ones later phases actually wait for. `organization.unit.placed` is how a
 * reporting projection learns the structure changed, and `organization.legal-entity.registered`
 * is how the statutory layer learns a new country is in play (Phase 11.1). The rest exist
 * because a structure change nobody can subscribe to is a structure change nobody can react to.
 *
 * Every event is version 1. A payload change that removes or repurposes a field is version 2,
 * published alongside version 1 until consumers have moved.
 */

export const ORGANIZATION_EVENT_VERSION = 1;

export const OrganizationEvents = {
  unitTypeDefined: 'organization.unit-type.defined',
  unitTypeRetired: 'organization.unit-type.retired',

  unitCreated: 'organization.unit.created',
  unitRenamed: 'organization.unit.renamed',
  unitStatusChanged: 'organization.unit.status-changed',
  unitMetadataChanged: 'organization.unit.metadata-changed',
  /** The structural fact: this unit sits under that parent, from this date. */
  unitPlaced: 'organization.unit.placed',
  unitDetached: 'organization.unit.detached',

  legalEntityRegistered: 'organization.legal-entity.registered',
  legalEntityAmended: 'organization.legal-entity.amended',

  costCenterOpened: 'organization.cost-center.opened',
  costCenterClosed: 'organization.cost-center.closed',
  profitCenterOpened: 'organization.profit-center.opened',
  profitCenterClosed: 'organization.profit-center.closed',

  positionDefined: 'organization.position.defined',
  positionRevised: 'organization.position.revised',
  positionRetired: 'organization.position.retired',

  establishmentSet: 'organization.establishment.set',
  establishmentApproved: 'organization.establishment.approved',
  establishmentWithdrawn: 'organization.establishment.withdrawn',

  calendarDefined: 'organization.calendar.defined',
  calendarAmended: 'organization.calendar.amended',
  calendarDayRecorded: 'organization.calendar.day-recorded',
  calendarDayRemoved: 'organization.calendar.day-removed',

  tenantSettingsConfigured: 'organization.tenant-settings.configured',
} as const;

export type OrganizationEventName = (typeof OrganizationEvents)[keyof typeof OrganizationEvents];

export const organizationEvent = <TPayload>(
  eventName: OrganizationEventName,
  subject: { readonly aggregateType: string; readonly aggregateId: string },
  payload: TPayload,
  origin: EventOrigin,
  occurredAt: Date,
): DomainEvent<TPayload> =>
  createDomainEvent(
    { eventName, eventVersion: ORGANIZATION_EVENT_VERSION, payload, occurredAt },
    subject,
    origin,
  );
