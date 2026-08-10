import { describe, expect, it } from 'vitest';

import { closed, inForceOn, isPartialWithin, overlaps, recurring } from './recurring.js';
import { oneTime, payableWithin } from './one-time.js';
import { adjustment } from './adjustment.js';
import {
  approvalDecision,
  effectiveDecisions,
  nextSequence,
  reversalPermitted,
  stateFromChain,
} from './approval.js';
import { compensationChange, snapshotOf } from './change-log.js';
import { completed, importBatch } from './import-batch.js';
import type { CompensationResult } from './compensation-rejection.js';

/**
 * The authoritative records, the adjustment beside them, the approval chain and the history.
 *
 * The property exercised hardest here is that **history is never rewritten**: closing a period keeps
 * its amount, a half-open boundary is not an overlap, and a reversed decision leaves both rows in
 * the chain while counting for neither.
 */

const AT = new Date('2026-06-15T09:00:00Z');
const TENANT = '11111111-1111-7111-8111-111111111111';
const EMPLOYMENT = '22222222-2222-7222-8222-222222222222';
const COMPONENT = '33333333-3333-7333-8333-333333333333';
const PLAN = '44444444-4444-7444-8444-444444444444';

const unwrap = <TValue>(result: CompensationResult<TValue>): TValue => {
  if (!result.ok) throw new Error(`Refused: ${result.error.reason}`);
  return result.value;
};

const refusal = <TValue>(result: CompensationResult<TValue>): string => {
  if (result.ok) throw new Error('Expected a refusal.');
  return result.error.reason;
};

const jod = (minor: string) => ({ amountMinor: minor, currencyCode: 'JOD', currencyExponent: 3 });
const sar = (minor: string) => ({ amountMinor: minor, currencyCode: 'SAR', currencyExponent: 2 });

const aRecurring = (overrides: Record<string, unknown> = {}) =>
  unwrap(
    recurring(
      {
        tenantId: TENANT,
        employmentId: EMPLOYMENT,
        componentId: COMPONENT,
        compensationPlanId: PLAN,
        amount: jod('1000000'),
        effectiveFrom: '2026-01-01',
        recordedBy: 'user:hr',
        approvalState: 'not_required',
        ...overrides,
      },
      AT,
    ),
  );

describe('recurring compensation', () => {
  it('records both time axes', () => {
    const record = aRecurring({ effectiveFrom: '2026-03-01' });

    expect(record.effectiveFrom).toBe('2026-03-01');
    expect(record.recordedAt).toEqual(AT);
  });

  it('permits a zero amount — entitled at nothing is not the same as not entitled', () => {
    expect(aRecurring({ amount: jod('0') }).amount.amountMinor).toBe(0n);
  });

  it('closes a period without touching its value', () => {
    const record = aRecurring();
    const ended = unwrap(closed(record, '2026-07-01'));

    expect(ended.effectiveTo).toBe('2026-07-01');
    expect(ended.amount.amountMinor).toBe(record.amount.amountMinor);
    expect(ended.effectiveFrom).toBe(record.effectiveFrom);
  });

  it('refuses a close before the period began', () => {
    expect(refusal(closed(aRecurring(), '2025-01-01'))).toBe('period_ends_before_it_starts');
  });

  it('treats a half-open boundary as not overlapping', () => {
    const first = aRecurring({ effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' });
    const second = aRecurring({ effectiveFrom: '2026-07-01' });

    expect(overlaps(first, second)).toBe(false);
  });

  it('detects a real overlap', () => {
    const first = aRecurring({ effectiveFrom: '2026-01-01', effectiveTo: '2026-08-01' });
    const second = aRecurring({ effectiveFrom: '2026-07-01' });

    expect(overlaps(first, second)).toBe(true);
  });

  it('answers `at(date)` half-open', () => {
    const record = aRecurring({ effectiveFrom: '2026-01-01', effectiveTo: '2026-07-01' });

    expect(inForceOn(record, '2026-06-30')).toBe(true);
    expect(inForceOn(record, '2026-07-01')).toBe(false);
    expect(inForceOn(record, '2025-12-31')).toBe(false);
  });

  it('reports a partial period as a fact without prorating it', () => {
    const midMonth = aRecurring({ effectiveFrom: '2026-06-15' });

    expect(isPartialWithin(midMonth, { from: '2026-06-01', to: '2026-06-30' })).toBe(true);
    expect(
      isPartialWithin(aRecurring({ effectiveFrom: '2026-01-01' }), {
        from: '2026-06-01',
        to: '2026-06-30',
      }),
    ).toBe(false);
  });

  it('refuses a period that ends before it starts', () => {
    expect(
      refusal(
        recurring(
          {
            tenantId: TENANT,
            employmentId: EMPLOYMENT,
            componentId: COMPONENT,
            compensationPlanId: PLAN,
            amount: jod('1'),
            effectiveFrom: '2026-06-01',
            effectiveTo: '2026-01-01',
            recordedBy: 'user:hr',
            approvalState: 'not_required',
          },
          AT,
        ),
      ),
    ).toBe('period_ends_before_it_starts');
  });
});

describe('one-time compensation', () => {
  const record = (overrides: Record<string, unknown> = {}) =>
    oneTime(
      {
        tenantId: TENANT,
        employmentId: EMPLOYMENT,
        componentId: COMPONENT,
        compensationPlanId: PLAN,
        amount: jod('500000'),
        payableOn: '2026-03-15',
        reasonCode: 'annual-bonus',
        recordedBy: 'user:hr',
        approvalState: 'not_required',
        ...overrides,
      },
      AT,
    );

  it('records a payable date and no period', () => {
    expect(unwrap(record()).payableOn).toBe('2026-03-15');
  });

  it('requires a reason — a discretionary payment needs an explanation', () => {
    expect(refusal(record({ reasonCode: '' }))).toBe('code_malformed');
  });

  it('falls inside a period inclusively at both ends', () => {
    const item = unwrap(record());

    expect(payableWithin(item, { from: '2026-03-15', to: '2026-03-31' })).toBe(true);
    expect(payableWithin(item, { from: '2026-03-01', to: '2026-03-15' })).toBe(true);
    expect(payableWithin(item, { from: '2026-04-01', to: '2026-04-30' })).toBe(false);
  });
});

describe('adjustment', () => {
  const record = (overrides: Record<string, unknown> = {}) =>
    adjustment(
      {
        tenantId: TENANT,
        employmentId: EMPLOYMENT,
        componentId: COMPONENT,
        adjustmentType: 'merit',
        previousAmount: jod('1000000'),
        newAmount: jod('1100000'),
        currencyCode: 'JOD',
        currencyExponent: 3,
        effectiveFrom: '2026-03-01',
        reasonCode: 'annual-review',
        note: 'Agreed at the March review.',
        requestedBy: 'user:hr',
        approvalState: 'pending',
        ...overrides,
      },
      AT,
    );

  it('requires a written note as well as a code', () => {
    expect(refusal(record({ note: '   ' }))).toBe('text_required');
  });

  it('requires a reason code', () => {
    expect(refusal(record({ reasonCode: 'NOT A CODE' }))).toBe('code_malformed');
  });

  it('refuses a before and after in different currencies', () => {
    expect(refusal(record({ newAmount: sar('1100') }))).toBe('adjustment_currencies_differ');
  });

  it('records the movement without rewriting anything', () => {
    const built = unwrap(record());

    expect(built.previousAmount?.amountMinor).toBe(1_000_000n);
    expect(built.newAmount?.amountMinor).toBe(1_100_000n);
  });
});

describe('approval', () => {
  const decide = (overrides: Record<string, unknown> = {}) =>
    approvalDecision(
      {
        tenantId: TENANT,
        subjectKind: 'recurring',
        subjectId: PLAN,
        sequence: 1,
        decision: 'approved',
        decidedBy: 'user:manager',
        requestedBy: 'user:hr',
        ...overrides,
      },
      AT,
    );

  it('refuses self-approval', () => {
    expect(refusal(decide({ decidedBy: 'user:hr' }))).toBe('self_approval_refused');
  });

  it('copies requestedBy onto the decision, which is what the check constraint compares', () => {
    expect(unwrap(decide()).requestedBy).toBe('user:hr');
  });

  it('reports `not_required` when a plan requires no approval, without a decision row', () => {
    expect(stateFromChain([], 0)).toBe('not_required');
  });

  it('stays pending until enough approvals stand', () => {
    const one = unwrap(decide());

    expect(stateFromChain([one], 2)).toBe('pending');
    expect(stateFromChain([one, unwrap(decide({ sequence: 2 }))], 2)).toBe('approved');
  });

  it('lets one rejection settle it', () => {
    const rejected = unwrap(decide({ decision: 'rejected' }));

    expect(stateFromChain([unwrap(decide()), rejected], 1)).toBe('rejected');
  });

  it('excludes a reversed decision and its reversal from the count', () => {
    const original = unwrap(decide());
    const reversal = unwrap(
      decide({ sequence: 2, decision: 'rejected', reversesDecisionId: original.id }),
    );

    expect(effectiveDecisions([original, reversal])).toHaveLength(0);
    expect(stateFromChain([original, reversal], 1)).toBe('pending');
  });

  it('numbers the next decision from the highest already present', () => {
    expect(nextSequence([unwrap(decide({ sequence: 3 }))])).toBe(4);
  });

  it('permits a reversal only while the change is still future-dated', () => {
    expect(reversalPermitted('2026-07-01', '2026-06-15')).toBe(true);
    expect(reversalPermitted('2026-06-01', '2026-06-15')).toBe(false);
  });
});

describe('history', () => {
  it('serialises a monetary amount as an exact decimal string', () => {
    const snapshot = snapshotOf(aRecurring({ amount: jod('90071992547409910') }));

    expect((snapshot['amount'] as Record<string, unknown>)['amountMinor']).toBe(
      '90071992547409910',
    );
  });

  it('serialises an instant as an ISO string', () => {
    expect(snapshotOf({ at: AT })['at']).toBe(AT.toISOString());
  });

  it('refuses a change kind it does not know', () => {
    expect(
      refusal(
        compensationChange(
          {
            tenantId: TENANT,
            employmentId: EMPLOYMENT,
            subjectKind: 'recurring',
            subjectId: PLAN,
            changeKind: 'invented',
            actor: 'user:hr',
          },
          AT,
        ),
      ),
    ).toBe('change_kind_unknown');
  });
});

describe('import batch', () => {
  const open = (rows: number) =>
    importBatch(
      { tenantId: TENANT, source: 'csv', rowsSubmitted: rows, submittedBy: 'user:hr' },
      AT,
    );

  it('opens with every count at zero', () => {
    const batch = unwrap(open(10));

    expect(batch.rowsCreated).toBe(0);
    expect(batch.rowsSkipped).toBe(0);
  });

  it('refuses a batch larger than the bound', () => {
    expect(refusal(open(100_000))).toBe('import_batch_too_large');
  });

  it('refuses counts that exceed what was submitted', () => {
    expect(
      refusal(completed(unwrap(open(2)), { rowsCreated: 2, rowsSkipped: 2, rowsFailed: 0 })),
    ).toBe('import_counts_exceed_submitted');
  });

  it('records a retry as skipped rather than created', () => {
    const finished = unwrap(
      completed(unwrap(open(3)), { rowsCreated: 0, rowsSkipped: 3, rowsFailed: 0 }),
    );

    expect(finished.rowsSkipped).toBe(3);
    expect(finished.rowsCreated).toBe(0);
  });
});
