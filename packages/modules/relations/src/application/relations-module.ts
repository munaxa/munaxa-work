import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendViolationCategoryHandler,
  defineViolationCategoryHandler,
} from './violation-category.use-case.js';
import { recordViolationHandler } from './violation.use-case.js';
import {
  listViolationCategoriesHandler,
  listViolationsHandler,
  readViolationHandler,
} from './relations-queries.js';
import { ALL_RELATIONS_PERMISSIONS, RelationsPermissions } from './relations-permissions.js';
import type { RelationsDependencies } from './relations-dependencies.js';

/**
 * Employee Relations' module declaration: three commands, three queries, one navigation entry.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event and
 * nothing raises one.** The dispatch is at-most-once with no outbox (ADR-0053/0064), so a module
 * whose correctness depended on delivery would be wrong the first time a process restarted
 * mid-dispatch — and the specification's `ViolationRecorded` has no consumer yet, so raising it
 * would be a promise about delivery to nobody.
 *
 * **The navigation entry is behind `relations.violation.read`, not the catalogue permission.** The
 * screen this points at is the case register; somebody who may only maintain the policy has no
 * business finding a link to it.
 */
export const relationsModule = (dependencies: RelationsDependencies): WorkModule => ({
  name: 'relations',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'relations.register',
      path: '/relations',
      permission: RelationsPermissions.violationRead,
      order: 65,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration.
  permissions: ALL_RELATIONS_PERMISSIONS,
});

const commandsOf = (
  dependencies: RelationsDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineViolationCategoryHandler(dependencies),
    amendViolationCategoryHandler(dependencies),

    recordViolationHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: RelationsDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listViolationCategoriesHandler(dependencies),

    readViolationHandler(dependencies),
    listViolationsHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
