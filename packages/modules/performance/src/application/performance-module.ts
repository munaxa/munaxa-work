import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  defineGoalCategoryHandler,
  defineRatingScaleHandler,
  retireRatingScaleHandler,
  setGoalCategoryActiveHandler,
} from './configuration.use-case.js';
import {
  defineCompetencyHandler,
  defineFrameworkHandler,
  retireFrameworkHandler,
} from './competency.use-case.js';
import { defineTemplateHandler, retireTemplateHandler } from './template.use-case.js';
import {
  approveGoalHandler,
  createGoalHandler,
  moveGoalHandler,
  updateGoalHandler,
} from './goal.use-case.js';
import { closeGoalHandler, recordGoalProgressHandler } from './goal-progress.use-case.js';
import {
  cancelCycleHandler,
  closeCycleHandler,
  createCycleHandler,
  moveCycleHandler,
} from './cycle.use-case.js';
import { enrolParticipantsHandler } from './enrolment.use-case.js';
import {
  archiveReviewHandler,
  assignReviewerHandler,
  completeReviewHandler,
  moveReviewHandler,
  respondToAssignmentHandler,
} from './review.use-case.js';
import {
  recordAssessmentItemHandler,
  startAssessmentHandler,
  submitAssessmentHandler,
} from './assessment.use-case.js';
import { scoreReviewHandler } from './score-review.use-case.js';
import {
  concludeCalibrationHandler,
  moveCalibrationHandler,
  recordCalibrationDecisionHandler,
  recordPlacementHandler,
  scheduleCalibrationHandler,
} from './calibration.use-case.js';
import { giveFeedbackHandler, withdrawFeedbackHandler } from './feedback.use-case.js';
import {
  listCyclesHandler,
  listFrameworksHandler,
  listGoalCategoriesHandler,
  listRatingScalesHandler,
  listTemplatesHandler,
  readGoalHandler,
  searchGoalsHandler,
} from './performance-queries.js';
import {
  listCalibrationSessionsHandler,
  readReconciliationHandler,
  readReviewHandler,
  readTalentMatrixHandler,
  searchFeedbackHandler,
  searchReviewsHandler,
} from './review-queries.js';
import { ALL_PERFORMANCE_PERMISSIONS, PerformancePermissions } from './performance-permissions.js';
import type { PerformanceDependencies } from './performance-dependencies.js';

/**
 * Performance's module declaration: thirty commands, thirteen queries, three navigation entries.
 *
 * Registered on the same dispatcher as every other module. **Nothing here subscribes to an event.**
 * The dispatch is at-most-once with no outbox, so a module whose correctness depended on delivery
 * would be wrong the first time a process restarted mid-dispatch. Every cross-module fact this
 * module needs is pulled at the moment it is needed (ADR-0064), and reconciliation is a query
 * somebody runs for the same reason.
 *
 * **Nothing here is scheduled.** A cycle does not open itself, a reminder is not sent and an
 * overdue review is not detected by a sweep — `JobPort` has no adapter, so overdue is a question a
 * query answers when asked (D-22).
 *
 * **`performance.score-review` is a command, not a query**, though it returns a number. It writes
 * the review's calculated score and the working behind it, and a read that writes is a command;
 * routing it as a query would put a write on the read path and make the working look optional.
 */
export const performanceModule = (dependencies: PerformanceDependencies): WorkModule => ({
  name: 'performance',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'performance.cycles',
      path: '/performance/cycles',
      permission: PerformancePermissions.cycleRead,
      order: 70,
    },
    {
      key: 'performance.reviews',
      path: '/performance/reviews',
      permission: PerformancePermissions.reviewReadTeam,
      order: 71,
    },
    {
      key: 'performance.goals',
      path: '/performance/goals',
      permission: PerformancePermissions.goalRead,
      order: 72,
    },
  ],

  // Stated in full so the administration screen offers the whole set rather than the subset that
  // happens to be some handler's own declaration — including the two that are declared and route
  // nowhere, which the checkpoint report lists as `NOT VERIFIED` rather than as features.
  permissions: ALL_PERFORMANCE_PERMISSIONS,
});

const commandsOf = (
  dependencies: PerformanceDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineRatingScaleHandler(dependencies),
    retireRatingScaleHandler(dependencies),
    defineGoalCategoryHandler(dependencies),
    setGoalCategoryActiveHandler(dependencies),

    defineFrameworkHandler(dependencies),
    defineCompetencyHandler(dependencies),
    retireFrameworkHandler(dependencies),

    defineTemplateHandler(dependencies),
    retireTemplateHandler(dependencies),

    createGoalHandler(dependencies),
    updateGoalHandler(dependencies),
    approveGoalHandler(dependencies),
    moveGoalHandler(dependencies),
    recordGoalProgressHandler(dependencies),
    closeGoalHandler(dependencies),

    createCycleHandler(dependencies),
    moveCycleHandler(dependencies),
    closeCycleHandler(dependencies),
    cancelCycleHandler(dependencies),
    enrolParticipantsHandler(dependencies),

    assignReviewerHandler(dependencies),
    respondToAssignmentHandler(dependencies),
    moveReviewHandler(dependencies),
    completeReviewHandler(dependencies),
    archiveReviewHandler(dependencies),

    startAssessmentHandler(dependencies),
    recordAssessmentItemHandler(dependencies),
    submitAssessmentHandler(dependencies),
    scoreReviewHandler(dependencies),

    scheduleCalibrationHandler(dependencies),
    moveCalibrationHandler(dependencies),
    recordCalibrationDecisionHandler(dependencies),
    concludeCalibrationHandler(dependencies),
    recordPlacementHandler(dependencies),

    giveFeedbackHandler(dependencies),
    withdrawFeedbackHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (
  dependencies: PerformanceDependencies,
): readonly QueryHandler<Query, unknown>[] =>
  [
    listRatingScalesHandler(dependencies),
    listFrameworksHandler(dependencies),
    listTemplatesHandler(dependencies),
    listGoalCategoriesHandler(dependencies),

    listCyclesHandler(dependencies),
    searchGoalsHandler(dependencies),
    readGoalHandler(dependencies),
    searchReviewsHandler(dependencies),
    readReviewHandler(dependencies),

    listCalibrationSessionsHandler(dependencies),
    readTalentMatrixHandler(dependencies),
    searchFeedbackHandler(dependencies),

    readReconciliationHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
