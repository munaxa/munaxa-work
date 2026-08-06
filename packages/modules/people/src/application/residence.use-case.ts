import { success, type Command, type CommandHandler } from '@work/kernel';

import { PersonAddress } from '../domain/person-address.js';
import { PersonEmergencyContact } from '../domain/person-emergency-contact.js';
import { PersonPreference } from '../domain/person-preference.js';
import type { AddressKind } from '../domain/people-vocabulary.js';

import { closeSuperseded, insertChild, placementOf } from './child-writes.js';
import { currentTenant, notFound, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson } from './person-guard.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * The remaining versioned children: addresses, emergency contacts and preferences.
 *
 * Together in one file because they are the same five steps over three different slots, and apart
 * from `contact.use-case.ts` because that one additionally runs duplicate detection. The **slot**
 * — which timeline a new record supersedes — is the only thing that differs:
 *
 * - an **address** by its kind, so a new mailing address does not close a residential one,
 * - an **emergency contact** by its priority, so recording a second contact does not end the first,
 * - a **preference** by its key, which is the obvious one.
 *
 * Getting a slot wrong is the characteristic bug of this pattern, and it is silent: the record
 * that was closed by mistake simply stops being returned.
 */

export interface RecordAddressCommand extends Command {
  readonly commandName: 'people.record-address';
  readonly personId: string;
  readonly kind: AddressKind;
  readonly lines: readonly Readonly<Record<string, string>>[];
  readonly city: Readonly<Record<string, string>>;
  readonly region?: Readonly<Record<string, string>>;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly effectiveFrom: Date;
}

export const recordAddressHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordAddressCommand, { readonly addressId: string }> => ({
  commandName: 'people.record-address',
  permission: PeoplePermissions.addressManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const siblings = (
        await dependencies.stores.addresses.forPerson(transaction, command.personId)
      ).filter((row) => row.kind === command.kind);
      const plan = placementOf(siblings, command.effectiveFrom);

      const address = PersonAddress.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          kind: command.kind,
          lines: command.lines,
          city: command.city,
          ...(command.region === undefined ? {} : { region: command.region }),
          ...(command.postalCode === undefined ? {} : { postalCode: command.postalCode }),
          countryCode: command.countryCode,
          effectiveFrom: command.effectiveFrom,
          ...(plan.effectiveTo === undefined ? {} : { effectiveTo: plan.effectiveTo }),
        },
        origin,
        now,
      );

      if (!address.ok) return refusedBy(address.error);

      const closed = await closeSuperseded(transaction, {
        store: dependencies.stores.addresses,
        superseded: plan.superseded,
        rehydrate: (state) => PersonAddress.rehydrate(state),
        at: command.effectiveFrom,
        origin,
        occurredAt: now,
      });

      if (!closed.ok) return refusedBy(closed.error);

      await insertChild(transaction, dependencies.stores.addresses, address.value);
      return success({ addressId: address.value.id });
    }),
});

export interface RecordEmergencyContactCommand extends Command {
  readonly commandName: 'people.record-emergency-contact';
  readonly personId: string;
  readonly name: Readonly<Record<string, string>>;
  readonly relationshipCode: string;
  readonly telephone: string;
  readonly alternateTelephone?: string;
  readonly email?: string;
  readonly priority?: number;
  readonly effectiveFrom: Date;
}

export const recordEmergencyContactHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordEmergencyContactCommand, { readonly emergencyContactId: string }> => ({
  commandName: 'people.record-emergency-contact',
  permission: PeoplePermissions.emergencyContactManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const priority = command.priority ?? 1;
      const siblings = (
        await dependencies.stores.emergencyContacts.forPerson(transaction, command.personId)
      ).filter((row) => row.priority === priority);
      const plan = placementOf(siblings, command.effectiveFrom);

      const contact = PersonEmergencyContact.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          name: command.name,
          relationshipCode: command.relationshipCode,
          telephone: command.telephone,
          ...(command.alternateTelephone === undefined
            ? {}
            : { alternateTelephone: command.alternateTelephone }),
          ...(command.email === undefined ? {} : { email: command.email }),
          priority,
          effectiveFrom: command.effectiveFrom,
          ...(plan.effectiveTo === undefined ? {} : { effectiveTo: plan.effectiveTo }),
        },
        origin,
        now,
      );

      if (!contact.ok) return refusedBy(contact.error);

      const closed = await closeSuperseded(transaction, {
        store: dependencies.stores.emergencyContacts,
        superseded: plan.superseded,
        rehydrate: (state) => PersonEmergencyContact.rehydrate(state),
        at: command.effectiveFrom,
        origin,
        occurredAt: now,
      });

      if (!closed.ok) return refusedBy(closed.error);

      await insertChild(transaction, dependencies.stores.emergencyContacts, contact.value);
      return success({ emergencyContactId: contact.value.id });
    }),
});

export interface RecordPreferenceCommand extends Command {
  readonly commandName: 'people.record-preference';
  readonly personId: string;
  readonly preferenceKey: string;
  readonly value: string;
  readonly effectiveFrom: Date;
}

export const recordPreferenceHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordPreferenceCommand, { readonly preferenceId: string }> => ({
  commandName: 'people.record-preference',
  permission: PeoplePermissions.preferenceManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const siblings = (
        await dependencies.stores.preferences.forPerson(transaction, command.personId)
      ).filter((row) => row.preferenceKey === command.preferenceKey);
      const plan = placementOf(siblings, command.effectiveFrom);

      const preference = PersonPreference.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          preferenceKey: command.preferenceKey,
          value: command.value,
          effectiveFrom: command.effectiveFrom,
          ...(plan.effectiveTo === undefined ? {} : { effectiveTo: plan.effectiveTo }),
        },
        origin,
        now,
      );

      if (!preference.ok) return refusedBy(preference.error);

      const closed = await closeSuperseded(transaction, {
        store: dependencies.stores.preferences,
        superseded: plan.superseded,
        rehydrate: (state) => PersonPreference.rehydrate(state),
        at: command.effectiveFrom,
        origin,
        occurredAt: now,
      });

      if (!closed.ok) return refusedBy(closed.error);

      await insertChild(transaction, dependencies.stores.preferences, preference.value);
      return success({ preferenceId: preference.value.id });
    }),
});

export interface CloseAddressCommand extends Command {
  readonly commandName: 'people.close-address';
  readonly addressId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

export const closeAddressHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<CloseAddressCommand, { readonly addressId: string }> => ({
  commandName: 'people.close-address',
  permission: PeoplePermissions.addressManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.addresses.byId(transaction, command.addressId);

      if (state === undefined) return notFound('address');

      const address = PersonAddress.rehydrate(state);
      const closed = address.closeAt(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.addresses.update(
        transaction,
        address.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(address.pullEvents());
      return success({ addressId: address.id });
    }),
});
