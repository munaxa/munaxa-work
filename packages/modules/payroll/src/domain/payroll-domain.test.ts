import { describe, expect, it } from 'vitest';

import {
  CALCULATION_VERSION,
  calculateEmployment,
  resultInvariants,
} from './payroll-calculation.js';
import { allocated, checkedMoney, moneyView } from './money-amount.js';
import {
  createPayrollPeriod,
  inclusiveDays,
  movePeriodTo,
  overlappingDays,
} from './payroll-period.js';
import { definePayrollGroup } from './payroll-group.js';
import { snapshotBlockers, snapshotDigest } from './payroll-snapshot.js';
import { EARNING_SOURCES } from './payroll-vocabulary.js';
import { aRequest, aSnapshot, jod, onlyResult } from './payroll-fixtures.js';

/**
 * The domain, tested where it decides things.
 *
 * The assertions worth reading are the ones about what the module **refuses**: an overtime line it
 * will not produce, a currency it will not convert, a negative net it will not pay, a self-approval
 * it will not record, and a total it will not compute across two currencies.
 */

describe('money', () => {
  it('keeps a salary exact above 2^53, where a JavaScript number cannot', () => {
    // 9,007,199,254,740,993 minor units — one past the largest integer a double represents.
    const large = checkedMoney(
      { amountMinor: '9007199254740993', currencyCode: 'JOD', currencyExponent: 3 },
      'amount',
    );

    expect(large.ok).toBe(true);
    if (!large.ok) return;
    expect(large.value.amountMinor).toBe(9_007_199_254_740_993n);
    expect(moneyView(large.value).amountMinor).toBe('9007199254740993');
    // The decimal rendering is exact too — the point where a Number() would round.
    expect(moneyView(large.value).amount).toBe('9007199254740.993');
  });

  it('refuses a malformed amount rather than reading it as zero', () => {
    // BigInt('') is 0n, which is the quiet wrong answer this exists to prevent.
    for (const amountMinor of ['', ' ', '1.5', '1e3', 'abc']) {
      expect(
        checkedMoney({ amountMinor, currencyCode: 'JOD', currencyExponent: 3 }, 'amount').ok,
      ).toBe(false);
    }
  });

  it('splits an amount by weights so the parts sum back exactly', () => {
    // 100.000 JOD split 1/3 : 2/3 cannot divide evenly. The remainder is distributed, not lost.
    const split = allocated(
      { amountMinor: 100_000n, currencyCode: 'JOD', currencyExponent: 3 },
      [3_333, 6_667],
    );

    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.value.reduce((total, part) => total + part.amountMinor, 0n)).toBe(100_000n);
  });
});

describe('payroll group', () => {
  it('requires at least one permitted currency and its exponent', () => {
    expect(definePayrollGroup({ ...aGroup(), permittedCurrencies: [] }).ok).toBe(false);
    expect(
      definePayrollGroup({
        ...aGroup(),
        permittedCurrencies: [{ code: 'JOD', exponent: 9 }],
      }).ok,
    ).toBe(false);
  });

  it('accepts a single-character code, because a payroll group may be named "a"', () => {
    expect(definePayrollGroup({ ...aGroup(), code: 'a' }).ok).toBe(true);
  });
});

const aGroup = () => ({
  payrollGroupId: 'group',
  legalEntityId: 'entity',
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

describe('payroll period', () => {
  it('refuses a period that ends before it starts', () => {
    const refused = createPayrollPeriod({
      payrollPeriodId: 'period',
      payrollGroupId: 'group',
      code: '2026-06',
      periodStart: '2026-06-30',
      periodEnd: '2026-06-01',
      paymentDate: '2026-07-05',
    });

    expect(refused.ok).toBe(false);
  });

  it('permits a payment date outside the period, because June is paid in July', () => {
    expect(
      createPayrollPeriod({
        payrollPeriodId: 'period',
        payrollGroupId: 'group',
        code: '2026-06',
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        paymentDate: '2026-07-05',
      }).ok,
    ).toBe(true);
  });

  it('names both ends when a transition is refused', () => {
    const period = createPayrollPeriod({
      payrollPeriodId: 'period',
      payrollGroupId: 'group',
      code: '2026-06',
      periodStart: '2026-06-01',
      periodEnd: '2026-06-30',
      paymentDate: '2026-07-05',
    });

    expect(period.ok).toBe(true);
    if (!period.ok) return;

    const refused = movePeriodTo(period.value, 'finalized', new Date(), 'user:a', 1);

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.detail).toEqual({ from: 'draft', to: 'finalized' });
  });

  it('counts inclusive days, so June is thirty and February 2028 is twenty-nine', () => {
    expect(inclusiveDays('2026-06-01', '2026-06-30')).toBe(30);
    expect(inclusiveDays('2028-02-01', '2028-02-29')).toBe(29);
    expect(
      overlappingDays(
        { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        '2026-06-10',
        undefined,
      ),
    ).toBe(21);
    // Ranges that do not meet contribute nothing, which is an answer rather than an error.
    expect(
      overlappingDays(
        { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
        '2026-07-01',
        '2026-07-31',
      ),
    ).toBe(0);
  });
});

describe('calculation', () => {
  it('pays a full month with no proration and no explanation nobody asked for', () => {
    const outcome = calculateEmployment(aRequest());

    expect(outcome.ok).toBe(true);
    const result = onlyResult(outcome);

    expect(result?.gross.amountMinor).toBe(1_000_000n);
    expect(result?.net.amountMinor).toBe(1_000_000n);
    expect(result?.earnings[0]?.calculationReason).toBe('full_period');
    // No proration happened, so no fraction is recorded. A 30/30 would imply a calculation.
    expect(result?.earnings[0]?.detail.numerator).toBeUndefined();
    expect(result?.calculationVersion).toBe(CALCULATION_VERSION);
  });

  it('prorates a mid-period hire and records the fraction that produced the figure', () => {
    // Hired on the tenth of a thirty-day month: twenty-one days present.
    const outcome = calculateEmployment(aRequest({ employment: { startDate: '2026-06-10' } }));
    const result = onlyResult(outcome);
    const line = result?.earnings[0];

    expect(line?.amount.amountMinor).toBe(700_000n);
    expect(line?.detail.numerator).toBe(21);
    expect(line?.detail.denominator).toBe(30);
    expect(line?.detail.prorationCause).toBe('hired_mid_period');
    expect(line?.detail.basisAmountMinor).toBe('1000000');
    // The rounding mode that produced it, on the line rather than in a policy nobody can see.
    expect(line?.detail.roundingMode).toBe('half-up');
  });

  it('does not prorate a component the entitlement marked non-proratable', () => {
    const outcome = calculateEmployment(
      aRequest({
        employment: { startDate: '2026-06-10' },
        components: [{ proratable: false }],
      }),
    );

    expect(onlyResult(outcome)?.gross.amountMinor).toBe(1_000_000n);
  });

  it('deducts unpaid absence against the already-prorated gross, as its own line', () => {
    const outcome = calculateEmployment(aRequest({ attendance: { unpaidMinutes: 2 * 1_440 } }));
    const result = onlyResult(outcome);

    // Two days of a thirty-day month, from a gross of 1000.000.
    expect(result?.deductions[0]?.deductionSource).toBe('unpaid_leave');
    expect(result?.deductions[0]?.amount.amountMinor).toBe(66_667n);
    expect(result?.net.amountMinor).toBe(1_000_000n - 66_667n);
    // Presence and absence stay separate lines; neither is blended into the other.
    expect(result?.earnings).toHaveLength(1);
  });

  it('keeps two currencies apart and produces no total across them', () => {
    const outcome = calculateEmployment(aRequest({ secondCurrency: true }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.results).toHaveLength(2);

    const currencies = outcome.value.results.map((result) => result.currencyCode).sort();

    expect(currencies).toEqual(['JOD', 'USD']);
    // Two gross figures, two nets, and every line in the currency of its own result.
    expect(outcome.value.results.map((result) => result.gross.amountMinor)).toEqual([
      1_000_000n,
      50_000n,
    ]);
    expect(outcome.value.results.flatMap(resultInvariants)).toEqual([]);
  });

  it('refuses a currency the group does not permit rather than converting it', () => {
    const outcome = calculateEmployment(
      aRequest({ secondCurrency: true, permittedCurrencies: ['JOD'] }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.results).toHaveLength(1);
    expect(outcome.value.exceptions).toContainEqual({
      code: 'currency_not_permitted',
      detail: { currencyCode: 'USD' },
    });
  });

  it('records an exception rather than a result of zero when compensation is missing', () => {
    const outcome = calculateEmployment(aRequest({ withoutCompensation: true }));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.results).toHaveLength(0);
    expect(outcome.value.exceptions).toContainEqual({ code: 'compensation_missing' });
  });

  it('refuses to pay against attendance Attendance itself distrusts', () => {
    expect(snapshotBlockers(aSnapshot({ attendance: { blockingExceptions: 2 } }))).toContain(
      'attendance_blocking_exceptions',
    );
    // "Leave unknown" is not "no leave" (ADR-0056): an unknown state blocks rather than pays.
    expect(snapshotBlockers(aSnapshot({ attendance: { leaveState: 'unknown' } }))).toContain(
      'attendance_leave_state_unknown',
    );
  });

  it('records an exception rather than paying a negative net', () => {
    const outcome = calculateEmployment(
      aRequest({
        definitions: [
          {
            deductionDefinitionId: 'd1',
            payrollGroupId: 'group',
            code: 'excessive',
            name: { en: 'Excessive', ar: 'مفرط' },
            deductionSource: 'voluntary' as const,
            payrollTreatmentCode: 'voluntary',
            basis: 'fixed_amount' as const,
            fixedAmount: jod(2_000_000n),
            roundingMode: 'half-up' as const,
            priority: 50,
            active: true,
            version: 1,
          },
        ],
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.results).toHaveLength(0);
    expect(outcome.value.exceptions).toContainEqual({ code: 'net_would_be_negative' });
  });

  it('is reproducible: the same snapshot gives the same figures and the same digest', () => {
    const request = aRequest();
    const first = calculateEmployment(request);
    const second = calculateEmployment(request);

    expect(JSON.stringify(first, replacer)).toBe(JSON.stringify(second, replacer));
    expect(snapshotDigest(request.snapshot)).toBe(snapshotDigest(request.snapshot));
  });

  it('holds its invariants: gross is its lines, net is gross less deductions', () => {
    const result = onlyResult(
      calculateEmployment(aRequest({ attendance: { unpaidMinutes: 1_440 } })),
    );

    expect(result).toBeDefined();
    if (result === undefined) return;
    expect(resultInvariants(result)).toEqual([]);
  });
});

/**
 * **The overtime assertion.**
 *
 * Attendance publishes candidate minutes by design (ADR-0054) and no approved overtime result
 * exists. A payroll group cannot configure its way past that: a candidate is not an approved fact,
 * and a flag that promoted one would make Payroll the approver while the audit trail still named
 * Attendance (ADR-0065).
 *
 * The classification ships so the eventual contract needs no migration of historical lines. This is
 * the test that stops it becoming reachable by accident.
 */
describe('overtime', () => {
  it('produces no earning from candidate minutes, however many there are', () => {
    const outcome = calculateEmployment(
      aRequest({ attendance: { overtimeCandidateMinutes: 40 * 60 } }),
    );
    const result = onlyResult(outcome);

    expect(result?.earnings.every((line) => line.earningSource !== 'attendance_overtime')).toBe(
      true,
    );
    expect(result?.gross.amountMinor).toBe(1_000_000n);
  });

  it('declares the classification without reaching it', () => {
    expect(EARNING_SOURCES).toContain('attendance_overtime');
  });
});

/** `bigint` has no JSON representation, so reproducibility is compared over strings. */
const replacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value;
