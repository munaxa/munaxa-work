import { describe, expect, it } from 'vitest';

import { addDays, datesBetween, leaveYearFor, nextLeaveYear } from './leave-year.js';
import { LeaveType } from './leave-type.js';
import { LeavePolicy } from './leave-policy.js';
import { PERMITTED_TRANSITIONS, REQUEST_STATES, canTransition } from './leave-vocabulary.js';

/**
 * The rules: the state machine, the leave year, and the definitions everything else rests on.
 *
 * The arithmetic is the priority. A leave balance that is wrong by one day is indistinguishable
 * from one that is right, and nobody notices until somebody is refused leave they had.
 */

const TENANT = '00000000-0000-7000-8000-000000000001';
const AT = new Date('2026-06-15T09:00:00Z');

describe('the request state machine', () => {
  it('refuses every transition the table does not name', () => {
    for (const from of REQUEST_STATES) {
      for (const to of REQUEST_STATES) {
        expect(canTransition(from, to)).toBe(PERMITTED_TRANSITIONS[from].includes(to));
      }
    }
  });

  it('has no way out of a terminal state', () => {
    for (const terminal of ['closed', 'rejected', 'cancelled', 'withdrawn'] as const) {
      expect(PERMITTED_TRANSITIONS[terminal]).toHaveLength(0);
    }
  });
});

describe('the leave year', () => {
  it('runs from the configured start to the day before the next one', () => {
    const settings = {
      leaveYearCalendar: 'gregorian' as const,
      leaveYearStartMonth: 4,
      leaveYearStartDay: 1,
    };

    expect(leaveYearFor(settings, '2026-06-15')).toEqual({
      start: '2026-04-01',
      end: '2027-03-31',
    });
    expect(leaveYearFor(settings, '2026-03-31')).toEqual({
      start: '2025-04-01',
      end: '2026-03-31',
    });
  });

  it('leaves no date belonging to neither year', () => {
    const settings = {
      leaveYearCalendar: 'gregorian' as const,
      leaveYearStartMonth: 4,
      leaveYearStartDay: 1,
    };
    const year = leaveYearFor(settings, '2026-06-15');
    const next = nextLeaveYear(settings, year);

    expect(addDays(year.end, 1)).toBe(next.start);
  });

  /** A Hijri leave year resets on a different Gregorian date each year. That is the whole reason
   * the calendar is configuration rather than a display preference. */
  it('reckons a Hijri year through the kernel, and it is shorter than a Gregorian one', () => {
    const settings = {
      leaveYearCalendar: 'hijri' as const,
      leaveYearStartMonth: 1,
      leaveYearStartDay: 1,
    };
    const year = leaveYearFor(settings, '2026-06-15');
    const days = datesBetween(year.start, year.end).length;

    expect(year.start < '2026-06-15').toBe(true);
    expect(year.end >= '2026-06-15').toBe(true);
    expect(days).toBeGreaterThan(340);
    expect(days).toBeLessThan(360);
  });

  it('clamps rather than rolls a start day the month does not have', () => {
    const settings = {
      leaveYearCalendar: 'gregorian' as const,
      leaveYearStartMonth: 2,
      leaveYearStartDay: 31,
    };

    expect(leaveYearFor(settings, '2026-06-15').start).toBe('2026-02-28');
  });
});

describe('definitions', () => {
  it('ships no leave type and refuses one whose name is in a single language', () => {
    const result = LeaveType.define(
      {
        tenantId: TENANT,
        code: 'annual',
        name: { en: 'Annual leave', ar: '' },
        unit: 'days',
        paidTreatmentCode: 'full-pay',
      },
      AT,
    );

    expect(result.ok ? '' : result.error.reason).toBe('text_requires_both_languages');
  });

  it('refuses to change a published type, because entitlements name it', () => {
    const drafted = LeaveType.define(
      {
        tenantId: TENANT,
        code: 'annual',
        name: { en: 'Annual leave', ar: 'إجازة سنوية' },
        unit: 'days',
        paidTreatmentCode: 'full-pay',
      },
      AT,
    );

    if (!drafted.ok) throw new Error('The type should have drafted.');

    expect(drafted.value.publish('user:hr', AT).ok).toBe(true);
    expect(drafted.value.publish('user:hr', AT).ok).toBe(false);
  });

  /** Every threshold is inert until somebody sets it. A "sensible default" is how a statutory rule
   * creeps into a core module and becomes wrong in the second country. */
  it('creates a policy with nothing statutory in it', () => {
    const result = LeavePolicy.define(
      {
        tenantId: TENANT,
        leaveTypeId: 't',
        code: 'standard',
        name: { en: 'Standard', ar: 'قياسي' },
        effectiveFrom: '2026-01-01',
      },
      AT,
    );

    if (!result.ok) throw new Error(`Should have drafted: ${result.error.reason}`);

    const policy = result.value.snapshot();

    expect(policy.minimumServiceMonths).toBe(0);
    expect(policy.accrualMethod).toBe('none');
    expect(policy.accrualAmountMinutes).toBe(0);
    expect(policy.carryOverMethod).toBe('none');
    expect(policy.maximumPerYearMinutes).toBeUndefined();
    expect(policy.negativeBalanceLimitMinutes).toBeUndefined();
    expect(policy.selfApprovalPermitted).toBe(false);
  });

  it('refuses a capped carry-over with no cap, rather than carrying everything', () => {
    const result = LeavePolicy.define(
      {
        tenantId: TENANT,
        leaveTypeId: 't',
        code: 'standard',
        name: { en: 'Standard', ar: 'قياسي' },
        effectiveFrom: '2026-01-01',
        carryOver: { carryOverMethod: 'capped_minutes' },
      },
      AT,
    );

    expect(result.ok ? '' : result.error.reason).toBe('carry_over_cap_missing');
  });
});
