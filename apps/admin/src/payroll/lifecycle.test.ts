import type { PayrollExceptionView, PayrollRunView } from '@work/payroll/contracts';
import { describe, expect, it } from 'vitest';

import { actionsFor, blockingExceptions, postureOf, withheldBecause } from './lifecycle';

/**
 * The screen must not offer an action the system is going to refuse.
 *
 * **This is a usability property, not a security one**, and the distinction is the reason these
 * tests exist separately from the API's. The API refuses every one of these independently — the
 * `payroll.postgres-api.spec.ts` and `payroll.lifecycle-api.spec.ts` suites prove that a caller with
 * `curl` gets `run_finalized`, `self_approval_not_permitted` and the rest regardless of what any
 * screen rendered. Nothing here is relied on to stop anybody.
 *
 * What these do check is that a payroll operator is never shown Calculate on a frozen run or
 * Finalize on a stale one, and that when a control is withheld the screen says why rather than
 * leaving a gap somebody refreshes the page over.
 */

const aRun = (overrides: Partial<PayrollRunView> = {}): PayrollRunView => ({
  payrollRunId: '01930000-0000-7000-8000-000000000001',
  payrollPeriodId: '01930000-0000-7000-8000-000000000002',
  payrollGroupId: '01930000-0000-7000-8000-000000000003',
  runSequence: 1,
  runKind: 'regular',
  status: 'calculated',
  calculationVersion: 1,
  ruleSetDigest: 'aaaa0001',
  eligibilityRuleVersion: 1,
  populationSize: 10,
  resultCount: 10,
  exceptionCount: 0,
  staleCount: 0,
  complete: true,
  ...overrides,
});

const anException = (exceptionCode: string, resolvedAt?: Date): PayrollExceptionView => ({
  payrollExceptionId: `01930000-0000-7000-8000-0000000000${exceptionCode.length.toString().padStart(2, '0')}`,
  employmentId: '01930000-0000-7000-8000-00000000000e',
  exceptionCode,
  ...(resolvedAt === undefined ? {} : { resolvedAt }),
});

describe('which actions a run permits', () => {
  it('offers nothing but a reversal on a finalized run', () => {
    const permitted = actionsFor(aRun({ status: 'finalized', finalizedAt: new Date() }));

    // The figures are frozen at the table by a trigger. Calculate, Adjust and Approve would each
    // be refused, and offering them invites an operator to try.
    expect([...permitted]).toEqual(['reverse']);
    expect(permitted.has('calculate')).toBe(false);
    expect(permitted.has('adjust')).toBe(false);
    expect(permitted.has('approve')).toBe(false);
  });

  it('offers nothing at all on a reversed run', () => {
    // Terminal. Not even a reversal of the reversal.
    expect([...actionsFor(aRun({ status: 'reversed' }))]).toEqual([]);
  });

  it('withholds approve and finalize while a run is stale', () => {
    const permitted = actionsFor(aRun({ status: 'stale', staleCount: 3 }));

    // A source moved after the figures were computed. Approving would be approving figures that no
    // longer follow from their inputs.
    expect(permitted.has('approve')).toBe(false);
    expect(permitted.has('finalize')).toBe(false);
    // Reconcile and recalculate are exactly what should be offered instead.
    expect(permitted.has('reconcile')).toBe(true);
    expect(permitted.has('calculate')).toBe(true);
  });

  it('withholds approve and finalize while the population is not covered', () => {
    const permitted = actionsFor(aRun({ complete: false }));

    // Half a payroll is not a payroll. The invariant lives in the domain; this mirrors it.
    expect(permitted.has('approve')).toBe(false);
    expect(permitted.has('finalize')).toBe(false);
  });

  it('withholds finalize until somebody has approved', () => {
    const unapproved = actionsFor(aRun());
    const approved = actionsFor(aRun({ approvedAt: new Date(), approvedBy: 'user:approver' }));

    expect(unapproved.has('approve')).toBe(true);
    expect(unapproved.has('finalize')).toBe(false);
    expect(approved.has('finalize')).toBe(true);
  });

  it('withholds finalize while an eligibility rule failed for somebody', () => {
    const run = aRun({ approvedAt: new Date(), exceptionCount: 1 });
    const blocked = actionsFor(run, [anException('eligibility_rule_failed')]);

    // A rule that could not be evaluated is a broken configuration, not a decision to leave
    // somebody out. Finalizing over it pays a smaller workforce and says nothing.
    expect(blocked.has('finalize')).toBe(false);
    expect(blocked.has('approve')).toBe(true);
  });

  it('permits finalize once that exception is resolved', () => {
    const run = aRun({ approvedAt: new Date(), exceptionCount: 1 });
    const resolved = actionsFor(run, [anException('eligibility_rule_failed', new Date())]);

    expect(resolved.has('finalize')).toBe(true);
  });

  it('does not treat every exception as blocking', () => {
    const run = aRun({ approvedAt: new Date(), exceptionCount: 1 });
    // Somebody with no compensation is a real exception and a real problem — but it is not the
    // one that means the run's own eligibility configuration is broken.
    const permitted = actionsFor(run, [anException('compensation_missing')]);

    expect(blockingExceptions([anException('compensation_missing')])).toHaveLength(0);
    expect(permitted.has('finalize')).toBe(true);
  });

  it('offers nothing when there is no run at all', () => {
    expect([...actionsFor(undefined)]).toEqual([]);
    expect(withheldBecause(undefined)).toBeUndefined();
  });
});

describe('why an action is withheld', () => {
  it('names the reason rather than leaving a gap', () => {
    expect(withheldBecause(aRun({ status: 'finalized' }))).toBe('payroll.notice.finalizedRun');
    expect(withheldBecause(aRun({ status: 'stale' }))).toBe('payroll.notice.staleRun');
    expect(withheldBecause(aRun(), [anException('eligibility_rule_failed')])).toBe(
      'payroll.notice.unresolvedExceptions',
    );
    expect(withheldBecause(aRun())).toBeUndefined();
  });

  it('reads the posture off the run rather than recomputing it per control', () => {
    const posture = postureOf(aRun({ status: 'stale', complete: false }), [
      anException('eligibility_rule_failed'),
    ]);

    expect(posture).toEqual({ frozen: false, stale: true, incomplete: true, blocked: true });
  });
});
