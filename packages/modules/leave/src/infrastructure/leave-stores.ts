import {
  BlackoutRepository,
  LeavePolicyRepository,
  LeaveTypeRepository,
  PolicyAssignmentRepository,
} from './definition.repository.js';
import { AdjustmentRepository, EntitlementRepository } from './entitlement.repository.js';
import { AccrualRunRepository, LeaveYearRepository } from './run.repository.js';
import { LeaveBalanceRepository } from './balance.repository.js';
import { LeaveLedgerRepository } from './ledger.repository.js';
import { LeaveRequestRepository, RequestDayRepository } from './request.repository.js';
import { RequestDecisionRepository, RequestEventRepository } from './decision.repository.js';
import type { LeaveStores } from '../application/leave-ports.js';

/**
 * All fourteen repositories, assembled — the one thing the composition root needs from this layer.
 *
 * Assembled here rather than in the API so the API knows the module by its published surface only.
 * Every repository is stateless and holds no connection: the `Transaction` arrives per call from
 * the unit of work, which is what keeps a use case from reading outside the transaction it is
 * writing in.
 */
export const postgresLeaveStores = (): LeaveStores => ({
  types: new LeaveTypeRepository(),
  policies: new LeavePolicyRepository(),
  assignments: new PolicyAssignmentRepository(),
  blackouts: new BlackoutRepository(),
  entitlements: new EntitlementRepository(),
  ledger: new LeaveLedgerRepository(),
  balances: new LeaveBalanceRepository(),
  requests: new LeaveRequestRepository(),
  requestDays: new RequestDayRepository(),
  decisions: new RequestDecisionRepository(),
  requestEvents: new RequestEventRepository(),
  adjustments: new AdjustmentRepository(),
  accrualRuns: new AccrualRunRepository(),
  leaveYears: new LeaveYearRepository(),
});
