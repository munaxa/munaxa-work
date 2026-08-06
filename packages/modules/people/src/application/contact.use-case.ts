import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import {
  PersonContact,
  normalizedFor,
  type PersonContactState,
  type RecordContact,
} from '../domain/person-contact.js';
import type { ContactChannel, ContactPurpose } from '../domain/people-vocabulary.js';

import { closeSuperseded, insertChild, placementOf } from './child-writes.js';
import { detectDuplicates } from './duplicate-detection.js';
import {
  conflicted,
  currentTenant,
  notFound,
  originOfCurrentRequest,
  refusedBy,
} from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson } from './person-guard.js';
import { queueCandidates } from './person.use-case.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Contact points — a versioned child entity.
 *
 * A **slot** is a channel and a purpose together: somebody's personal mobile is one timeline and
 * their work email is another, so changing one does not close the other. Without that, recording a
 * new work email would end the person's mobile number, which is the kind of bug that only shows up
 * when somebody cannot be reached.
 *
 * Recording a contact runs duplicate detection for the same reason recording an identifier does:
 * a shared mailbox or a shared mobile number is the second-strongest signal that two records are
 * one human being, and it is far more often present than a government identifier.
 */

export interface RecordContactCommand extends Command {
  readonly commandName: 'people.record-contact';
  readonly personId: string;
  readonly channel: ContactChannel;
  readonly purpose: ContactPurpose;
  readonly value: string;
  readonly isPrimary?: boolean;
  readonly effectiveFrom: Date;
  readonly acknowledgedDuplicates?: boolean;
}

export interface ContactAffected {
  readonly contactId: string;
  readonly duplicatesQueued: number;
}

export const recordContactHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RecordContactCommand, ContactAffected> => ({
  commandName: 'people.record-contact',
  permission: PeoplePermissions.contactManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const normalized = normalizedFor(command.channel, command.value);

      if (!normalized.ok) return refusedBy(normalized.error);

      const now = dependencies.clock.now();
      const origin = originOfCurrentRequest();
      const detection = await detectDuplicates(transaction, dependencies.stores, {
        personId: command.personId,
        identifierKeys: [],
        contactValues: [normalized.value],
        names: [],
      });

      if (detection.matches.length > 0 && command.acknowledgedDuplicates !== true) {
        return conflicted('contact_may_belong_to_another_person');
      }

      const plan = placementOf(
        await slotOf(transaction, dependencies, command),
        command.effectiveFrom,
      );
      const contact = PersonContact.record(recordFrom(command, plan.effectiveTo), origin, now);

      if (!contact.ok) return refusedBy(contact.error);

      const closed = await closeSuperseded(transaction, {
        store: dependencies.stores.contacts,
        superseded: plan.superseded,
        rehydrate: (state) => PersonContact.rehydrate(state),
        at: command.effectiveFrom,
        origin,
        occurredAt: now,
      });

      if (!closed.ok) return refusedBy(closed.error);

      await insertChild(transaction, dependencies.stores.contacts, contact.value);

      const queued = await queueCandidates(
        transaction,
        dependencies,
        command.personId,
        detection.matches,
        now,
      );

      return success({ contactId: contact.value.id, duplicatesQueued: queued });
    }),
});

/** The command as the aggregate's request, bounded where a later period already exists. */
const recordFrom = (
  command: RecordContactCommand,
  effectiveTo: Date | undefined,
): RecordContact => ({
  tenantId: currentTenant(),
  personId: command.personId,
  channel: command.channel,
  purpose: command.purpose,
  value: command.value,
  ...(command.isPrimary === undefined ? {} : { isPrimary: command.isPrimary }),
  effectiveFrom: command.effectiveFrom,
  ...(effectiveTo === undefined ? {} : { effectiveTo }),
});

/**
 * The slot a new contact supersedes: the same channel *and* the same purpose.
 *
 * Both, not either. Without the purpose, recording a new work email would end somebody's personal
 * mobile number — which is the kind of bug that only shows up when they cannot be reached.
 */
const slotOf = async (
  transaction: Transaction,
  dependencies: PeopleDependencies,
  command: RecordContactCommand,
): Promise<readonly PersonContactState[]> =>
  (await dependencies.stores.contacts.forPerson(transaction, command.personId)).filter(
    (row) => row.channel === command.channel && row.purpose === command.purpose,
  );

export interface CloseContactCommand extends Command {
  readonly commandName: 'people.close-contact';
  readonly contactId: string;
  readonly effectiveTo: Date;
  readonly expectedVersion: number;
}

/**
 * Ends a contact point without replacing it — a number disconnected, a mailbox closed.
 *
 * Distinct from recording a new one, because "we no longer have a number for this person" and
 * "this is their new number" are different facts, and a system that could only express the second
 * would invite a placeholder in place of the first.
 */
export const closeContactHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<CloseContactCommand, { readonly contactId: string }> => ({
  commandName: 'people.close-contact',
  permission: PeoplePermissions.contactManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.contacts.byId(transaction, command.contactId);

      if (state === undefined) return notFound('contact');

      const contact = PersonContact.rehydrate(state);
      const closed = contact.closeAt(
        command.effectiveTo,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!closed.ok) return refusedBy(closed.error);

      await dependencies.stores.contacts.update(
        transaction,
        contact.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(contact.pullEvents());
      return success({ contactId: contact.id });
    }),
});
