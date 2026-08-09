import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import { amendPlanHandler, createPlanHandler, retirePlanHandler } from './plan.use-case.js';
import { draftPlanVersionHandler, publishPlanVersionHandler } from './plan-version.use-case.js';
import {
  defineTaskTemplateHandler,
  removeTaskTemplateHandler,
} from './task-template.use-case.js';
import { startOnboardingHandler } from './start.use-case.js';
import {
  beginOnboardingHandler,
  beginPreboardingHandler,
  cancelOnboardingHandler,
  completeOnboardingHandler,
} from './lifecycle.use-case.js';
import { completeOwnTaskHandler } from './task-self-service.use-case.js';
import {
  completeTaskHandler,
  reassignTaskHandler,
  rescheduleTaskHandler,
  waiveTaskHandler,
} from './task.use-case.js';
import { awaitingOnboardingHandler, reconcileOnboardingHandler } from './reconcile.use-case.js';
import { exportOnboardingHandler } from './transfer.use-case.js';
import {
  readOnboardingHandler,
  readPlanHandler,
  searchOnboardingsHandler,
  searchPlansHandler,
} from './onboarding-queries.js';
import {
  readMyTasksHandler,
  readTaskHistoryHandler,
  searchTasksHandler,
} from './task-queries.js';
import { ALL_ONBOARDING_PERMISSIONS, OnboardingPermissions } from './onboarding-permissions.js';
import type { CommandSender } from './transfer.use-case.js';
import type { OnboardingDependencies } from './onboarding-dependencies.js';

/**
 * The module's declaration: what Onboarding offers, in one place, so the registry can derive
 * everything else — permissions, navigation, health.
 *
 * The `sender` parameter is what reconciliation needs, and it is a parameter rather than something
 * taken from a container because the dispatcher it will use is built *from this list*. Passing a
 * deferred sender keeps the module a plain declaration instead of a graph with a cycle in it.
 */
export const onboardingModule = (
  dependencies: OnboardingDependencies,
  sender: CommandSender,
): WorkModule => ({
  name: 'onboarding',

  commands: commandsOf(dependencies, sender),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'onboarding.joiners',
      path: '/onboarding',
      permission: OnboardingPermissions.read,
      order: 35,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_ONBOARDING_PERMISSIONS,
});

const commandsOf = (
  dependencies: OnboardingDependencies,
  sender: CommandSender,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createPlanHandler(dependencies),
    amendPlanHandler(dependencies),
    retirePlanHandler(dependencies),

    draftPlanVersionHandler(dependencies),
    defineTaskTemplateHandler(dependencies),
    removeTaskTemplateHandler(dependencies),
    publishPlanVersionHandler(dependencies),

    startOnboardingHandler(dependencies),
    beginPreboardingHandler(dependencies),
    beginOnboardingHandler(dependencies),
    completeOnboardingHandler(dependencies),
    cancelOnboardingHandler(dependencies),

    completeTaskHandler(dependencies),
    completeOwnTaskHandler(dependencies),
    waiveTaskHandler(dependencies),
    reassignTaskHandler(dependencies),
    rescheduleTaskHandler(dependencies),

    reconcileOnboardingHandler(dependencies, sender),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (
  dependencies: OnboardingDependencies,
): readonly QueryHandler<Query, unknown>[] =>
  [
    searchPlansHandler(dependencies),
    readPlanHandler(dependencies),
    searchOnboardingsHandler(dependencies),
    readOnboardingHandler(dependencies),
    searchTasksHandler(dependencies),
    readTaskHistoryHandler(dependencies),
    readMyTasksHandler(dependencies),
    awaitingOnboardingHandler(dependencies),
    exportOnboardingHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
