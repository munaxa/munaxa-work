import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  ALL_COMPENSATION_PERMISSIONS,
  CompensationPermissions,
} from './compensation-permissions.js';
import { recordAdjustmentHandler } from './adjustment.use-case.js';
import { defineComponentHandler, publishComponentHandler } from './component.use-case.js';
import { decideCompensationHandler, reverseDecisionHandler } from './decision.use-case.js';
import { importCompensationHandler } from './import.use-case.js';
import { recordOneTimeHandler } from './one-time.use-case.js';
import {
  assignCompensationPlanHandler,
  defineCompensationPlanHandler,
  permitComponentHandler,
  publishCompensationPlanHandler,
} from './plan.use-case.js';
import {
  amendRecurringHandler,
  assignRecurringHandler,
  endRecurringHandler,
} from './recurring.use-case.js';
import {
  definePayGradeHandler,
  definePayScaleHandler,
  defineSalaryStepHandler,
  defineSalaryStructureHandler,
} from './structure.use-case.js';
import {
  listComponentsHandler,
  listGradesHandler,
  listImportsHandler,
  listPlansHandler,
  listScalesHandler,
  listStepsHandler,
  listStructuresHandler,
} from './definition-queries.js';
import {
  readApprovalChainHandler,
  readCompensationHistoryHandler,
  readEmploymentCompensationHandler,
  readFutureChangesHandler,
  searchAdjustmentsHandler,
  searchOneTimeHandler,
  searchRecurringHandler,
} from './compensation-queries.js';
import { readPayrollPeriodHandler } from './payroll-query.js';
import {
  readChangedSinceHandler,
  readCompensationDashboardHandler,
} from './reconciliation-query.js';
import type { CompensationDependencies } from './compensation-dependencies.js';

/**
 * The module's declaration: what Compensation offers, in one place, so the registry can derive
 * everything else — permissions, navigation, health.
 *
 * There is no `sender` parameter, and its absence is worth noting. Nothing in this module sends a
 * Compensation command, and the two cross-module reads are **ports**, resolved by the composition
 * root against Employment's and Organization's published services under bounded service grants.
 *
 * The two reads at the bottom of the query list are the whole of what a future Payroll will
 * consume: the set-based period contract and the reconciliation pull. Neither pushes anything, and
 * Payroll's correctness does not depend on an event having been delivered (ADR-0058).
 */
export const compensationModule = (dependencies: CompensationDependencies): WorkModule => ({
  name: 'compensation',

  commands: commandsOf(dependencies),

  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'compensation.register',
      path: '/compensation',
      permission: CompensationPermissions.read,
      order: 50,
    },
  ],

  // The read permissions no handler declares alone are stated here too, so the administration
  // screen offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_COMPENSATION_PERMISSIONS,
});

const commandsOf = (
  dependencies: CompensationDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    defineCompensationPlanHandler(dependencies),
    publishCompensationPlanHandler(dependencies),
    permitComponentHandler(dependencies),
    assignCompensationPlanHandler(dependencies),

    defineSalaryStructureHandler(dependencies),
    definePayGradeHandler(dependencies),
    definePayScaleHandler(dependencies),
    defineSalaryStepHandler(dependencies),

    defineComponentHandler(dependencies),
    publishComponentHandler(dependencies),

    assignRecurringHandler(dependencies),
    amendRecurringHandler(dependencies),
    endRecurringHandler(dependencies),
    recordOneTimeHandler(dependencies),
    recordAdjustmentHandler(dependencies),

    decideCompensationHandler(dependencies),
    reverseDecisionHandler(dependencies),

    importCompensationHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (
  dependencies: CompensationDependencies,
): readonly QueryHandler<Query, unknown>[] =>
  [
    listPlansHandler(dependencies),
    listStructuresHandler(dependencies),
    listGradesHandler(dependencies),
    listScalesHandler(dependencies),
    listStepsHandler(dependencies),
    listComponentsHandler(dependencies),
    listImportsHandler(dependencies),

    readEmploymentCompensationHandler(dependencies),
    readFutureChangesHandler(dependencies),
    readCompensationHistoryHandler(dependencies),
    searchRecurringHandler(dependencies),
    searchOneTimeHandler(dependencies),
    searchAdjustmentsHandler(dependencies),
    readApprovalChainHandler(dependencies),
    readCompensationDashboardHandler(dependencies),

    // The two Payroll reads. The whole of Compensation's published cross-module surface.
    readPayrollPeriodHandler(dependencies),
    readChangedSinceHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
