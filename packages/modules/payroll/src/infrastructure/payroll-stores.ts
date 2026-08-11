import type { PayrollStores } from '../application/payroll-ports.js';
import {
  PostgresDeductionDefinitionRepository,
  PostgresGroupRepository,
  PostgresPeriodRepository,
} from './definition.repository.js';
import {
  PostgresAdjustmentRepository,
  PostgresDecisionRepository,
  PostgresReconciliationRepository,
} from './record.repository.js';
import {
  PostgresAccountingRepository,
  PostgresDashboardRepository,
  PostgresPaymentRepository,
} from './output.repository.js';
import { PostgresResultRepository } from './result.repository.js';
import {
  PostgresDeductionLineRepository,
  PostgresEarningLineRepository,
  PostgresExceptionRepository,
} from './line.repository.js';
import { PostgresRunRepository } from './run.repository.js';
import { PostgresSnapshotRepository } from './snapshot.repository.js';

/**
 * The production stores, assembled.
 *
 * Stateless, so one instance each is enough: every method takes the transaction it works in, which
 * is what keeps a use case from reading outside the unit of work it is writing to.
 */
export const postgresPayrollStores = (): PayrollStores => ({
  groups: new PostgresGroupRepository(),
  deductionDefinitions: new PostgresDeductionDefinitionRepository(),
  periods: new PostgresPeriodRepository(),
  runs: new PostgresRunRepository(),
  snapshots: new PostgresSnapshotRepository(),
  results: new PostgresResultRepository(),
  earnings: new PostgresEarningLineRepository(),
  deductions: new PostgresDeductionLineRepository(),
  exceptions: new PostgresExceptionRepository(),
  adjustments: new PostgresAdjustmentRepository(),
  decisions: new PostgresDecisionRepository(),
  reconciliations: new PostgresReconciliationRepository(),
  accounting: new PostgresAccountingRepository(),
  payments: new PostgresPaymentRepository(),
  dashboard: new PostgresDashboardRepository(),
});
