import {
  CompensationPlanRepository,
  PlanAssignmentRepository,
  PlanComponentRepository,
} from './definition.repository.js';
import { ComponentRepository } from './component.repository.js';
import {
  PayGradeRepository,
  PayScaleRepository,
  SalaryStepRepository,
  SalaryStructureRepository,
} from './structure.repository.js';
import { RecurringRepository } from './recurring.repository.js';
import { AdjustmentRepository, OneTimeRepository } from './record.repository.js';
import {
  ApprovalDecisionRepository,
  CompensationChangeRepository,
  ImportBatchRepository,
} from './audit.repository.js';
import type { CompensationStores } from '../application/compensation-ports.js';

/**
 * All fourteen repositories, assembled — the one thing the composition root needs from this layer.
 *
 * Assembled here rather than in the API so the API knows the module by its published surface only.
 * Every repository is stateless and holds no connection: the `Transaction` arrives per call from
 * the unit of work, which is what keeps a use case from reading outside the transaction it is
 * writing in.
 */
export const postgresCompensationStores = (): CompensationStores => ({
  plans: new CompensationPlanRepository(),
  planComponents: new PlanComponentRepository(),
  planAssignments: new PlanAssignmentRepository(),
  structures: new SalaryStructureRepository(),
  grades: new PayGradeRepository(),
  scales: new PayScaleRepository(),
  steps: new SalaryStepRepository(),
  components: new ComponentRepository(),
  recurring: new RecurringRepository(),
  oneTime: new OneTimeRepository(),
  adjustments: new AdjustmentRepository(),
  decisions: new ApprovalDecisionRepository(),
  changes: new CompensationChangeRepository(),
  imports: new ImportBatchRepository(),
});
