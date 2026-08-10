import { uuidV7 } from '@work/kernel';

import { ask, send, type Wired } from './cross-module-harness.js';

/**
 * The configuration every cross-module case starts from: a real employment, a real salary through
 * Compensation's own commands, attendance and leave facts, and an open payroll period.
 *
 * Apart from the suites because the assertions are the part worth reading, and because assembling
 * three modules' worth of state takes eighty lines that would otherwise be repeated in each file.
 */

export const ADMIN = 'user:payroll-administrator';
export const APPROVER = 'user:payroll-approver';

export interface MoneyInput {
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

export const jod = (minor: string): MoneyInput => ({
  amountMinor: minor,
  currencyCode: 'JOD',
  currencyExponent: 3,
});

interface Ready {
  readonly employmentId: string;
  readonly payrollGroupId: string;
  readonly payrollPeriodId: string;
}

/**
 * A real employment, a real salary, real attendance and leave facts, and an open payroll period.
 *
 * `personId` is a parameter because against real PostgreSQL the `person` row has to exist before
 * `employment_person_fk` will accept the employment — the production scenario seeds it first and
 * passes the identifier in. In memory the default is fine.
 */
export const configured = async (wired: Wired, personId = uuidV7()): Promise<Ready> => {
  wired.people.add(personId, { en: 'Rania Odeh', ar: 'رانيا عودة' });
  const created = await send<{ employmentId: string }>(wired, {
    commandName: 'employment.create-employment',
    personId,
    employmentTypeCode: 'full-time',
    startDate: '2024-01-15',
  });

  await send(wired, {
    commandName: 'employment.change-status',
    employmentId: created.employmentId,
    status: 'active',
    expectedVersion: 1,
  });

  await assignSalary(wired, created.employmentId);

  wired.attendance.set(created.employmentId, {
    employmentId: created.employmentId,
    sequence: 1,
    inputsDigest: 'att00001',
    overtimeCandidateMinutes: 0,
    unpaidMinutes: 0,
    blockingExceptions: 0,
    leaveState: 'known',
  });
  wired.leave.set(created.employmentId, {
    employmentId: created.employmentId,
    inputsDigest: 'lea00001',
    lines: [],
  });

  return openPeriodFor(wired, created.employmentId);
};

/** The payroll group and the open period, apart so neither half exceeds the length budget. */
const openPeriodFor = async (wired: Wired, employmentId: string): Promise<Ready> => {
  const group = await send<{ payrollGroupId: string }>(wired, {
    commandName: 'payroll.define-group',
    legalEntityId: uuidV7(),
    code: 'monthly-staff',
    name: { en: 'Monthly staff', ar: 'الموظفون الشهريون' },
    payFrequency: 'monthly',
    permittedCurrencies: [{ code: 'JOD', exponent: 3 }],
    prorationBasis: 'calendar_days',
    roundingMode: 'half-up',
    paysSuspended: false,
    expenseAccount: 'payroll-expense',
    deductionAccount: 'payroll-deductions',
    payableAccount: 'payroll-payable',
    paymentMethodCode: 'bank-transfer',
  });
  const period = await send<{ payrollPeriodId: string }>(wired, {
    commandName: 'payroll.open-period',
    payrollGroupId: group.payrollGroupId,
    code: '2026-06',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    paymentDate: '2026-07-05',
  });

  await send(wired, {
    commandName: 'payroll.move-period',
    payrollPeriodId: period.payrollPeriodId,
    status: 'open',
    expectedVersion: 1,
  });

  return {
    employmentId,
    payrollGroupId: group.payrollGroupId,
    payrollPeriodId: period.payrollPeriodId,
  };
};

/** A published plan, a published component, and a recurring assignment — all Compensation's own. */
const assignSalary = async (wired: Wired, employmentId: string): Promise<void> => {
  const plan = await send<{ compensationPlanId: string }>(wired, {
    commandName: 'compensation.define-plan',
    code: 'standard',
    name: { en: 'Standard', ar: 'قياسي' },
    defaultCurrencyCode: 'JOD',
    defaultCurrencyExponent: 3,
    approvalRequired: false,
    approvalsRequired: 0,
  });

  await send(wired, {
    commandName: 'compensation.publish-plan',
    compensationPlanId: plan.compensationPlanId,
    expectedVersion: 1,
  });
  await send(wired, {
    commandName: 'compensation.assign-plan',
    compensationPlanId: plan.compensationPlanId,
    scope: 'tenant',
    effectiveFrom: '2020-01-01',
  });

  const component = await send<{ componentId: string }>(wired, {
    commandName: 'compensation.define-component',
    code: 'basic',
    name: { en: 'Basic', ar: 'أساسي' },
    kind: 'base',
    calculationBasis: 'fixed_amount',
    roundingMode: 'half-up',
    payrollTreatmentCode: 'ordinary',
  });

  await send(wired, {
    commandName: 'compensation.publish-component',
    componentId: component.componentId,
    expectedVersion: 1,
  });
  await send(wired, {
    commandName: 'compensation.assign-recurring',
    employmentId,
    componentId: component.componentId,
    amount: jod('1000000'),
    effectiveFrom: '2025-01-01',
  });
};

interface ResultPage {
  readonly items: readonly {
    readonly payrollResultId: string;
    readonly gross: { readonly amountMinor: string };
    readonly net: { readonly amountMinor: string };
    readonly finalized: boolean;
  }[];
}

export const resultsOf = (wired: Wired, payrollRunId: string): Promise<ResultPage> =>
  ask<ResultPage>(wired, { queryName: 'payroll.results', payrollRunId });
