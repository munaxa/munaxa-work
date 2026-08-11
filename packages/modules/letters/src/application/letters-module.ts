import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendVersionHandler,
  defineTemplateHandler,
  draftVersionHandler,
  moveVersionHandler,
} from './template.use-case.js';
import {
  cancelLetterHandler,
  decideLetterHandler,
  requestLetterHandler,
} from './letter-request.use-case.js';
import { issueLetterHandler } from './letter-issue.use-case.js';
import {
  listTemplatesHandler,
  readIssuedLetterHandler,
  readLettersReconciliationHandler,
  readRequestHandler,
  readTemplateHandler,
  searchIssuedHandler,
  searchRequestsHandler,
  verifyLetterHandler,
} from './letters-queries.js';
import { ALL_LETTERS_PERMISSIONS, LettersPermissions } from './letters-permissions.js';
import type { LettersDependencies } from './letters-dependencies.js';

/**
 * Letters' module declaration: eight commands, eight queries, one navigation entry.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event**,
 * and nothing runs asynchronously: the dispatch is at-most-once with no outbox, and there is no
 * `JobPort` adapter, so a letter that depended on either would be wrong the first time a process
 * restarted mid-dispatch. Generation completes or fails inside the request that asked for it, and
 * every cross-module fact is pulled at the moment it is needed (ADR-0064).
 */
export const lettersModule = (dependencies: LettersDependencies): WorkModule => ({
  name: 'letters',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'letters.register',
      path: '/letters',
      permission: LettersPermissions.read,
      order: 62,
    },
  ],

  permissions: ALL_LETTERS_PERMISSIONS,
});

const commandsOf = (
  dependencies: LettersDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineTemplateHandler(dependencies),
    draftVersionHandler(dependencies),
    amendVersionHandler(dependencies),
    moveVersionHandler(dependencies),

    requestLetterHandler(dependencies),
    decideLetterHandler(dependencies),
    cancelLetterHandler(dependencies),

    issueLetterHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: LettersDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listTemplatesHandler(dependencies),
    readTemplateHandler(dependencies),

    searchRequestsHandler(dependencies),
    readRequestHandler(dependencies),

    searchIssuedHandler(dependencies),
    readIssuedLetterHandler(dependencies),

    // The third-party check, and what reconciliation found.
    verifyLetterHandler(dependencies),
    readLettersReconciliationHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
