import { uuidV7, type Transaction } from '@work/kernel';

import { CompensationComponent } from '../domain/compensation-component.js';
import { CompensationPlan } from '../domain/compensation-plan.js';
import { payGrade } from '../domain/salary-structure.js';
import { salaryStep } from '../domain/pay-scale.js';
import { planAssignment } from '../domain/plan-assignment.js';
import { recurring } from '../domain/recurring.js';
import { oneTime } from '../domain/one-time.js';
import { adjustment } from '../domain/adjustment.js';
import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { CompensationPlanState } from '../domain/compensation-plan.js';
import type { CompensationResult } from '../domain/compensation-rejection.js';
import type { PayGradeState } from '../domain/salary-structure.js';
import type { SalaryStepState } from '../domain/pay-scale.js';
import type { RecurringState } from '../domain/recurring.js';
import type { OneTimeState } from '../domain/one-time.js';
import type { AdjustmentState } from '../domain/adjustment.js';
import type { ApprovalDecisionState } from '../domain/approval.js';
import type { MoneyInput } from '../domain/money-amount.js';
import type { PlanAssignmentState } from '../domain/plan-assignment.js';
import type { CompensationStores } from '../application/compensation-ports.js';

/**
 * Rows the integration suites need, built through the **domain** rather than as literals.
 *
 * Through the domain because a literal row can carry a combination the aggregate would refuse — a
 * grade whose midpoint is outside its own range, a percentage with no basis — and a persistence
 * test that stored one would be proving the database accepts something the product never produces.
 */

const AT = new Date('2026-06-15T09:00:00Z');

/** A domain result, or a loud failure. A fixture that half-built a row is worse than no fixture. */
const unwrap = <TValue>(result: CompensationResult<TValue>): TValue => {
  if (!result.ok) throw new Error(`Fixture refused: ${result.error.reason}`);
  return result.value;
};

export const jod = (minor: string): MoneyInput => ({
  amountMinor: minor,
  currencyCode: 'JOD',
  currencyExponent: 3,
});

export const aPlan = (tenantId: string, code = 'standard'): CompensationPlanState => {
  const drafted = unwrap(
    CompensationPlan.define(
      {
        tenantId,
        code,
        name: { en: 'Standard', ar: 'قياسي' },
        defaultCurrencyCode: 'JOD',
        defaultCurrencyExponent: 3,
        approvalRequired: false,
        approvalsRequired: 0,
      },
      AT,
    ),
  );
  const published = drafted.publish('user:hr', AT);

  return published.ok ? published.value : drafted.snapshot();
};

export const aComponent = (
  tenantId: string,
  code = 'basic',
  overrides: Record<string, unknown> = {},
): CompensationComponentState => {
  const drafted = unwrap(
    CompensationComponent.define(
      {
        tenantId,
        code,
        name: { en: code, ar: code },
        kind: 'base',
        calculationBasis: 'fixed_amount',
        roundingMode: 'half-up',
        payrollTreatmentCode: 'ordinary',
        ...overrides,
      },
      AT,
    ),
  );
  const published = drafted.publish('user:hr', AT);

  return published.ok ? published.value : drafted.snapshot();
};

export const anAssignment = (tenantId: string, compensationPlanId: string): PlanAssignmentState =>
  unwrap(
    planAssignment(
      { tenantId, compensationPlanId, scope: 'tenant', effectiveFrom: '2020-01-01' },
      AT,
    ),
  );

export const aGrade = (tenantId: string, code = 'c'): PayGradeState =>
  unwrap(
    payGrade(
      {
        tenantId,
        code,
        name: { en: 'C', ar: 'ج' },
        range: { minimum: jod('500000'), midpoint: jod('750000'), maximum: jod('1000000') },
        effectiveFrom: '2020-01-01',
      },
      AT,
    ),
  );

export const aStep = (tenantId: string, payGradeId: string, stepNumber = 1): SalaryStepState =>
  unwrap(
    salaryStep(
      { tenantId, payGradeId, stepNumber, amount: jod('750000'), effectiveFrom: '2020-01-01' },
      AT,
    ),
  );

export const aRecurring = (
  tenantId: string,
  employmentId: string,
  componentId: string,
  compensationPlanId: string,
  overrides: Record<string, unknown> = {},
): RecurringState =>
  unwrap(
    recurring(
      {
        tenantId,
        employmentId,
        componentId,
        compensationPlanId,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
        recordedBy: 'user:hr',
        approvalState: 'not_required',
        ...overrides,
      },
      AT,
    ),
  );

export const aOneTime = (
  tenantId: string,
  employmentId: string,
  componentId: string,
  compensationPlanId: string,
  overrides: Record<string, unknown> = {},
): OneTimeState =>
  unwrap(
    oneTime(
      {
        tenantId,
        employmentId,
        componentId,
        compensationPlanId,
        amount: jod('500000'),
        payableOn: '2026-06-15',
        reasonCode: 'annual-bonus',
        recordedBy: 'user:hr',
        approvalState: 'not_required',
        ...overrides,
      },
      AT,
    ),
  );

export const anAdjustment = (
  tenantId: string,
  employmentId: string,
  componentId: string,
): AdjustmentState =>
  unwrap(
    adjustment(
      {
        tenantId,
        employmentId,
        componentId,
        adjustmentType: 'merit',
        previousAmount: jod('1000000'),
        newAmount: jod('1100000'),
        currencyCode: 'JOD',
        currencyExponent: 3,
        effectiveFrom: '2026-07-01',
        reasonCode: 'annual-review',
        note: 'Agreed at the July review.',
        requestedBy: 'user:hr',
        approvalState: 'pending',
      },
      AT,
    ),
  );

/**
 * A decision.
 *
 * Built as state rather than through the use case, because the suites are about what the *database*
 * enforces — the self-approval check constraint, the sequence uniqueness — and routing through the
 * application layer would test the application layer instead.
 */
export const aDecision = (
  tenantId: string,
  subjectId: string,
  decidedBy: string,
  requestedBy = 'user:hr',
): ApprovalDecisionState => ({
  id: uuidV7(),
  tenantId,
  subjectKind: 'recurring',
  subjectId,
  sequence: 1,
  decision: 'approved',
  decidedBy,
  decidedAt: AT,
  // Copied from the subject, which is what makes the self-approval check constraint enforceable.
  requestedBy,
  version: 0,
});

/** A configured tenant: a published plan, a tenant assignment and a published component. */
export const configuredTenant = async (
  transaction: Transaction,
  stores: CompensationStores,
  tenantId: string,
): Promise<{ readonly planId: string; readonly componentId: string }> => {
  const plan = aPlan(tenantId);
  const component = aComponent(tenantId);

  await stores.plans.insert(transaction, plan);
  await stores.components.insert(transaction, component);
  await stores.planAssignments.insert(transaction, anAssignment(tenantId, plan.id));

  return { planId: plan.id, componentId: component.id };
};
