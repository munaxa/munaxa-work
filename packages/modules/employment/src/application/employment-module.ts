import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { changeAssignmentHandler, createAssignmentHandler } from './assignment.use-case.js';
import { changeManagerHandler } from './reporting-line.use-case.js';
import { concludeProbationHandler, recordContractHandler } from './contract.use-case.js';
import { changeEmploymentStatusHandler, endEmploymentHandler } from './lifecycle.use-case.js';
import {
  readEmploymentHandler,
  readEmploymentHistoryHandler,
  searchEmploymentsHandler,
} from './employment-queries.js';
import { ALL_EMPLOYMENT_PERMISSIONS, EmploymentPermissions } from './employment-permissions.js';
import {
  amendEmploymentHandler,
  createEmploymentHandler,
  reviseEmploymentMetadataHandler,
} from './employment.use-case.js';
import { exportWorkforceHandler, importEmploymentsHandler } from './transfer.use-case.js';
import type { CommandSender } from './transfer.use-case.js';
import type { EmploymentDependencies } from './employment-dependencies.js';

/**
 * The module's declaration: what it offers, in one place, so the registry can derive everything
 * else — permissions, navigation, health.
 *
 * The `sender` parameter is what import needs, and it is a parameter rather than something taken
 * from a container because the dispatcher it will use is built *from this list*. Passing a
 * deferred sender keeps the module a plain declaration instead of a graph with a cycle in it — the
 * seam Organization and People both use, for the same reason.
 */
export const employmentModule = (
  dependencies: EmploymentDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'employment',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'employment.workforce',
      path: '/employment',
      permission: EmploymentPermissions.employmentRead,
      order: 20,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_EMPLOYMENT_PERMISSIONS,
});

const commandsOf = (
  dependencies: EmploymentDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createEmploymentHandler(dependencies),
    amendEmploymentHandler(dependencies),
    reviseEmploymentMetadataHandler(dependencies),

    changeEmploymentStatusHandler(dependencies),
    endEmploymentHandler(dependencies),

    createAssignmentHandler(dependencies),
    changeAssignmentHandler(dependencies),

    changeManagerHandler(dependencies),

    recordContractHandler(dependencies),
    concludeProbationHandler(dependencies),

    importEmploymentsHandler(sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: EmploymentDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchEmploymentsHandler(dependencies),
    readEmploymentHandler(dependencies),
    readEmploymentHistoryHandler(dependencies),
    exportWorkforceHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
