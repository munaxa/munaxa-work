import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { closeContactHandler, recordContactHandler } from './contact.use-case.js';
import { rescanPersonHandler, reviewDuplicateHandler } from './duplicate.use-case.js';
import {
  amendIdentifierHandler,
  recordIdentifierHandler,
  withdrawIdentifierHandler,
} from './identifier.use-case.js';
import { listDuplicatesHandler, readPersonHandler, searchPeopleHandler } from './people-queries.js';
import { ALL_PEOPLE_PERMISSIONS, PeoplePermissions } from './people-permissions.js';
import { applyTagHandler, writeNoteHandler } from './annotation.use-case.js';
import {
  recordCapabilityHandler,
  recordHistoryHandler,
  recordNationalityHandler,
  withdrawCapabilityHandler,
} from './profile.use-case.js';
import { readPersonProfileHandler } from './profile.query.js';
import {
  closeAddressHandler,
  recordAddressHandler,
  recordEmergencyContactHandler,
  recordPreferenceHandler,
} from './residence.use-case.js';
import {
  amendPersonHandler,
  changePersonStatusHandler,
  createPersonHandler,
} from './person.use-case.js';
import {
  mergePeopleHandler,
  recordPersonNameHandler,
  revisePersonMetadataHandler,
  setPersonPhotoHandler,
} from './person-record.use-case.js';
import { exportPeopleHandler, importPeopleHandler } from './transfer.use-case.js';
import type { CommandSender } from './transfer.use-case.js';
import type { PeopleDependencies } from './people-dependencies.js';

/**
 * The module's declaration: what it offers, in one place, so the registry can derive everything
 * else — permissions, navigation, health.
 *
 * The `sender` parameter is what import needs, and it is a parameter rather than something taken
 * from a container because the dispatcher it will use is built *from this list*. Passing a
 * deferred sender keeps the module a plain declaration instead of a graph with a cycle in it — the
 * same seam Organization uses, for the same reason.
 */
export const peopleModule = (
  dependencies: PeopleDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'people',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'people.register',
      path: '/people',
      permission: PeoplePermissions.personRead,
      order: 10,
    },
    {
      key: 'people.duplicates',
      path: '/people/duplicates',
      permission: PeoplePermissions.duplicateRead,
      order: 11,
    },
  ],

  // The read permissions no handler declares alone — the section permissions the profile read
  // consults — stated so the administration screen offers the whole set rather than the subset
  // that happens to be reachable as a handler's own permission.
  permissions: ALL_PEOPLE_PERMISSIONS,
});

/**
 * The handlers, hoisted out of the declaration.
 *
 * They are a list, not logic, but a list of twenty is still a function that outgrew its budget —
 * and the budget exists so that a module declaration stays readable at a glance.
 */
const commandsOf = (
  dependencies: PeopleDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createPersonHandler(dependencies),
    amendPersonHandler(dependencies),
    changePersonStatusHandler(dependencies),
    recordPersonNameHandler(dependencies),
    revisePersonMetadataHandler(dependencies),
    setPersonPhotoHandler(dependencies),
    mergePeopleHandler(dependencies),

    recordIdentifierHandler(dependencies),
    amendIdentifierHandler(dependencies),
    withdrawIdentifierHandler(dependencies),

    recordNationalityHandler(dependencies),

    recordContactHandler(dependencies),
    closeContactHandler(dependencies),
    recordAddressHandler(dependencies),
    closeAddressHandler(dependencies),
    recordEmergencyContactHandler(dependencies),
    recordPreferenceHandler(dependencies),

    recordCapabilityHandler(dependencies),
    withdrawCapabilityHandler(dependencies),
    recordHistoryHandler(dependencies),
    applyTagHandler(dependencies),
    writeNoteHandler(dependencies),

    reviewDuplicateHandler(dependencies),
    rescanPersonHandler(dependencies),

    importPeopleHandler(sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: PeopleDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchPeopleHandler(dependencies),
    readPersonHandler(dependencies),
    readPersonProfileHandler(dependencies),
    listDuplicatesHandler(dependencies),
    exportPeopleHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
