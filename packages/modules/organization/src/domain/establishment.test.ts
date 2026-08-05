import { describe, expect, it } from 'vitest';
import { DomainException } from '@work/kernel';

import {
  Establishment,
  establishmentTimeline,
  posture,
  type EstablishmentState,
} from './establishment.js';
import { OrganizationCalendar } from './organization-calendar.js';

const origin = { tenantId: 'tenant', correlationId: 'correlation', actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');

const set = (overrides: Partial<Parameters<typeof Establishment.set>[0]> = {}) =>
  Establishment.set(
    {
      tenantId: 'tenant',
      positionId: 'position',
      unitId: 'unit',
      budgetedHeadcount: 5,
      effectiveFrom: january,
      ...overrides,
    },
    origin,
    now,
  );

describe('an establishment line', () => {
  it('records a budgeted headcount, in draft until somebody approves it', () => {
    const line = set();

    expect(line.ok && line.value.budgetedHeadcount).toBe(5);
    expect(line.ok && line.value.currentStatus).toBe('draft');
  });

  it('accepts zero, which is how a position is budgeted out of a unit', () => {
    expect(set({ budgetedHeadcount: 0 }).ok).toBe(true);
  });

  it('refuses a negative or fractional headcount', () => {
    expect(set({ budgetedHeadcount: -1 }).ok).toBe(false);
    expect(set({ budgetedHeadcount: 2.5 }).ok).toBe(false);
  });

  it('refuses an implausible headcount rather than storing a typo as a budget', () => {
    const line = set({ budgetedHeadcount: 50_000_000 });

    expect(line.ok === false && line.error.reason).toBe('headcount_implausible');
  });

  it('records who approved it, so an approval is something somebody can be asked about', () => {
    const line = set();

    if (!line.ok) throw new Error('setup');
    line.value.pullEvents();
    const approved = line.value.approve('user:manager', origin, now);

    expect(approved.ok).toBe(true);
    expect(line.value.snapshot().approvedBy).toBe('user:manager');
    expect(line.value.snapshot().approvedAt).toEqual(now);
    expect(line.value.pullEvents()[0]?.eventName).toBe('organization.establishment.approved');
  });

  it('refuses a second approval', () => {
    const line = set();

    if (!line.ok) throw new Error('setup');
    line.value.approve('user:manager', origin, now);
    const again = line.value.approve('user:manager', origin, now);

    expect(again.ok === false && again.error.reason).toBe('establishment_not_draft');
  });
});

describe('the establishment timeline', () => {
  const period = (from: string, to: string | undefined, headcount: number): EstablishmentState => ({
    id: `line-${from}`,
    tenantId: 'tenant',
    positionId: 'position',
    unitId: 'unit',
    budgetedHeadcount: headcount,
    status: 'approved',
    effectiveFrom: new Date(from),
    ...(to === undefined ? {} : { effectiveTo: new Date(to) }),
    version: 1,
  });

  it("answers last year's budget with last year's number", () => {
    const periods = [period('2025-01-01', '2026-01-01', 3), period('2026-01-01', undefined, 8)];

    expect(establishmentTimeline(periods).at(new Date('2025-06-01'))?.value.budgetedHeadcount).toBe(
      3,
    );
    expect(establishmentTimeline(periods).at(new Date('2026-06-01'))?.value.budgetedHeadcount).toBe(
      8,
    );
  });

  it('refuses to hold two budgets in force at once', () => {
    const overlapping = [period('2025-01-01', '2026-06-01', 3), period('2026-01-01', undefined, 8)];

    expect(() => establishmentTimeline(overlapping)).toThrow(DomainException);
  });
});

describe('the approved, filled and vacant projection', () => {
  it('computes vacant from a filled count supplied by Employment, never counted here', () => {
    expect(posture(10, 4)).toEqual({ approved: 10, filled: 4, vacant: 6 });
  });

  it('reports zero vacancies rather than a negative one when a unit is over-established', () => {
    // Real: an approved reduction with people still in post. A negative vacancy is a number
    // nothing downstream expects, and it would render as "-2 vacancies" on a dashboard.
    expect(posture(3, 5)).toEqual({ approved: 3, filled: 5, vacant: 0 });
  });

  it('is arithmetic on an empty set until Employment exists, not a placeholder', () => {
    expect(posture(7, 0)).toEqual({ approved: 7, filled: 0, vacant: 7 });
  });
});

describe('an organizational calendar', () => {
  const define = (overrides: Partial<Parameters<typeof OrganizationCalendar.define>[0]> = {}) =>
    OrganizationCalendar.define(
      {
        tenantId: 'tenant',
        code: 'CORP',
        name: { en: 'Corporate calendar', ar: 'التقويم المؤسسي' },
        timeZone: 'Asia/Riyadh',
        workingDays: [7, 1, 2, 3, 4],
        effectiveFrom: january,
        ...overrides,
      },
      origin,
      now,
    );

  it('takes its working week from the tenant, with no default anywhere', () => {
    const calendar = define();

    // Sunday to Thursday, which is the working week in this product's first market — and which
    // arrives as data rather than as a constant in any file.
    expect(calendar.ok && calendar.value.workingDays).toEqual([1, 2, 3, 4, 7]);
    expect(calendar.ok && calendar.value.ordinarilyWorks(5)).toBe(false);
    expect(calendar.ok && calendar.value.ordinarilyWorks(7)).toBe(true);
  });

  it('accepts a Monday-to-Friday week just as readily', () => {
    const calendar = define({ workingDays: [1, 2, 3, 4, 5] });

    expect(calendar.ok && calendar.value.ordinarilyWorks(7)).toBe(false);
    expect(calendar.ok && calendar.value.ordinarilyWorks(5)).toBe(true);
  });

  it('refuses a week with no working days', () => {
    const calendar = define({ workingDays: [] });

    expect(calendar.ok === false && calendar.error.reason).toBe('working_week_empty');
  });

  it('accepts a seven-day week, because continuous operations exist', () => {
    expect(define({ workingDays: [1, 2, 3, 4, 5, 6, 7] }).ok).toBe(true);
  });

  it('refuses a day outside the week', () => {
    expect(define({ workingDays: [0, 1] }).ok).toBe(false);
    expect(define({ workingDays: [1, 8] }).ok).toBe(false);
  });

  it('refuses a time zone the platform does not know', () => {
    const calendar = define({ timeZone: 'Asia/Nowhere' });

    expect(calendar.ok === false && calendar.error.reason).toBe('time_zone_unknown');
  });

  it('records a day as a civil date, and refuses anything that is not one', () => {
    const calendar = define();

    if (!calendar.ok) throw new Error('setup');
    const day = calendar.value.recordDay(
      { onDate: '2027-03-20', kind: 'holiday', name: { en: 'Eid al-Fitr', ar: 'عيد الفطر' } },
      origin,
      now,
    );

    expect(day.ok && day.value.onDate).toBe('2027-03-20');
    expect(
      calendar.value.recordDay(
        { onDate: '20 March 2027', kind: 'holiday', name: { en: 'x', ar: 'س' } },
        origin,
        now,
      ).ok,
    ).toBe(false);
  });

  it('requires a day to be named in both languages, since it appears on a leave request', () => {
    const calendar = define();

    if (!calendar.ok) throw new Error('setup');
    expect(
      calendar.value.recordDay(
        { onDate: '2027-03-20', kind: 'holiday', name: { en: 'Eid al-Fitr' } },
        origin,
        now,
      ).ok,
    ).toBe(false);
  });
});
