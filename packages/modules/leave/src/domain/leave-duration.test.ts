import { describe, expect, it } from 'vitest';

import { accrue } from './accrual.js';
import { carryOverExpiresOn, carryOverFor, expiringMinutes } from './carry-over.js';
import { breakdownOf } from './duration.js';
import type { AccrualSettings, CarryOverSettings } from './leave-policy-settings.js';

/**
 * How long a request is, how much a period accrues, and what survives a year end.
 *
 * The three pieces of pure arithmetic this module's figures rest on. Each is tested against a table
 * of cases rather than against a running system, which is what makes an accrual reproducible in
 * 2029 and a disputed balance answerable.
 */

describe('duration', () => {
  const workingWeek = ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'].map((onDate) => ({
    onDate,
    expected: true,
    expectedMinutes: 480,
    zone: 'Asia/Amman',
    dayKind: 'working',
  }));

  it('gives a working-days request no row for a date nothing was expected on', () => {
    const result = breakdownOf({
      fromDate: '2026-06-15',
      toDate: '2026-06-19',
      basis: 'working_days',
      expectations: workingWeek,
      portions: [],
      halfDayPermitted: true,
      hourlyPermitted: true,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.value.days : []).toHaveLength(4);
    expect(result.ok ? result.value.totalMinutes : 0).toBe(1920);
    // The excluded date is visible rather than absorbed into a smaller total.
    expect(result.ok ? result.value.excluded.map((one) => one.onDate) : []).toEqual(['2026-06-19']);
  });

  /** Floor and remainder, so two halves sum to exactly the day. Rounding both would create six
   * minutes of leave nobody granted, once per odd-length day, for ever. */
  it('splits an odd-length day into halves that sum to the whole day', () => {
    const odd = [
      {
        onDate: '2026-06-15',
        expected: true,
        expectedMinutes: 405,
        zone: 'UTC',
        dayKind: 'working',
      },
    ];
    const first = breakdownOf({
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      basis: 'working_days',
      expectations: odd,
      portions: [{ onDate: '2026-06-15', portion: 'first_half' }],
      halfDayPermitted: true,
      hourlyPermitted: false,
    });
    const second = breakdownOf({
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      basis: 'working_days',
      expectations: odd,
      portions: [{ onDate: '2026-06-15', portion: 'second_half' }],
      halfDayPermitted: true,
      hourlyPermitted: false,
    });

    expect(first.ok ? first.value.totalMinutes : 0).toBe(202);
    expect(second.ok ? second.value.totalMinutes : 0).toBe(203);
    expect(
      (first.ok ? first.value.totalMinutes : 0) + (second.ok ? second.value.totalMinutes : 0),
    ).toBe(405);
  });

  it('refuses cross-midnight hourly leave by name rather than wrapping it', () => {
    const result = breakdownOf({
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      basis: 'working_days',
      expectations: workingWeek,
      portions: [
        { onDate: '2026-06-15', portion: 'hours', startLocal: '22:00', endLocal: '02:00' },
      ],
      halfDayPermitted: true,
      hourlyPermitted: true,
    });

    expect(result.ok ? '' : result.error.reason).toBe('hourly_leave_crosses_midnight');
  });

  it('refuses a half day where the policy does not permit one', () => {
    const result = breakdownOf({
      fromDate: '2026-06-15',
      toDate: '2026-06-15',
      basis: 'working_days',
      expectations: workingWeek,
      portions: [{ onDate: '2026-06-15', portion: 'first_half' }],
      halfDayPermitted: false,
      hourlyPermitted: false,
    });

    expect(result.ok ? '' : result.error.reason).toBe('half_day_not_permitted');
  });

  /** No default working day exists in this product, and inventing eight hours would be a
   * labour-relations decision for a customer who never asked. */
  it('refuses calendar days with no basis for a day length rather than assuming one', () => {
    const result = breakdownOf({
      fromDate: '2026-06-20',
      toDate: '2026-06-21',
      basis: 'calendar_days',
      expectations: [],
      portions: [],
      halfDayPermitted: false,
      hourlyPermitted: false,
    });

    expect(result.ok ? '' : result.error.reason).toBe('request_covers_no_working_date');
  });

  it('counts every date under the calendar basis when a day length is known', () => {
    const result = breakdownOf({
      fromDate: '2026-06-20',
      toDate: '2026-06-21',
      basis: 'calendar_days',
      expectations: [],
      portions: [],
      standardDayMinutes: 480,
      halfDayPermitted: false,
      hourlyPermitted: false,
    });

    expect(result.ok ? result.value.days : []).toHaveLength(2);
    expect(result.ok ? result.value.totalMinutes : 0).toBe(960);
  });
});

describe('accrual', () => {
  const monthly: AccrualSettings = {
    accrualMethod: 'monthly',
    accrualAmountMinutes: 840,
    prorationBasis: 'none',
  };

  it('grants nothing where the policy accrues nothing — the default', () => {
    const result = accrue(
      { accrualMethod: 'none', accrualAmountMinutes: 0, prorationBasis: 'none' },
      {
        employmentStartDate: '2020-01-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        leaveYearStart: '2026-01-01',
        leaveYearEnd: '2026-12-31',
      },
    );

    expect(result.ok ? result.value.minutes : -1).toBe(0);
  });

  it('multiplies the configured amount by the whole periods the range contains', () => {
    const result = accrue(monthly, {
      employmentStartDate: '2020-01-01',
      periodStart: '2026-01-01',
      periodEnd: '2026-03-31',
      leaveYearStart: '2026-01-01',
      leaveYearEnd: '2026-12-31',
    });

    expect(result.ok ? result.value.periods : 0).toBe(3);
    expect(result.ok ? result.value.minutes : 0).toBe(2520);
  });

  /** A mid-period joiner accrues the part of the period they were there for. Getting this wrong
   * over-grants on somebody's first day. */
  it('prorates a mid-period joiner by hire date, in integer arithmetic throughout', () => {
    const result = accrue(
      { ...monthly, accrualMethod: 'annual', prorationBasis: 'hire_date' },
      {
        employmentStartDate: '2026-07-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        leaveYearStart: '2026-01-01',
        leaveYearEnd: '2026-12-31',
      },
    );

    expect(result.ok).toBe(true);
    // 184 of 365 days, floored, applied to 840 minutes.
    expect(result.ok ? result.value.minutes : 0).toBe(423);
    expect(Number.isInteger(result.ok ? result.value.minutes : 0)).toBe(true);
  });

  it('refuses an employment no service band covers, rather than granting zero', () => {
    const result = accrue(
      { accrualMethod: 'service_band', accrualAmountMinutes: 0, prorationBasis: 'none' },
      {
        employmentStartDate: '2020-01-01',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
        leaveYearStart: '2026-01-01',
        leaveYearEnd: '2026-12-31',
      },
    );

    expect(result.ok ? '' : result.error.reason).toBe('accrual_band_did_not_match');
  });
});

describe('carry-over', () => {
  const capped = (settings: Partial<CarryOverSettings>): CarryOverSettings => ({
    carryOverMethod: 'none',
    ...settings,
  });

  it('carries nothing by default, because most leave types do not', () => {
    const result = carryOverFor(capped({}), 4800);

    expect(result.ok ? result.value.carriedInMinutes : -1).toBe(0);
    expect(result.ok ? result.value.lapsedMinutes : 0).toBe(4800);
  });

  it('caps by minutes and reports what lapsed', () => {
    const result = carryOverFor(
      capped({ carryOverMethod: 'capped_minutes', carryOverCapMinutes: 2400 }),
      4800,
    );

    expect(result.ok ? result.value.carriedInMinutes : 0).toBe(2400);
    expect(result.ok ? result.value.lapsedMinutes : 0).toBe(2400);
  });

  it('caps by a percentage of what remains, in integer arithmetic', () => {
    const result = carryOverFor(
      capped({ carryOverMethod: 'capped_percent', carryOverCapPercent: 25 }),
      4805,
    );

    expect(result.ok ? result.value.carriedInMinutes : 0).toBe(1201);
  });

  /** A policy that permitted a deficit once does not thereby carry it forward for ever. */
  it('carries nothing from a negative balance', () => {
    const result = carryOverFor(capped({ carryOverMethod: 'unlimited' }), -480);

    expect(result.ok ? result.value.carriedOutMinutes : -1).toBe(0);
  });

  it('clamps an expiry date to the target month rather than rolling into the next', () => {
    expect(carryOverExpiresOn(capped({ carryOverExpiryMonths: 3 }), '2026-11-30')).toBe(
      '2027-02-28',
    );
  });

  it('expires only what was carried in, never what was accrued since', () => {
    expect(expiringMinutes(2400, 960)).toBe(1440);
    expect(expiringMinutes(2400, 3000)).toBe(0);
  });
});
