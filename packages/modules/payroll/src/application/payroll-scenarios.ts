import { uuidV7 } from '@work/kernel';

import type {
  AttendanceFacts,
  CompensationFacts,
  EmploymentFacts,
  LeaveFacts,
} from '../domain/payroll-snapshot.js';
import { harnessFor, send, type Harness, type HarnessOptions } from './payroll-test-harness.js';

/**
 * The configuration every application suite starts from: one group, one June period, one employment
 * with a salary, an attendance snapshot and no leave.
 *
 * Apart from the tests because the assertions are the part worth reading, and a suite that spends
 * forty lines assembling four source payloads before each expectation hides them.
 *
 * June of thirty days and a salary of 1000.000 JOD, chosen because thirty divides badly enough for
 * proration to be worth checking and because JOD has **three** decimal places — the case a
 * two-decimal assumption gets wrong.
 */

export const ADMIN = 'user:payroll-administrator';
export const APPROVER = 'user:payroll-approver';

export interface Configured {
  readonly harness: Harness;
  readonly payrollGroupId: string;
  readonly payrollPeriodId: string;
  readonly employmentId: string;
}

export interface ConfigureOptions extends HarnessOptions {
  readonly employments?: number;
  readonly paysSuspended?: boolean;
  readonly permittedCurrencies?: readonly { readonly code: string; readonly exponent: number }[];
}

export const configured = async (options: ConfigureOptions = {}): Promise<Configured> => {
  const harness = harnessFor(options);
  const employmentIds = Array.from({ length: options.employments ?? 1 }, () => uuidV7()).sort();

  for (const employmentId of employmentIds) {
    harness.employment.set(employmentId, employmentFacts(employmentId));
    harness.compensation.set(employmentId, compensationFacts());
    harness.attendance.set(employmentId, attendanceFacts());
  }

  const built = await harness.as(ADMIN, async () => {
    const group = await send<{ payrollGroupId: string }>(harness, {
      commandName: 'payroll.define-group',
      legalEntityId: uuidV7(),
      code: 'monthly-staff',
      name: { en: 'Monthly staff', ar: 'الموظفون الشهريون' },
      payFrequency: 'monthly',
      permittedCurrencies: options.permittedCurrencies ?? [{ code: 'JOD', exponent: 3 }],
      prorationBasis: 'calendar_days',
      roundingMode: 'half-up',
      paysSuspended: options.paysSuspended ?? false,
      expenseAccount: 'payroll-expense',
      deductionAccount: 'payroll-deductions',
      payableAccount: 'payroll-payable',
      paymentMethodCode: 'bank-transfer',
    });

    const period = await send<{ payrollPeriodId: string }>(harness, {
      commandName: 'payroll.open-period',
      payrollGroupId: group.payrollGroupId,
      code: '2026-06',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      paymentDate: '2026-07-05',
    });

    await send(harness, {
      commandName: 'payroll.move-period',
      payrollPeriodId: period.payrollPeriodId,
      status: 'open',
      expectedVersion: 1,
    });

    return { ...group, ...period };
  });

  return {
    harness,
    payrollGroupId: built.payrollGroupId,
    payrollPeriodId: built.payrollPeriodId,
    employmentId: employmentIds[0] ?? '',
  };
};

export const employmentFacts = (
  employmentId: string,
  overrides: Partial<EmploymentFacts> = {},
): EmploymentFacts => ({
  employmentId,
  status: 'active',
  startDate: '2020-01-01',
  employmentTypeCode: 'full-time',
  costCenterId: uuidV7(),
  unitId: uuidV7(),
  version: 4,
  ...overrides,
});

export const compensationFacts = (
  overrides: Partial<CompensationFacts> = {},
): CompensationFacts => ({
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
          amount: { amountMinor: 1_000_000n, currencyCode: 'JOD', currencyExponent: 3 },
          effectiveFrom: '2020-01-01',
          partialPeriod: false,
        },
      ],
      oneTime: [],
    },
  ],
  compensationPlanId: uuidV7(),
  planVersion: 1,
  inputsDigest: 'aaaa0001',
  calculationVersion: 1,
  ...overrides,
});

export const attendanceFacts = (overrides: Partial<AttendanceFacts> = {}): AttendanceFacts => ({
  snapshotId: uuidV7(),
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
  ...overrides,
});

export const leaveFacts = (overrides: Partial<LeaveFacts> = {}): LeaveFacts => ({
  lines: [],
  encashableMinutes: 0,
  inputsDigest: 'cccc0001',
  calculationVersion: 1,
  ...overrides,
});

/** Calculates the configured period to completion, which most suites need before asserting. */
export const calculated = async (
  configuration: Configured,
): Promise<{ readonly payrollRunId: string; readonly resultCount: number }> =>
  configuration.harness.as(ADMIN, () =>
    send<{ payrollRunId: string; resultCount: number }>(configuration.harness, {
      commandName: 'payroll.calculate',
      payrollPeriodId: configuration.payrollPeriodId,
    }),
  );
