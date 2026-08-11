import { describe, expect, it } from 'vitest';

import { Employment } from './employment.js';
import {
  EMPLOYMENT_STATUSES,
  PERMITTED_TRANSITIONS,
  canTransition,
} from './employment-vocabulary.js';
import { employmentNumberFrom, isEmploymentNumber, seriesKeyFor } from './employment-number.js';

const origin = {
  tenantId: '01920000-0000-7000-8000-0000000000aa',
  correlationId: 'test',
  actor: 'user:test',
};
const NOW = new Date('2026-08-09T09:00:00Z');

const anEmployment = (overrides: Record<string, unknown> = {}) =>
  Employment.create(
    {
      tenantId: origin.tenantId,
      personId: '01920000-0000-7000-8000-0000000000bb',
      employmentNumber: 'EMP-2026-000001',
      employmentTypeCode: 'full-time',
      startDate: '2026-01-15',
      ...overrides,
    },
    origin,
    NOW,
  );

/** The aggregate rehydrated at the version a repository would have written. */
const activated = () => {
  const created = anEmployment();

  if (!created.ok) throw new Error('fixture');
  created.value.transitionTo('active', undefined, origin, NOW);
  return created.value;
};

describe('Employment', () => {
  describe('creation', () => {
    it('starts as a draft, so a prepared hire and a live one are different things', () => {
      const created = anEmployment();

      expect(created.ok).toBe(true);
      if (created.ok) expect(created.value.status).toBe('draft');
    });

    it('defaults the original hire date to the start date', () => {
      const created = anEmployment();

      if (!created.ok) throw new Error('expected a created employment');
      expect(created.value.originalHireDate).toBe('2026-01-15');
    });

    it('keeps an earlier original hire date, so a rehire does not reset accrued service', () => {
      const created = anEmployment({ originalHireDate: '2019-04-01' });

      if (!created.ok) throw new Error('expected a created employment');
      expect(created.value.originalHireDate).toBe('2019-04-01');
      expect(created.value.startDate).toBe('2026-01-15');
    });

    it('refuses an original hire date after the start date — a transposition, not a rehire', () => {
      const created = anEmployment({ originalHireDate: '2027-04-01' });

      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.reason).toBe('hire_after_start');
    });

    it('refuses a number of the wrong shape, so a hand-written row is not adopted silently', () => {
      const created = anEmployment({ employmentNumber: '4471' });

      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.reason).toBe('employment_number_malformed');
    });

    it('refuses a malformed date rather than parsing it into an instant', () => {
      const created = anEmployment({ startDate: '15/01/2026' });

      expect(created.ok).toBe(false);
      if (!created.ok) expect(created.error.reason).toBe('date_malformed');
    });

    it('raises a created event naming the employment and the person, and no personal data', () => {
      const created = anEmployment();

      if (!created.ok) throw new Error('expected a created employment');

      const [event] = created.value.pullEvents();

      expect(event?.eventName).toBe('employment.employment.created');
      expect(JSON.stringify(event?.payload)).not.toContain('EMP-2026');
    });
  });

  describe('the status machine', () => {
    /**
     * Every pair, permitted and refused, rather than the handful somebody thought of. The machine
     * is data, so the test can be exhaustive — which is the whole reason it is data.
     */
    it.each(EMPLOYMENT_STATUSES)('has an explicit transition set from %s', (from) => {
      expect(PERMITTED_TRANSITIONS[from]).toBeDefined();
    });

    it('permits every pair the table names and refuses every pair it does not', () => {
      for (const from of EMPLOYMENT_STATUSES) {
        for (const to of EMPLOYMENT_STATUSES) {
          expect(canTransition(from, to)).toBe(PERMITTED_TRANSITIONS[from].includes(to));
        }
      }
    });

    it('lets nothing leave ended: a terminal state that reopens is not terminal', () => {
      for (const to of EMPLOYMENT_STATUSES) {
        expect(canTransition('ended', to)).toBe(false);
      }
    });

    it('activates a draft without forcing a pointless approval hop', () => {
      const created = anEmployment();

      if (!created.ok) throw new Error('fixture');

      const moved = created.value.transitionTo('active', undefined, origin, NOW);

      expect(moved.ok).toBe(true);
      expect(created.value.status).toBe('active');
    });

    it('raises a named activation event as well as the generic one', () => {
      const employment = activated();
      const names = employment.pullEvents().map((event) => event.eventName);

      expect(names).toContain('employment.employment.status-changed');
      expect(names).toContain('employment.employment.activated');
    });

    it('refuses a transition the table does not permit, naming both ends', () => {
      const created = anEmployment();

      if (!created.ok) throw new Error('fixture');

      const moved = created.value.transitionTo('suspended', undefined, origin, NOW);

      expect(moved.ok).toBe(false);
      if (!moved.ok) {
        expect(moved.error.reason).toBe('transition_not_permitted');
        expect(moved.error.values).toEqual({ from: 'draft', to: 'suspended' });
      }
    });

    it('refuses a move to the status it is already in', () => {
      const employment = activated();
      const moved = employment.transitionTo('active', undefined, origin, NOW);

      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.error.reason).toBe('employment_already_in_status');
    });

    it('refuses to reach ended through the generic transition, which carries no date or reason', () => {
      const employment = activated();
      const moved = employment.transitionTo('ended', undefined, origin, NOW);

      expect(moved.ok).toBe(false);
      if (!moved.ok) expect(moved.error.reason).toBe('ending_needs_a_date_and_a_reason');
    });

    it('suspends and reinstates, because a suspended employee is still employed', () => {
      const employment = activated();

      expect(employment.transitionTo('suspended', 'investigation', origin, NOW).ok).toBe(true);
      expect(employment.transitionTo('active', undefined, origin, NOW).ok).toBe(true);
      expect(employment.status).toBe('active');
    });
  });

  describe('ending', () => {
    it('records the date and the reason together, and becomes terminal', () => {
      const employment = activated();
      const ended = employment.end(
        { endDate: '2026-09-30', endReasonCode: 'resignation' },
        origin,
        NOW,
      );

      expect(ended.ok).toBe(true);
      expect(employment.status).toBe('ended');
      expect(employment.snapshot().endDate).toBe('2026-09-30');
      expect(employment.snapshot().endReasonCode).toBe('resignation');
    });

    it('raises a named ended event, which is what final settlement reads', () => {
      const employment = activated();

      employment.pullEvents();
      employment.end({ endDate: '2026-09-30', endReasonCode: 'resignation' }, origin, NOW);

      const names = employment.pullEvents().map((event) => event.eventName);

      expect(names).toContain('employment.employment.ended');
      expect(names).toContain('employment.employment.status-changed');
    });

    it('refuses an end date before the employment began', () => {
      const employment = activated();
      const ended = employment.end(
        { endDate: '2025-12-31', endReasonCode: 'resignation' },
        origin,
        NOW,
      );

      expect(ended.ok).toBe(false);
      if (!ended.ok) expect(ended.error.reason).toBe('end_before_start');
    });

    it('refuses a second ending, so a settlement cannot be re-dated', () => {
      const employment = activated();

      employment.end({ endDate: '2026-09-30', endReasonCode: 'resignation' }, origin, NOW);

      const again = employment.end(
        { endDate: '2026-10-31', endReasonCode: 'dismissal' },
        origin,
        NOW,
      );

      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.error.reason).toBe('employment_already_ended');
    });

    it('takes the reason as a code, never interpreting what the code means', () => {
      const employment = activated();
      const ended = employment.end(
        { endDate: '2026-09-30', endReasonCode: 'article-80-dismissal' },
        origin,
        NOW,
      );

      expect(ended.ok).toBe(true);
      expect(employment.snapshot().endReasonCode).toBe('article-80-dismissal');
    });
  });

  describe('amendment', () => {
    it('corrects a start date while the employment is still a draft', () => {
      const created = anEmployment();

      if (!created.ok) throw new Error('fixture');

      const amended = created.value.amend({ startDate: '2026-02-01' }, origin, NOW);

      expect(amended.ok).toBe(true);
      expect(created.value.startDate).toBe('2026-02-01');
    });

    it('refuses to move an active employment’s start date, which other records depend on', () => {
      const employment = activated();
      const amended = employment.amend({ startDate: '2026-02-01' }, origin, NOW);

      expect(amended.ok).toBe(false);
      if (!amended.ok) expect(amended.error.reason).toBe('start_date_is_in_force');
    });

    it('refuses any amendment to an ended employment', () => {
      const employment = activated();

      employment.end({ endDate: '2026-09-30', endReasonCode: 'resignation' }, origin, NOW);

      const amended = employment.amend({ employmentTypeCode: 'part-time' }, origin, NOW);

      expect(amended.ok).toBe(false);
      if (!amended.ok) expect(amended.error.reason).toBe('employment_ended');
    });
  });
});

describe('the employment number', () => {
  it('formats a counter into the documented shape', () => {
    expect(employmentNumberFrom('2026', 1)).toBe('EMP-2026-000001');
    expect(employmentNumberFrom('2026', 123)).toBe('EMP-2026-000123');
  });

  it('widens past the sixth digit rather than wrapping, because a reused number resolves twice', () => {
    expect(employmentNumberFrom('2026', 1_000_000)).toBe('EMP-2026-1000000');
    expect(isEmploymentNumber(employmentNumberFrom('2026', 1_000_000))).toBe(true);
  });

  it('draws its series from the year the employment starts, so the number means what it reads', () => {
    expect(seriesKeyFor('2026-01-15')).toBe('2026');
    expect(seriesKeyFor('2019-12-31')).toBe('2019');
  });

  it('rejects anything that is not a generated number', () => {
    expect(isEmploymentNumber('4471')).toBe(false);
    expect(isEmploymentNumber('EMP-26-000001')).toBe(false);
    expect(isEmploymentNumber('EMP-2026-0001')).toBe(false);
  });
});
