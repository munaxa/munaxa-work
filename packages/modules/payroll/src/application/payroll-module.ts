import type { Command, CommandHandler, Query, QueryHandler, WorkModule } from '@work/kernel';

import {
  amendPayrollGroupHandler,
  defineDeductionHandler,
  definePayrollGroupHandler,
} from './group.use-case.js';
import { movePeriodHandler, openPayrollPeriodHandler } from './period.use-case.js';
import { calculateRunHandler } from './calculation.use-case.js';
import { reconcileRunHandler } from './reconciliation.use-case.js';
import { approveRunHandler, reverseApprovalHandler } from './decision.use-case.js';
import { finalizeRunHandler, reverseRunHandler } from './finalization.use-case.js';
import { recordAdjustmentHandler } from './adjustment.use-case.js';
import {
  listDeductionsHandler,
  listPayrollGroupsHandler,
  listPeriodsHandler,
  readPayrollDashboardHandler,
} from './definition-queries.js';
import {
  listAdjustmentReasonsHandler,
  listAdjustmentsHandler,
  listExceptionsHandler,
  listRunsHandler,
  readApprovalChainHandler,
  readReconciliationHandler,
  readRunHandler,
} from './run-queries.js';
import {
  listResultsHandler,
  readDeductionsHandler,
  readEarningsHandler,
  readPayslipHandler,
} from './result-queries.js';
import { readAccountingOutputHandler, readPaymentInstructionsHandler } from './output-queries.js';
import { ALL_PAYROLL_PERMISSIONS, PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Payroll's module declaration: eleven commands, eighteen queries, one navigation entry.
 *
 * Registered on the same dispatcher as every other module. Nothing here subscribes to an event —
 * the module has no `eventHandlers` at all, and that is deliberate: the dispatch is at-most-once
 * with no outbox, so a payroll that depended on one would be wrong the first time a process
 * restarted mid-dispatch. Every cross-module fact is **pulled** (ADR-0064).
 */
export const payrollModule = (dependencies: PayrollDependencies): WorkModule => ({
  name: 'payroll',

  commands: commandsOf(dependencies),
  queries: queriesOf(dependencies),

  navigation: [
    {
      key: 'payroll.runs',
      path: '/payroll',
      permission: PayrollPermissions.read,
      order: 55,
    },
  ],

  // The permissions no handler declares alone are stated here too, so the administration screen
  // offers the whole set rather than the subset that happens to be a handler's own.
  permissions: ALL_PAYROLL_PERMISSIONS,
});

const commandsOf = (
  dependencies: PayrollDependencies,
): readonly CommandHandler<Command, unknown>[] =>
  [
    definePayrollGroupHandler(dependencies),
    amendPayrollGroupHandler(dependencies),
    defineDeductionHandler(dependencies),

    openPayrollPeriodHandler(dependencies),
    movePeriodHandler(dependencies),

    calculateRunHandler(dependencies),
    reconcileRunHandler(dependencies),

    approveRunHandler(dependencies),
    reverseApprovalHandler(dependencies),

    finalizeRunHandler(dependencies),
    reverseRunHandler(dependencies),

    recordAdjustmentHandler(dependencies),
  ] as readonly CommandHandler<Command, unknown>[];

const queriesOf = (dependencies: PayrollDependencies): readonly QueryHandler<Query, unknown>[] =>
  [
    listPayrollGroupsHandler(dependencies),
    listDeductionsHandler(dependencies),
    listPeriodsHandler(dependencies),
    readPayrollDashboardHandler(dependencies),

    listRunsHandler(dependencies),
    readRunHandler(dependencies),
    listExceptionsHandler(dependencies),
    readReconciliationHandler(dependencies),
    readApprovalChainHandler(dependencies),
    listAdjustmentsHandler(dependencies),
    listAdjustmentReasonsHandler(dependencies),

    // Everything that carries money, behind `payroll.read-result`.
    listResultsHandler(dependencies),
    readEarningsHandler(dependencies),
    readDeductionsHandler(dependencies),
    readPayslipHandler(dependencies),

    // The two outputs, each behind its own permission.
    readAccountingOutputHandler(dependencies),
    readPaymentInstructionsHandler(dependencies),
  ] as readonly QueryHandler<Query, unknown>[];
