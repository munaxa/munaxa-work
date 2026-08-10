import { uuidV7, type Transaction } from '@work/kernel';

import { openBalance } from '../domain/balance.js';
import { entitlement } from '../domain/entitlement.js';
import { ledgerEntry } from '../domain/ledger.js';
import { LeavePolicy } from '../domain/leave-policy.js';
import { LeaveType } from '../domain/leave-type.js';
import { policyAssignment } from '../domain/policy-assignment.js';
import type { BalanceState } from '../domain/balance.js';
import type { EntitlementState } from '../domain/entitlement.js';
import type { LeavePolicyState } from '../domain/leave-policy.js';
import type { LeaveResult } from '../domain/leave-rejection.js';
import type { PolicyAssignmentState } from '../domain/policy-assignment.js';
import type { LeaveTypeState } from '../domain/leave-type.js';
import type { LedgerEntryState } from '../domain/ledger.js';
import type {
  LeaveRequestState,
  RequestDayState,
  RequestDecisionState,
} from '../domain/leave-request-state.js';
import type { LeaveStores } from '../application/leave-ports.js';

/**
 * Rows the integration suites need, built through the **domain** rather than as literals.
 *
 * Through the domain because a literal row can carry a combination the aggregate would refuse — a
 * credit with a negative sign, a policy with a cap and no method — and a persistence test that
 * stored one would be proving the database accepts something the product never produces.
 */

const AT = new Date('2026-06-15T09:00:00Z');

/** A domain result, or a loud failure. A fixture that half-built a row is worse than no fixture. */
const unwrap = <TValue>(result: LeaveResult<TValue>): TValue => {
  if (!result.ok) throw new Error(`Fixture refused: ${result.error.reason}`);
  return result.value;
};

export const aLeaveType = (tenantId: string, code = 'holiday'): LeaveTypeState => {
  const drafted = unwrap(
    LeaveType.define(
      {
        tenantId,
        code,
        name: { en: 'Holiday', ar: 'عطلة' },
        unit: 'days',
        paidTreatmentCode: 'full-pay',
      },
      AT,
    ),
  );
  const published = drafted.publish('user:hr', AT);

  return published.ok ? published.value : drafted.snapshot();
};

export const aPolicy = (tenantId: string, leaveTypeId: string): LeavePolicyState => {
  const drafted = unwrap(
    LeavePolicy.define(
      {
        tenantId,
        leaveTypeId,
        code: 'standard',
        name: { en: 'Standard', ar: 'قياسي' },
        effectiveFrom: '2020-01-01',
      },
      AT,
    ),
  );
  const published = drafted.publish('user:hr', AT);

  return published.ok ? published.value : drafted.snapshot();
};

export const anAssignment = (tenantId: string, leavePolicyId: string): PolicyAssignmentState =>
  unwrap(
    policyAssignment({ tenantId, leavePolicyId, scope: 'tenant', effectiveFrom: '2020-01-01' }, AT),
  );

export const anEntitlement = (
  tenantId: string,
  employmentId: string,
  leaveTypeId: string,
  leavePolicyId: string,
): EntitlementState =>
  unwrap(
    entitlement(
      {
        tenantId,
        employmentId,
        leaveTypeId,
        leavePolicyId,
        leaveYear: { start: '2026-01-01', end: '2026-12-31' },
        grantedMinutes: 9600,
        source: 'opening',
      },
      AT,
    ),
  );

export const anEntry = (
  tenantId: string,
  employmentId: string,
  leaveTypeId: string,
  overrides: {
    readonly kind?: 'opening' | 'accrual' | 'consumption';
    readonly minutes?: number;
  } = {},
): LedgerEntryState =>
  unwrap(
    ledgerEntry(
      {
        tenantId,
        employmentId,
        leaveTypeId,
        leaveYearStart: '2026-01-01',
        kind: overrides.kind ?? 'opening',
        minutes: overrides.minutes ?? 9600,
        effectiveOn: '2026-01-01',
        sourceKind: 'entitlement',
        sourceId: uuidV7(),
        balanceBeforeMinutes: 0,
      },
      AT,
    ),
  );

export const aBalance = (
  tenantId: string,
  employmentId: string,
  leaveTypeId: string,
): BalanceState =>
  openBalance(
    { tenantId, employmentId, leaveTypeId, leaveYear: { start: '2026-01-01', end: '2026-12-31' } },
    AT,
  );

/**
 * A request and one day of it.
 *
 * Built as state rather than through the use case, because these suites are about what the
 * *database* enforces — the exclusion constraint, the foreign keys, the self-approval check — and
 * routing through the application layer would test the application layer instead.
 */
export const aRequest = (
  tenantId: string,
  employmentId: string,
  leaveTypeId: string,
  leavePolicyId: string,
  overrides: Partial<LeaveRequestState> = {},
): LeaveRequestState => ({
  id: uuidV7(),
  tenantId,
  employmentId,
  leaveTypeId,
  leavePolicyId,
  fromDate: '2026-06-15',
  toDate: '2026-06-15',
  totalMinutes: 480,
  durationBasis: 'working_days',
  state: 'approved',
  requestedBy: 'user:employee',
  requestedAt: AT,
  approvedAt: AT,
  balanceAtRequestMinutes: 9600,
  approvalsRequired: 1,
  metadata: {},
  version: 0,
  ...overrides,
});

export const aDay = (
  request: LeaveRequestState,
  overrides: Partial<RequestDayState> = {},
): RequestDayState => ({
  id: uuidV7(),
  tenantId: request.tenantId,
  leaveRequestId: request.id,
  employmentId: request.employmentId,
  onDate: request.fromDate,
  portion: 'full_day',
  minutes: 480,
  zone: 'Asia/Amman',
  expectedMinutes: 480,
  version: 0,
  ...overrides,
});

export const aDecision = (request: LeaveRequestState, decidedBy: string): RequestDecisionState => ({
  id: uuidV7(),
  tenantId: request.tenantId,
  leaveRequestId: request.id,
  sequence: 1,
  decision: 'approved',
  decidedBy,
  decidedAt: AT,
  // Copied from the request, which is what makes the self-approval check constraint enforceable.
  requestedBy: request.requestedBy,
  version: 0,
});

/** A configured tenant: a published type, a published policy and an assignment. */
export const configuredTenant = async (
  transaction: Transaction,
  stores: LeaveStores,
  tenantId: string,
): Promise<{ readonly leaveTypeId: string; readonly leavePolicyId: string }> => {
  const type = aLeaveType(tenantId);
  const policy = aPolicy(tenantId, type.id);

  await stores.types.insert(transaction, type);
  await stores.policies.insert(transaction, policy);
  await stores.assignments.insert(transaction, anAssignment(tenantId, policy.id));

  return { leaveTypeId: type.id, leavePolicyId: policy.id };
};
