import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  addStageHandler,
  archivePathHandler,
  createPathHandler,
  publishPathHandler,
} from './path.use-case.js';
import { amendPlanHandler, createPlanHandler, movePlanHandler } from './plan.use-case.js';
import {
  addToPoolHandler,
  closePoolHandler,
  createPoolHandler,
  removeFromPoolHandler,
} from './pool.use-case.js';
import {
  activateSuccessionPlanHandler,
  archiveSuccessionPlanHandler,
  createSuccessionPlanHandler,
} from './succession.use-case.js';
import {
  confirmSuccessorHandler,
  nominateSuccessorHandler,
  withdrawSuccessorHandler,
} from './successor.use-case.js';
import {
  deactivateReadinessLevelHandler,
  defineReadinessLevelHandler,
  recordReadinessHandler,
} from './readiness.use-case.js';
import {
  acknowledgeDevelopmentPlanHandler,
  addDevelopmentItemHandler,
  createDevelopmentPlanHandler,
  moveDevelopmentItemHandler,
  moveDevelopmentPlanHandler,
} from './development.use-case.js';
import { decideMoveHandler, recommendMoveHandler } from './mobility.use-case.js';
import {
  listPoolsHandler,
  listReadinessLevelsHandler,
  readPathHandler,
  readSuccessionPlanHandler,
  searchPathsHandler,
  searchSuccessionPlansHandler,
} from './career-queries.js';
import {
  readBenchStrengthHandler,
  readDevelopmentPlanHandler,
  readReadinessHistoryHandler,
  searchMembershipsHandler,
  searchPlansHandler,
  searchRecommendationsHandler,
} from './career-record-queries.js';
import { readCareerSummaryHandler } from './career-summary.js';
import { ALL_CAREER_PERMISSIONS, CareerPermissions } from './career-permissions.js';
import type { CareerDependencies } from './career-dependencies.js';

/**
 * Career's module declaration: twenty-three commands, thirteen queries, four navigation entries.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event.**
 * The dispatch is at-most-once with no outbox (ADR-0064), so a module whose correctness depended on
 * delivery would be wrong the first time a process restarted mid-dispatch. Every cross-module fact
 * this module needs is pulled at the moment it is needed.
 *
 * **Nothing here is scheduled.** A succession review does not come due by itself and a mobility
 * recommendation does not expire by itself — `JobPort` has no adapter, so both are questions a query
 * answers when asked, against a day the caller states and the response echoes. Scheduled execution
 * is `NOT VERIFIED`.
 *
 * **Nothing here writes outside Career**, and the shape of this list is part of why: every command
 * below names a Career aggregate, and there is no handler whose name or dependencies could reach an
 * employment, a position, an assignment or a salary (ADR-0072). `career.decide-move` accepting a
 * recommendation is the closest thing to an action in the module, and it writes one row.
 */
export const careerModule = (dependencies: CareerDependencies): WorkModule => ({
  name: 'career',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'career.paths',
      path: '/career/paths',
      permission: CareerPermissions.pathRead,
      order: 90,
    },
    {
      key: 'career.succession',
      path: '/career/succession',
      permission: CareerPermissions.successionRead,
      order: 91,
    },
    {
      key: 'career.pools',
      path: '/career/pools',
      permission: CareerPermissions.poolRead,
      order: 92,
    },
    {
      key: 'career.development',
      path: '/career/development',
      permission: CareerPermissions.developmentRead,
      order: 93,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration — including the three that are declared and route
  // nowhere, which the checkpoint report lists as `NOT VERIFIED` rather than as features.
  permissions: ALL_CAREER_PERMISSIONS,
});

const commandsOf = (
  dependencies: CareerDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    createPathHandler(dependencies),
    addStageHandler(dependencies),
    publishPathHandler(dependencies),
    archivePathHandler(dependencies),

    createPlanHandler(dependencies),
    amendPlanHandler(dependencies),
    movePlanHandler(dependencies),

    createPoolHandler(dependencies),
    closePoolHandler(dependencies),
    addToPoolHandler(dependencies),
    removeFromPoolHandler(dependencies),

    createSuccessionPlanHandler(dependencies),
    activateSuccessionPlanHandler(dependencies),
    archiveSuccessionPlanHandler(dependencies),
    nominateSuccessorHandler(dependencies),
    confirmSuccessorHandler(dependencies),
    withdrawSuccessorHandler(dependencies),

    defineReadinessLevelHandler(dependencies),
    deactivateReadinessLevelHandler(dependencies),
    recordReadinessHandler(dependencies),

    createDevelopmentPlanHandler(dependencies),
    moveDevelopmentPlanHandler(dependencies),
    acknowledgeDevelopmentPlanHandler(dependencies),
    addDevelopmentItemHandler(dependencies),
    moveDevelopmentItemHandler(dependencies),

    recommendMoveHandler(dependencies),
    decideMoveHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: CareerDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    searchPathsHandler(dependencies),
    readPathHandler(dependencies),
    listPoolsHandler(dependencies),
    listReadinessLevelsHandler(dependencies),
    searchSuccessionPlansHandler(dependencies),
    readSuccessionPlanHandler(dependencies),

    searchPlansHandler(dependencies),
    searchMembershipsHandler(dependencies),
    readReadinessHistoryHandler(dependencies),
    readDevelopmentPlanHandler(dependencies),
    searchRecommendationsHandler(dependencies),
    readBenchStrengthHandler(dependencies),
    readCareerSummaryHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
