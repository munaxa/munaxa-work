import { success, type Command, type CommandHandler } from '@work/kernel';

import { DuplicateCandidate } from '../domain/duplicate-candidate.js';
import type { DuplicateStatus } from '../domain/people-vocabulary.js';

import { detectDuplicates } from './duplicate-detection.js';
import { notFound, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadPerson } from './person-guard.js';
import { queueCandidates } from './person.use-case.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * Reviewing suspected duplicates, and re-running detection on demand.
 *
 * The specification requires detection before create, before import, before synchronization and as
 * background validation. The first three run inside the commands that do those things; this is the
 * fourth, exposed as a command rather than a scheduled job because this product has no scheduler
 * until Phase 24 — and a sweep that pretended to run on a timer would be a claim nothing keeps.
 * What exists is the operation itself, idempotent and safe to run repeatedly, which is what a job
 * will call when there is one.
 */

export interface ReviewDuplicateCommand extends Command {
  readonly commandName: 'people.review-duplicate';
  readonly candidateId: string;
  readonly decision: Exclude<DuplicateStatus, 'pending'>;
  readonly note?: string;
  readonly expectedVersion: number;
}

/**
 * Records a human's decision about a pair.
 *
 * `confirmed` records that they are the same person. It does **not** merge them — merging is a
 * separate command with its own permission, because a merge is effectively irreversible for every
 * module that has since referenced the record that loses, and a reviewer clearing a queue should
 * not be able to trigger one by accident.
 */
export const reviewDuplicateHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<ReviewDuplicateCommand, { readonly candidateId: string }> => ({
  commandName: 'people.review-duplicate',
  permission: PeoplePermissions.duplicateReview,

  validate: (command) =>
    command.decision === 'confirmed' || command.decision === 'dismissed'
      ? []
      : [{ field: 'decision', message: 'must be confirmed or dismissed' }],

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const state = await dependencies.stores.duplicates.byId(transaction, command.candidateId);

      if (state === undefined) return notFound('duplicate candidate');

      const candidate = DuplicateCandidate.rehydrate(state);
      const reviewed = candidate.review(
        command.decision,
        command.note,
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!reviewed.ok) return refusedBy(reviewed.error);

      await dependencies.stores.duplicates.update(
        transaction,
        candidate.snapshot(),
        command.expectedVersion,
      );
      transaction.collect(candidate.pullEvents());
      return success({ candidateId: candidate.id });
    }),
});

export interface RescanPersonCommand extends Command {
  readonly commandName: 'people.rescan-person';
  readonly personId: string;
}

/**
 * Re-runs detection for one person against the current register.
 *
 * Idempotent: a pair already queued is not queued again, and a pair already reviewed stays
 * reviewed. That is what makes it safe for the background job Phase 24 will own, and safe for an
 * administrator to press twice.
 */
export const rescanPersonHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<RescanPersonCommand, { readonly duplicatesQueued: number }> => ({
  commandName: 'people.rescan-person',
  permission: PeoplePermissions.duplicateReview,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadPerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const names = await dependencies.stores.names.forPerson(transaction, command.personId);
      const identifiers = await dependencies.stores.identifiers.forPerson(
        transaction,
        command.personId,
      );
      const contacts = await dependencies.stores.contacts.forPerson(transaction, command.personId);

      const detection = await detectDuplicates(transaction, dependencies.stores, {
        personId: command.personId,
        identifierKeys: identifiers
          .filter((row) => row.withdrawnAt === undefined)
          .map((row) => row.matchKey),
        contactValues: contacts.map((row) => row.value),
        names: names.flatMap((row) => [row.legalName.en, row.legalName.ar]),
        ...(loaded.value.dateOfBirth === undefined
          ? {}
          : { dateOfBirth: loaded.value.dateOfBirth }),
      });

      const queued = await queueCandidates(
        transaction,
        dependencies,
        command.personId,
        detection.matches,
        dependencies.clock.now(),
      );

      return success({ duplicatesQueued: queued });
    }),
});
