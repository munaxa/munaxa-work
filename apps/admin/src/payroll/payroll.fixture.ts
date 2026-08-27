import type {
  AccountingLineView,
  DeductionDefinitionView,
  DeductionLineView,
  EarningLineView,
  MoneyAmountView,
  PaymentInstructionView,
  PayrollAdjustmentView,
  PayrollApprovalChainView,
  PayrollDashboardView,
  PayrollExceptionView,
  PayrollGroupView,
  PayrollPeriodView,
  PayrollReconciliationView,
  PayrollResultView,
  PayrollRunView,
  PayslipView,
} from '@work/payroll/contracts';

import type { Listing, PayrollWorkspace, RunForDisplay } from './api';

/**
 * A tenant's payroll, as the module would answer it.
 *
 * Every value is shaped by a published contract, so a change to one these screens have not followed
 * fails to compile rather than rendering something wrong.
 *
 * Four properties of these fixtures are the point rather than decoration.
 *
 * **Every total is larger than its page**, so a section reporting `items.length` fails rather than
 * looking plausible.
 *
 * **There are several runs and several results**, so a screen that silently showed the first of
 * either can be caught doing it.
 *
 * **Gross minus deductions does not equal net.** The module calculated and froze three figures; a
 * screen that derived the third from the other two would produce `1600.000` where the fixture says
 * `1575.500`, and the test says which one is on the page.
 *
 * **Two results carry two different currencies**, because Payroll publishes one result per currency
 * and never totals across them.
 */

const RUN = '01900000-0000-7000-8000-0000000000n1';
const RUN_TWO = '01900000-0000-7000-8000-0000000000n2';
const RESULT = '01900000-0000-7000-8000-0000000000t1';
const PERIOD = '01900000-0000-7000-8000-0000000000d1';
const GROUP = '01900000-0000-7000-8000-0000000000g1';
const EMPLOYMENT = '01900000-0000-7000-8000-0000000000e1';

const money = (amount: string, currencyCode = 'JOD'): MoneyAmountView => ({
  amountMinor: amount.replace('.', ''),
  amount,
  currencyCode,
  currencyExponent: 3,
});

export const aDashboard = (): PayrollDashboardView => ({
  openPeriods: 2,
  runsAwaitingApproval: 3,
  staleRuns: 1,
  unresolvedExceptions: 7,
  finalizedThisMonth: 4,
  groupsConfigured: 3,
});

export const aRun = (): PayrollRunView => ({
  payrollRunId: RUN,
  payrollPeriodId: PERIOD,
  payrollGroupId: GROUP,
  runSequence: 14,
  runKind: 'regular',
  status: 'calculated',
  calculationVersion: 3,
  ruleSetDigest: 'sha256:9f1c',
  eligibilityRuleVersion: 2,
  populationSize: 1402,
  resultCount: 1398,
  exceptionCount: 4,
  staleCount: 1,
  calculatedAt: new Date('2026-08-20T04:15:00.000Z'),
  calculatedBy: '01900000-0000-7000-8000-0000000000m1',
  complete: true,
});

/** A second run, so a screen that shows only the first can be caught. */
export const anEarlierRun = (): PayrollRunView => ({
  ...aRun(),
  payrollRunId: RUN_TWO,
  runSequence: 13,
  status: 'finalized',
  finalizedAt: new Date('2026-07-28T09:00:00.000Z'),
  finalizedBy: '01900000-0000-7000-8000-0000000000m2',
  approvedAt: new Date('2026-07-27T11:00:00.000Z'),
  approvedBy: '01900000-0000-7000-8000-0000000000m1',
});

/** A run whose sources moved underneath it. Its state permits neither approval nor finalization. */
export const aStaleRun = (): PayrollRunView => ({
  ...aRun(),
  status: 'stale',
  staleDetectedAt: new Date('2026-08-21T06:00:00.000Z'),
});

/** A reversed run. Terminal: its state permits nothing at all. */
export const aReversedRun = (): PayrollRunView => ({
  ...aRun(),
  status: 'reversed',
  reversalOfRunId: RUN_TWO,
});

export const aPeriod = (): PayrollPeriodView => ({
  payrollPeriodId: PERIOD,
  payrollGroupId: GROUP,
  code: '2026-08',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  paymentDate: '2026-08-28',
  status: 'open',
  version: 2,
});

export const aGroup = (): PayrollGroupView => ({
  payrollGroupId: GROUP,
  legalEntityId: '01900000-0000-7000-8000-0000000000l1',
  code: 'MAIN',
  name: { en: 'Head office', ar: 'المركز الرئيسي' },
  payFrequency: 'monthly',
  permittedCurrencies: ['JOD', 'USD'],
  prorationBasis: 'calendar_days',
  roundingMode: 'half_up',
  paysSuspended: false,
  eligibilityRuleVersion: 2,
  active: true,
  version: 3,
});

export const aDefinition = (): DeductionDefinitionView => ({
  deductionDefinitionId: '01900000-0000-7000-8000-0000000000f1',
  payrollGroupId: GROUP,
  code: 'SOCIAL',
  name: { en: 'Social security', ar: 'الضمان الاجتماعي' },
  deductionSource: 'configured',
  payrollTreatmentCode: 'pre_tax',
  basis: 'percentage',
  basisPoints: 750,
  roundingMode: 'half_up',
  priority: 10,
  active: true,
});

const result = (id: string, employmentId: string, currency: string): PayrollResultView => ({
  payrollResultId: id,
  payrollRunId: RUN,
  employmentId,
  currencyCode: currency,
  currencyExponent: 3,
  gross: money('1850.000', currency),
  totalDeductions: money('274.500', currency),
  net: money('1575.500', currency),
  snapshotDigest: 'sha256:aa11',
  calculationVersion: 3,
  finalized: false,
});

export const aResult = (): PayrollResultView => result(RESULT, EMPLOYMENT, 'JOD');

/** A second result, in a second currency. Payroll never totals across them and neither may a screen. */
export const anotherResult = (): PayrollResultView =>
  result('01900000-0000-7000-8000-0000000000t2', '01900000-0000-7000-8000-0000000000e2', 'USD');

export const anException = (): PayrollExceptionView => ({
  payrollExceptionId: '01900000-0000-7000-8000-0000000000x1',
  employmentId: EMPLOYMENT,
  exceptionCode: 'compensation_missing',
});

/** The exception that blocks finalization. */
export const aBlockingException = (): PayrollExceptionView => ({
  ...anException(),
  payrollExceptionId: '01900000-0000-7000-8000-0000000000x2',
  exceptionCode: 'eligibility_rule_failed',
});

export const anApprovalChain = (): PayrollApprovalChainView => ({
  payrollRunId: RUN,
  required: true,
  state: 'approved',
  steps: [
    {
      sequence: 1,
      decision: 'approved',
      decidedBy: '01900000-0000-7000-8000-0000000000m1',
      decidedAt: new Date('2026-08-21T08:00:00.000Z'),
      comment: 'Checked against the register.',
    },
  ],
});

export const anAdjustment = (): PayrollAdjustmentView => ({
  payrollAdjustmentId: '01900000-0000-7000-8000-0000000000j1',
  employmentId: EMPLOYMENT,
  kind: 'one_time',
  code: 'ARREARS',
  amount: money('120.000'),
  reasonCode: 'retroactive_increase',
  requestedBy: '01900000-0000-7000-8000-0000000000m1',
  recordedAt: new Date('2026-08-19T12:00:00.000Z'),
});

export const aReconciliationRecord = (): PayrollReconciliationView => ({
  employmentId: EMPLOYMENT,
  staleSource: 'compensation',
  previousDigest: 'sha256:0001',
  currentDigest: 'sha256:0002',
  detectedAt: new Date('2026-08-21T06:00:00.000Z'),
});

export const anAccountingLine = (): AccountingLineView => ({
  accountingLineId: '01900000-0000-7000-8000-0000000000c1',
  employmentId: EMPLOYMENT,
  direction: 'debit',
  accountReference: '5100-SALARIES',
  costCenterId: '01900000-0000-7000-8000-0000000000k1',
  amount: money('1850.000'),
  journalReference: 'JV-2026-08-014',
});

export const aPaymentInstruction = (): PaymentInstructionView => ({
  paymentInstructionId: '01900000-0000-7000-8000-0000000000q1',
  employmentId: EMPLOYMENT,
  amount: money('1575.500'),
  paymentDate: '2026-08-28',
  paymentMethodCode: 'bank_transfer',
  paymentReference: 'PAY-2026-08-0014',
  status: 'prepared',
});

const earning = (id: string, code: string, amount: string, sequence: number): EarningLineView => ({
  earningLineId: id,
  sequence,
  earningSource: 'compensation_recurring',
  componentCode: code,
  payrollTreatmentCode: 'taxable',
  amount: money(amount),
  calculationReason: 'full_period',
  detail: { numerator: 31, denominator: 31, roundingMode: 'half_up' },
});

const deduction = (
  id: string,
  code: string,
  amount: string,
  sequence: number,
): DeductionLineView => ({
  deductionLineId: id,
  sequence,
  deductionSource: 'configured',
  deductionCode: code,
  payrollTreatmentCode: 'pre_tax',
  amount: money(amount),
  calculationReason: 'percentage_of_basis',
  detail: { basisPoints: 750, roundingMode: 'half_up' },
  priority: 10,
});

export const aPayslip = (): PayslipView => ({
  payrollResultId: RESULT,
  employmentId: EMPLOYMENT,
  periodCode: '2026-08',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-31',
  paymentDate: '2026-08-28',
  currencyCode: 'JOD',
  currencyExponent: 3,
  gross: money('1850.000'),
  totalDeductions: money('274.500'),
  net: money('1575.500'),
  earnings: [
    earning('01900000-0000-7000-8000-0000000000h1', 'BASIC', '1600.000', 1),
    earning('01900000-0000-7000-8000-0000000000h2', 'TRANSPORT', '250.000', 2),
  ],
  deductions: [deduction('01900000-0000-7000-8000-0000000000i1', 'SOCIAL', '274.500', 1)],
  calculationVersion: 3,
  snapshotDigest: 'sha256:aa11',
  finalized: false,
});

const listing = <TItem>(items: readonly TItem[], total: number): Listing<TItem> => ({
  items,
  total,
});

/** Everything answered, with every total larger than its page. */
export const aFullWorkspace = (): PayrollWorkspace => ({
  dashboard: aDashboard(),
  runs: listing([aRun(), anEarlierRun()], 26),
  periods: listing([aPeriod()], 14),
  groups: [aGroup()],
  definitions: [aDefinition()],
  definitionsGroup: aGroup(),
});

export const aRefusedWorkspace = (): PayrollWorkspace => ({
  dashboard: undefined,
  runs: undefined,
  periods: undefined,
  groups: undefined,
  definitions: undefined,
  definitionsGroup: undefined,
});

export const anEmptyWorkspace = (): PayrollWorkspace => ({
  dashboard: aDashboard(),
  runs: listing([], 0),
  periods: listing([], 0),
  groups: [],
  definitions: undefined,
  definitionsGroup: undefined,
});

export const aRunDetail = (): RunForDisplay => ({
  run: aRun(),
  results: listing([aResult(), anotherResult()], 1398),
  exceptions: [anException()],
  adjustments: [anAdjustment()],
  approvals: anApprovalChain(),
  reconciliation: [aReconciliationRecord()],
  accounting: listing([anAccountingLine()], 2796),
  payments: listing([aPaymentInstruction()], 1398),
});

/** The run reads; the figures, the journal and the instructions each stand on another permission. */
export const aWithheldRunDetail = (): RunForDisplay => ({
  ...aRunDetail(),
  results: undefined,
  accounting: undefined,
  payments: undefined,
});

/** The run reads and answered with nothing. Deliberately not the same as the above. */
export const anEmptyRunDetail = (): RunForDisplay => ({
  run: aRun(),
  results: listing([], 0),
  exceptions: [],
  adjustments: [],
  approvals: { payrollRunId: RUN, required: false, state: 'draft', steps: [] },
  reconciliation: [],
  accounting: listing([], 0),
  payments: listing([], 0),
});
