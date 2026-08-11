import { uuidV7 } from '@work/kernel';

import { CALCULATION_VERSION } from '../domain/payroll-calculation.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { MoneyAmount } from '../domain/money-amount.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollResultState } from '../domain/payroll-lines.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type { EmploymentSnapshot } from '../domain/payroll-snapshot.js';

/**
 * The states the integration suites persist.
 *
 * Apart from the suites because the assertions are the part worth reading, and because every suite
 * needs the same four-row chain — group, period, run, result — before it can say anything about a
 * constraint.
 */

export const jod = (amountMinor: bigint): MoneyAmount => ({
  amountMinor,
  currencyCode: 'JOD',
  currencyExponent: 3,
});

export const aGroup = (overrides: Partial<PayrollGroupState> = {}): PayrollGroupState => ({
  payrollGroupId: uuidV7(),
  legalEntityId: uuidV7(),
  code: `group-${uuidV7().slice(-8)}`,
  name: { en: 'Monthly staff', ar: 'الموظفون الشهريون' },
  payFrequency: 'monthly',
  permittedCurrencies: ['JOD'],
  currencyExponents: { JOD: 3 },
  prorationBasis: 'calendar_days',
  roundingMode: 'half-up',
  paysSuspended: false,
  eligibilityRuleVersion: 1,
  expenseAccount: 'payroll-expense',
  deductionAccount: 'payroll-deductions',
  payableAccount: 'payroll-payable',
  paymentMethodCode: 'bank-transfer',
  active: true,
  version: 1,
  ...overrides,
});

export const aPeriod = (
  payrollGroupId: string,
  overrides: Partial<PayrollPeriodState> = {},
): PayrollPeriodState => ({
  payrollPeriodId: uuidV7(),
  payrollGroupId,
  code: `2026-06-${uuidV7().slice(-6)}`,
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
  paymentDate: '2026-07-05',
  status: 'open',
  version: 1,
  ...overrides,
});

export const aRun = (
  period: PayrollPeriodState,
  overrides: Partial<PayrollRunState> = {},
): PayrollRunState => ({
  payrollRunId: uuidV7(),
  payrollPeriodId: period.payrollPeriodId,
  payrollGroupId: period.payrollGroupId,
  runSequence: 1,
  runKind: 'regular',
  status: 'calculated',
  calculationVersion: CALCULATION_VERSION,
  ruleSetDigest: 'aaaa0001',
  eligibilityRuleVersion: 1,
  populationSize: 1,
  resultCount: 1,
  exceptionCount: 0,
  staleCount: 0,
  version: 1,
  ...overrides,
});

export const aResult = (
  runId: string,
  employmentId: string,
  overrides: Partial<PayrollResultState> = {},
): PayrollResultState => ({
  payrollResultId: uuidV7(),
  payrollRunId: runId,
  employmentId,
  currencyCode: 'JOD',
  currencyExponent: 3,
  gross: jod(1_000_000n),
  totalDeductions: jod(0n),
  net: jod(1_000_000n),
  earnings: [],
  deductions: [],
  snapshotDigest: 'bbbb0001',
  calculationVersion: CALCULATION_VERSION,
  ...overrides,
});

export const aSnapshot = (
  employmentId: string,
  overrides: Partial<EmploymentSnapshot> = {},
): EmploymentSnapshot => ({
  employmentId,
  employment: {
    employmentId,
    status: 'active',
    startDate: '2020-01-01',
    employmentTypeCode: 'full-time',
    version: 4,
  },
  compensation: {
    currencies: [
      {
        currencyCode: 'JOD',
        currencyExponent: 3,
        recurring: [
          {
            componentId: uuidV7(),
            componentCode: 'salary',
            kind: 'base',
            payrollTreatmentCode: 'ordinary',
            proratable: true,
            amount: jod(1_000_000n),
            effectiveFrom: '2020-01-01',
            partialPeriod: false,
          },
        ],
        oneTime: [],
      },
    ],
    inputsDigest: 'cccc0001',
    calculationVersion: 1,
  },
  capturedAt: new Date('2026-07-01T08:00:00.000Z'),
  ...overrides,
});

export const aDeductionDefinition = (
  payrollGroupId: string,
  overrides: Partial<DeductionDefinitionState> = {},
): DeductionDefinitionState => ({
  deductionDefinitionId: uuidV7(),
  payrollGroupId,
  code: `deduction-${uuidV7().slice(-8)}`,
  name: { en: 'Union dues', ar: 'رسوم النقابة' },
  deductionSource: 'voluntary',
  payrollTreatmentCode: 'voluntary',
  basis: 'fixed_amount',
  fixedAmount: jod(5_000n),
  roundingMode: 'half-up',
  priority: 50,
  active: true,
  version: 1,
  ...overrides,
});
