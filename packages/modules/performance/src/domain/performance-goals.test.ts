import { describe, expect, it } from 'vitest';
import { approveGoal, closeGoal, createGoal, goalWeightsSatisfy, moveGoal } from './goal.js';
import {
  acceptsAssessments,
  cancelCycle,
  closeCycle,
  createCycle,
  moveCycle,
  overdue,
} from './cycle.js';

/**
 * Goals and cycles.
 *
 * The two rules worth reading for: a cancelled goal carries no score at all (the sixth approved
 * scoring decision, enforced by the aggregate as well as by the engine), and overdue is a *question*
 * rather than an event, because nothing in this repository notices a date passing.
 */

const NAME = { en: 'Annual', ar: 'سنوي' };

const day = (iso: string): Date => new Date(iso);

describe('goals', () => {
  const request = {
    goalId: 'goal-1',
    scope: 'individual',
    employmentId: 'employment-1',
    title: 'Reduce onboarding time to ten days',
    measurement: 'numeric',
    weightBasisPoints: 5000,
    startDate: day('2026-01-01'),
    dueDate: day('2026-12-31'),
  };

  it('refuses an owner that does not match the scope', () => {
    const corporate = createGoal({ ...request, scope: 'corporate' });

    expect(corporate.ok).toBe(false);
    if (!corporate.ok) expect(corporate.error.reason).toBe('goal-owner-mismatch');

    const department = createGoal({ ...request, scope: 'department' });

    expect(department.ok).toBe(false);
  });

  it('takes a named human’s approval and refuses the auto-approver', () => {
    const created = createGoal(request);

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(approveGoal(created.value, 'system:auto-approval', day('2026-02-01')).ok).toBe(false);

    const approved = approveGoal(created.value, 'user:manager', day('2026-02-01'));

    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    expect(approved.value.status).toBe('approved');
    expect(approved.value.approvedBy).toBe('user:manager');
  });

  it('refuses a score on a cancelled goal, and requires one on a closed goal', () => {
    const created = createGoal(request);

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const active = moveGoal(created.value, 'approved');

    expect(active.ok).toBe(true);
    if (!active.ok) return;

    const running = moveGoal(active.value, 'active');

    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const scoredCancellation = closeGoal(running.value, {
      outcome: 'cancelled',
      finalScore: 400,
      closedAt: day('2026-06-01'),
      closedBy: 'user:manager',
    });

    expect(scoredCancellation.ok).toBe(false);
    // The sixth approved scoring decision. A cancelled goal contributes nothing, so a score
    // recorded against it would eventually be read by something that does not know to ignore it.
    if (!scoredCancellation.ok)
      expect(scoredCancellation.error.reason).toBe('goal-cancelled-carries-no-score');

    const unscored = closeGoal(running.value, {
      outcome: 'achieved',
      closedAt: day('2026-06-01'),
      closedBy: 'user:manager',
    });

    expect(unscored.ok).toBe(false);
    if (!unscored.ok) expect(unscored.error.reason).toBe('goal-closure-needs-score');
  });

  it('measures a goal set against the template’s required total, ignoring cancellations', () => {
    const of = (weight: number, status: 'active' | 'cancelled') => {
      const created = createGoal({ ...request, weightBasisPoints: weight });

      if (!created.ok) throw new Error('unreachable');
      return { ...created.value, status };
    };

    expect(goalWeightsSatisfy([of(6000, 'active'), of(4000, 'active')], 10_000)).toBe(true);
    expect(goalWeightsSatisfy([of(6000, 'active'), of(4000, 'cancelled')], 10_000)).toBe(false);
    // A tenant that runs unweighted goals requires no total, and any set satisfies it.
    expect(goalWeightsSatisfy([of(6000, 'active')], 0)).toBe(true);
  });
});

describe('the cycle', () => {
  const request = {
    cycleId: 'cycle-1',
    code: 'annual-2026',
    name: NAME,
    reviewTemplateId: 'template-1',
    kind: 'annual',
    periodStart: day('2026-01-01'),
    periodEnd: day('2026-12-31'),
    selfAssessmentDue: day('2027-01-15'),
  };

  it('opens, runs and closes under a named human', () => {
    const created = createCycle(request);

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const opened = moveCycle(created.value, 'open', day('2026-01-02'));

    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    expect(acceptsAssessments(opened.value)).toBe(true);
    expect(closeCycle(opened.value, 'system:auto-approval', day('2027-02-01')).ok).toBe(false);

    const running = moveCycle(opened.value, 'in_progress', day('2026-06-01'));

    expect(running.ok).toBe(true);
    if (!running.ok) return;

    const closed = closeCycle(running.value, 'user:hr', day('2027-02-01'));

    expect(closed.ok).toBe(true);
    if (!closed.ok) return;

    // A closed cycle does not reopen. Its reviews are immutable, and reopening the container would
    // imply they were not.
    expect(moveCycle(closed.value, 'in_progress', day('2027-03-01')).ok).toBe(false);
  });

  it('requires a reason to cancel, and refuses a due date before the period', () => {
    const created = createCycle(request);

    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(cancelCycle(created.value, '   ', day('2026-03-01')).ok).toBe(false);
    expect(cancelCycle(created.value, 'Restructure', day('2026-03-01')).ok).toBe(true);
    expect(createCycle({ ...request, selfAssessmentDue: day('2025-12-01') }).ok).toBe(false);
  });

  it('answers overdue as a question, because nothing notices it happening', () => {
    expect(overdue(day('2027-01-15'), day('2027-02-01'))).toBe(true);
    expect(overdue(day('2027-01-15'), day('2027-01-01'))).toBe(false);
    expect(overdue(undefined, day('2027-02-01'))).toBe(false);
  });
});
