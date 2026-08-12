import { describe, expect, it } from 'vitest';

import {
  assign,
  cancelAssignment,
  isOverdue,
  satisfyAssignment,
  waiveAssignment,
  type AssignmentState,
} from './assignment.js';

/**
 * Being asked to learn something, and the four ways that ends.
 *
 * The case that matters most here is the one that is *not* a state: overdue-ness is derived from the
 * due date and today (ADR-0071), because nothing in this product moves a flag overnight and a flag
 * nothing moves is worse than no flag at all.
 */

const AT = new Date('2026-03-01T09:00:00.000Z');

const assigned = (over: Partial<Parameters<typeof assign>[0]> = {}): AssignmentState => {
  const result = assign({
    assignmentId: 'assignment-1',
    employmentId: 'employment-1',
    courseId: 'course-1',
    source: 'direct',
    dueOn: '2026-04-01',
    at: AT,
    by: 'user-manager',
    ...over,
  });

  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
};

const base = {
  assignmentId: 'assignment-2',
  employmentId: 'employment-1',
  courseId: 'course-1',
  at: AT,
  by: 'user-manager',
  source: 'direct',
} as const;

describe('assigning', () => {
  it('records why somebody was asked, so a queue of eleven things can be explained', () => {
    expect(assigned().source).toBe('direct');
    expect(assigned({ source: 'learning_path', pathId: 'path-1' }).pathId).toBe('path-1');
  });

  it('refuses a provenance it cannot back up', () => {
    expect(assign({ ...base, source: 'mandatory_rule' }).ok).toBe(false);
    expect(assign({ ...base, source: 'learning_path' }).ok).toBe(false);
  });

  it('refuses a due date or an occurrence key that is not a civil date', () => {
    expect(assign({ ...base, dueOn: '01/04/2026' }).ok).toBe(false);
    expect(assign({ ...base, occurrenceKey: 'occurrence-4' }).ok).toBe(false);
  });

  it('carries the occurrence key that makes a second reconciliation run create nothing', () => {
    const state = assigned({
      source: 'mandatory_rule',
      mandatoryRuleId: 'rule-1',
      occurrenceKey: '2026-03-01',
    });

    expect(state.occurrenceKey).toBe('2026-03-01');
  });
});

describe('overdue, derived and never stored', () => {
  it('is not a status this module keeps', () => {
    expect(Object.keys(assigned())).not.toContain('overdue');
  });

  it('is true only for an open assignment whose day has passed', () => {
    expect(isOverdue(assigned(), '2026-04-01')).toBe(false);
    expect(isOverdue(assigned(), '2026-04-02')).toBe(true);
  });

  it('is never true for something already done, waived or cancelled', () => {
    const satisfied = satisfyAssignment(assigned(), { at: AT, enrolmentId: 'enrolment-1' });
    const waived = waiveAssignment(assigned(), AT, 'user-admin', 'On long-term leave');

    if (!satisfied.ok || !waived.ok) throw new Error('expected both to succeed');
    expect(isOverdue(satisfied.value, '2027-01-01')).toBe(false);
    expect(isOverdue(waived.value, '2027-01-01')).toBe(false);
  });

  it('is never true where no date was ever set', () => {
    expect(isOverdue({ status: 'assigned' }, '2099-01-01')).toBe(false);
  });
});

describe('ending an assignment', () => {
  it('refuses to close one with no evidence that anything was done', () => {
    const empty = satisfyAssignment(assigned(), { at: AT });

    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.reason).toBe('assignment-satisfaction-requires-evidence');
  });

  it('accepts a certification somebody already held, without sending them on the course', () => {
    const satisfied = satisfyAssignment(assigned(), {
      at: AT,
      certificationId: 'certification-7',
    });

    expect(satisfied.ok).toBe(true);
    if (!satisfied.ok) return;
    expect(satisfied.value.satisfiedByCertificationId).toBe('certification-7');
    expect(satisfied.value.satisfiedByEnrolmentId).toBeUndefined();
  });

  it('demands a written reason and a named human before excusing anybody', () => {
    expect(waiveAssignment(assigned(), AT, 'user-admin', '  ').ok).toBe(false);
    expect(waiveAssignment(assigned(), AT, 'system:auto-approval', 'Exempt').ok).toBe(false);

    const waived = waiveAssignment(assigned(), AT, 'user-admin', 'Holds an equivalent licence');

    expect(waived.ok).toBe(true);
    if (waived.ok) expect(waived.value.waivedBy).toBe('user-admin');
  });

  it('makes every ending terminal, so a satisfied requirement cannot quietly reopen', () => {
    const satisfied = satisfyAssignment(assigned(), { at: AT, enrolmentId: 'enrolment-1' });

    if (!satisfied.ok) throw new Error(satisfied.error.reason);
    expect(waiveAssignment(satisfied.value, AT, 'user-admin', 'Exempt').ok).toBe(false);
    expect(cancelAssignment(satisfied.value, AT, 'user-admin').ok).toBe(false);
    expect(satisfyAssignment(satisfied.value, { at: AT, enrolmentId: 'enrolment-2' }).ok).toBe(
      false,
    );
  });

  it('cancels a requirement that never applied, keeping it apart from one that was waived', () => {
    const cancelled = cancelAssignment(assigned(), AT, 'user-admin');

    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.value.status).toBe('cancelled');
  });
});
