import { describe, expect, it } from 'vitest';

import { type CountryRulePort } from './country-rule.js';
import { CALCULATION_VERSION, calculateEmployment } from './payroll-calculation.js';
import { recordDecision, reverseDecision, standingApprovals } from './payroll-approval.js';
import { approveRun, createPayrollRun, finalizeRun, moveRunTo } from './payroll-run.js';
import { accountingBalances, accountingFor, wholeTo } from './payroll-outputs.js';
import { aRequest, jod, onlyResult } from './payroll-fixtures.js';

/**
 * The lifecycle, and the boundary at each end of it.
 *
 * Country rules that nothing implements, a run that refuses illegal transitions, an approval that
 * refuses to be its own, and an accounting output that balances. Apart from the calculation suite
 * because these are the assertions about what happens *around* a figure rather than to it.
 */

describe('country rules', () => {
  it('produces no statutory line when no pack is configured, which is the shipped behaviour', () => {
    const result = onlyResult(calculateEmployment(aRequest()));

    expect(result?.deductions.every((line) => line.deductionSource !== 'statutory')).toBe(true);
  });

  it('appends a pack line beside the contract lines and labels its source', () => {
    // A test double, not a country pack: it exercises the hook and encodes no jurisdiction's law.
    const port: CountryRulePort = {
      apply: () => ({
        earnings: [],
        deductions: [
          {
            code: 'example-contribution',
            payrollTreatmentCode: 'statutory',
            amount: jod(50_000n),
            calculationReason: 'example',
            statutorySourceCode: 'example-article-1',
          },
        ],
      }),
    };
    const result = onlyResult(
      calculateEmployment(aRequest({ countryRules: port, countryCode: 'JO' })),
    );

    expect(result?.deductions[0]?.deductionSource).toBe('statutory');
    expect(result?.deductions[0]?.detail.statutorySourceCode).toBe('example-article-1');
    // The contract's own earning is untouched beside it.
    expect(result?.gross.amountMinor).toBe(1_000_000n);
    expect(result?.net.amountMinor).toBe(950_000n);
  });

  it('ignores a pack entirely when the group names no country', () => {
    const port: CountryRulePort = {
      apply: () => ({
        earnings: [],
        deductions: [
          {
            code: 'x',
            payrollTreatmentCode: 'y',
            amount: jod(1n),
            calculationReason: 'z',
            statutorySourceCode: 's',
          },
        ],
      }),
    };

    expect(
      onlyResult(calculateEmployment(aRequest({ countryRules: port })))?.deductions,
    ).toHaveLength(0);
  });
});

describe('run lifecycle', () => {
  it('refuses to finalize a run carrying unresolved exceptions', () => {
    const run = { ...createPayrollRun(aRun()), status: 'approved' as const, exceptionCount: 3 };

    expect(finalizeRun(run, new Date(), 'user:a').ok).toBe(false);
  });

  it('refuses a transition the table does not permit, naming both ends', () => {
    const refused = moveRunTo(createPayrollRun(aRun()), 'finalized');

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.detail).toEqual({ from: 'draft', to: 'finalized' });
  });

  it('cannot approve a stale run, which is the whole point of detecting staleness', () => {
    const stale = { ...createPayrollRun(aRun()), status: 'stale' as const };

    expect(approveRun(stale, new Date(), 'user:a').ok).toBe(false);
  });
});

const aRun = () => ({
  payrollRunId: 'run',
  payrollPeriodId: 'period',
  payrollGroupId: 'group',
  runSequence: 1,
  runKind: 'regular' as const,
  calculationVersion: CALCULATION_VERSION,
  ruleSetDigest: 'abcdef01',
  eligibilityRuleVersion: 1,
});

describe('approval', () => {
  it('refuses a self-approval even for somebody holding every permission', () => {
    const refused = recordDecision({
      approvalDecisionId: 'decision',
      payrollRunId: 'run',
      sequence: 1,
      decision: 'approved',
      decidedBy: 'user:a',
      decidedAt: new Date(),
      requestedBy: 'user:a',
    });

    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.reason).toBe('self_approval_not_permitted');
  });

  it('reverses without erasing, and a reversed approval no longer counts', () => {
    const first = recordDecision({
      approvalDecisionId: 'decision-1',
      payrollRunId: 'run',
      sequence: 1,
      decision: 'approved',
      decidedBy: 'user:b',
      decidedAt: new Date(),
      requestedBy: 'user:a',
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const reversal = reverseDecision(first.value, {
      approvalDecisionId: 'decision-2',
      sequence: 2,
      decidedBy: 'user:c',
      decidedAt: new Date(),
    });

    expect(reversal.ok).toBe(true);
    if (!reversal.ok) return;
    // Both rows remain in the chain; the approval simply stops standing.
    expect(standingApprovals([first.value, reversal.value])).toBe(0);
  });
});

describe('accounting output', () => {
  it('balances, per currency, by construction', () => {
    const result = onlyResult(
      calculateEmployment(aRequest({ attendance: { unpaidMinutes: 1_440 } })),
    );

    expect(result).toBeDefined();
    if (result === undefined) return;

    const lines = accountingFor({
      result,
      allocations: wholeTo('centre-1', 'unit-1'),
      expenseAccount: 'payroll-expense',
      deductionAccount: 'payroll-deductions',
      payableAccount: 'payroll-payable',
      journalReference: 'journal-1',
      identifier: (sequence) => `line-${sequence}`,
    });

    expect(lines.ok).toBe(true);
    if (!lines.ok) return;
    expect(accountingBalances(lines.value)).toBe(true);
  });

  it('splits a cost across centres without losing a minor unit', () => {
    const result = onlyResult(calculateEmployment(aRequest()));

    expect(result).toBeDefined();
    if (result === undefined) return;

    const lines = accountingFor({
      result,
      allocations: [
        { costCenterId: 'a', basisPoints: 3_333 },
        { costCenterId: 'b', basisPoints: 6_667 },
      ],
      expenseAccount: 'payroll-expense',
      deductionAccount: 'payroll-deductions',
      payableAccount: 'payroll-payable',
      journalReference: 'journal-1',
      identifier: (sequence) => `line-${sequence}`,
    });

    expect(lines.ok).toBe(true);
    if (!lines.ok) return;
    expect(accountingBalances(lines.value)).toBe(true);
  });
});
