import { noCountryRules, type CountryRulePort } from './country-rule.js';
import type { DeductionDefinitionState } from './deductions.js';
import type { MoneyAmount } from './money-amount.js';
import { CALCULATION_VERSION, type CalculationRequest } from './payroll-calculation.js';
import type { PayrollResultState } from './payroll-lines.js';
import type { PayrollResult } from './payroll-rejection.js';
import type {
  AttendanceFacts,
  CompensationCurrencyFacts,
  EmploymentSnapshot,
} from './payroll-snapshot.js';

/**
 * The fixtures the domain suites share.
 *
 * A June of thirty days, one employment, one salary of 1000.000 JOD — chosen because thirty divides
 * badly enough for proration to be worth checking and because JOD has **three** decimal places,
 * which is the case a two-decimal assumption gets wrong.
 *
 * Apart from the tests because the assertions are the part worth reading, and a suite that spends
 * forty lines assembling a snapshot before each expectation hides them.
 */

export const jod = (amountMinor: bigint): MoneyAmount => ({
  amountMinor,
  currencyCode: 'JOD',
  currencyExponent: 3,
});

export const usd = (amountMinor: bigint): MoneyAmount => ({
  amountMinor,
  currencyCode: 'USD',
  currencyExponent: 2,
});

export const aPeriod = (): { readonly periodStart: string; readonly periodEnd: string } => ({
  periodStart: '2026-06-01',
  periodEnd: '2026-06-30',
});

export interface SnapshotOverrides {
  readonly employment?: Partial<NonNullable<EmploymentSnapshot['employment']>>;
  readonly attendance?: Partial<AttendanceFacts>;
  readonly components?: readonly Partial<CompensationCurrencyFacts['recurring'][number]>[];
  readonly oneTime?: CompensationCurrencyFacts['oneTime'];
  readonly secondCurrency?: boolean;
  readonly withoutCompensation?: boolean;
  readonly withoutAttendance?: boolean;
}

export const aSnapshot = (overrides: SnapshotOverrides = {}): EmploymentSnapshot => ({
  employmentId: 'employment-1',
  employment: {
    employmentId: 'employment-1',
    status: 'active',
    startDate: '2020-01-01',
    employmentTypeCode: 'full-time',
    costCenterId: 'centre-1',
    unitId: 'unit-1',
    version: 4,
    ...overrides.employment,
  },
  ...(overrides.withoutCompensation
    ? {}
    : {
        compensation: {
          currencies: currencyBlocks(overrides),
          compensationPlanId: 'plan-1',
          planVersion: 1,
          inputsDigest: 'aaaa0001',
          calculationVersion: 1,
        },
      }),
  ...(overrides.withoutAttendance
    ? {}
    : {
        attendance: {
          snapshotId: 'attendance-1',
          sequence: 1,
          frozenAt: new Date('2026-07-01T00:00:00.000Z'),
          workedMinutes: 9_600,
          regularCandidateMinutes: 9_600,
          overtimeCandidateMinutes: 0,
          unpaidMinutes: 0,
          absenceMinutes: 0,
          leaveMinutes: 0,
          leaveState: 'known',
          blockingExceptions: 0,
          inputsDigest: 'bbbb0001',
          calculationVersion: 1,
          ...overrides.attendance,
        },
      }),
  capturedAt: new Date('2026-07-01T08:00:00.000Z'),
});

const currencyBlocks = (overrides: SnapshotOverrides): readonly CompensationCurrencyFacts[] => {
  const base: CompensationCurrencyFacts = {
    currencyCode: 'JOD',
    currencyExponent: 3,
    recurring: (overrides.components ?? [{}]).map((component, index) => ({
      componentId: `component-${index + 1}`,
      componentCode: 'salary',
      kind: 'base',
      payrollTreatmentCode: 'ordinary',
      proratable: true,
      amount: jod(1_000_000n),
      effectiveFrom: '2020-01-01',
      partialPeriod: false,
      ...component,
    })),
    oneTime: overrides.oneTime ?? [],
  };

  if (overrides.secondCurrency !== true) return [base];

  return [
    base,
    {
      currencyCode: 'USD',
      currencyExponent: 2,
      recurring: [
        {
          componentId: 'component-usd',
          componentCode: 'foreign-allowance',
          kind: 'allowance',
          payrollTreatmentCode: 'ordinary',
          proratable: false,
          amount: usd(50_000n),
          effectiveFrom: '2020-01-01',
          partialPeriod: false,
        },
      ],
      oneTime: [],
    },
  ];
};

export interface RequestOverrides extends SnapshotOverrides {
  readonly definitions?: readonly DeductionDefinitionState[];
  readonly countryRules?: CountryRulePort;
  readonly countryCode?: string;
  readonly permittedCurrencies?: readonly string[];
}

export const aRequest = (overrides: RequestOverrides = {}): CalculationRequest => ({
  period: aPeriod(),
  snapshot: aSnapshot(overrides),
  policy: {
    basis: 'calendar_days',
    rounding: 'half-up',
    permittedCurrencies: overrides.permittedCurrencies ?? ['JOD', 'USD'],
    ...(overrides.countryCode === undefined ? {} : { countryCode: overrides.countryCode }),
  },
  definitions: overrides.definitions ?? [],
  countryRules: overrides.countryRules ?? noCountryRules,
  payrollRunId: 'run-1',
  identifier: (kind, sequence) => `${kind}#${sequence}`,
});

/** The single JOD result, for the many assertions that only care about one. */
export const onlyResult = (
  outcome: PayrollResult<{ readonly results: readonly PayrollResultState[] }>,
): PayrollResultState | undefined => (outcome.ok ? outcome.value.results[0] : undefined);

export const CALCULATION_VERSION_UNDER_TEST = CALCULATION_VERSION;
