import { success, type Command, type CommandHandler } from '@work/kernel';

import { PersonNote, PersonTag } from '../domain/person-annotation.js';

import { currentTenant, originOfCurrentRequest, refusedBy } from './people-context.js';
import { PeoplePermissions } from './people-permissions.js';
import { loadWritablePerson } from './person-guard.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * The two things an administrator writes *about* a person rather than records *of* them: a tag and
 * a note.
 *
 * Apart from the rest of the profile because they carry the module's sharpest privacy rules. A tag
 * is a label a tenant applies to group its workforce its own way. A note is free text somebody
 * wrote about a colleague, and it is the highest-risk field in this module: guarded by its own
 * permission, authored from the authenticated context rather than the request, and neither
 * amendable nor deletable — a note that could be edited after the fact cannot be relied on in a
 * disciplinary case, and a note that could be deleted is a record somebody can make disappear.
 */

export interface ApplyTagCommand extends Command {
  readonly commandName: 'people.apply-tag';
  readonly personId: string;
  readonly tagCode: string;
}

export const applyTagHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<ApplyTagCommand, { readonly tagId: string }> => ({
  commandName: 'people.apply-tag',
  permission: PeoplePermissions.tagManage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const tag = PersonTag.record(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          tagCode: command.tagCode,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!tag.ok) return refusedBy(tag.error);

      await dependencies.stores.tags.insert(transaction, tag.value.snapshot());
      transaction.collect(tag.value.pullEvents());
      return success({ tagId: tag.value.id });
    }),
});

export interface WriteNoteCommand extends Command {
  readonly commandName: 'people.write-note';
  readonly personId: string;
  readonly categoryCode: string;
  readonly body: string;
}

/**
 * Writes a note about somebody.
 *
 * The author is taken from the authenticated context and never from the command, for the same
 * reason the approver on an establishment is in Organization: a caller who could name their own
 * author could write a note as somebody else. There is deliberately no command to amend or delete
 * one — a note that could be edited after the fact cannot be relied on in a disciplinary case.
 */
export const writeNoteHandler = (
  dependencies: PeopleDependencies,
): CommandHandler<WriteNoteCommand, { readonly noteId: string }> => ({
  commandName: 'people.write-note',
  permission: PeoplePermissions.noteWrite,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const loaded = await loadWritablePerson(transaction, dependencies.stores, command.personId);

      if (!loaded.ok) return loaded;

      const note = PersonNote.write(
        {
          tenantId: currentTenant(),
          personId: command.personId,
          categoryCode: command.categoryCode,
          body: command.body,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      );

      if (!note.ok) return refusedBy(note.error);

      await dependencies.stores.notes.insert(transaction, note.value.snapshot());
      transaction.collect(note.value.pullEvents());
      return success({ noteId: note.value.id });
    }),
});
