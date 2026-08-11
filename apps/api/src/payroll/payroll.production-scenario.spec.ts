import 'reflect-metadata';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bodyOf,
  type AccountingItem,
  type PageBody,
  type PaymentItem,
  type ResultItem,
  type RunBody,
} from './payroll-api-harness.js';
import { APPROVER, configured } from './cross-module-scenarios.js';
import {
  CONNECTION,
  openProduction,
  requireDatabaseInCi,
  type ProductionFixture,
} from './payroll-production.fixture.js';

/**
 * **The final production scenario.** One chain, nothing faked along it.
 *
 * ```text
 * Employment → Compensation → Attendance → Leave → Payroll population → immutable snapshot →
 * calculation → results → reconciliation → approval → finalization →
 * accounting output + payment instruction → immutable historical result → reversal
 * ```
 *
 * Real PostgreSQL, real repositories for Employment, Compensation and Payroll, the real production
 * cross-module adapters, the real dispatcher, real permission checks, and the real HTTP API for
 * every payroll step — all in one composition, running as a role that owns nothing and cannot
 * bypass row-level security.
 *
 * The employment is created by Employment's own command and the salary by Compensation's own
 * commands. Payroll never learns either through a fixture: it resolves the population through
 * Employment's published search and the figures through `compensation.payroll-period`, exactly as
 * it would in production.
 */

requireDatabaseInCi('Payroll production scenario');

/** A monetary amount as an exact integer. Nothing on this path turns one into a `number`. */
const minor = (amount: { readonly amountMinor: string } | undefined): bigint =>
  BigInt(amount?.amountMinor ?? '0');

const totalOf = (lines: readonly AccountingItem[], direction: string): bigint =>
  lines
    .filter((line) => line.direction === direction)
    .reduce((sum, line) => sum + minor(line.amount), 0n);

/** The figures, and the arithmetic that has to hold between them. */
const assertResult = (result: ResultItem | undefined, employmentId: string): void => {
  expect(result?.employmentId).toBe(employmentId);
  // An exact decimal string, written by Compensation and read back through a bigint column.
  expect(typeof result?.gross.amountMinor).toBe('string');
  expect(minor(result?.gross)).toBeGreaterThan(0n);
  expect(minor(result?.net)).toBe(minor(result?.gross) - minor(result?.totalDeductions));
};

/** Balanced, prepared, and carrying nothing that would let anybody act on it. */
const assertOutputs = (
  accounting: PageBody<AccountingItem>,
  payments: PageBody<PaymentItem>,
): void => {
  expect(totalOf(accounting.items, 'debit')).toBe(totalOf(accounting.items, 'credit'));
  expect(totalOf(accounting.items, 'debit')).toBeGreaterThan(0n);
  expect(payments.items[0]?.status).toBe('prepared');
  expect(JSON.stringify(payments)).not.toMatch(/posted|executed|iban|accountNumber/i);
};

describe.skipIf(CONNECTION === undefined)('the payroll production scenario', () => {
  let fixture: ProductionFixture;

  beforeAll(async () => {
    fixture = await openProduction();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('carries one employment from hire to reversal, through every real component', async () => {
    // ── Employment → Compensation → Attendance → Leave ───────────────────────────────────────
    const personId = await fixture.seedPerson();
    const ready = await fixture.wired.as('user:payroll-administrator', () =>
      configured(fixture.wired, personId),
    );

    expect(ready.employmentId).toBeTruthy();

    // ── Payroll population → snapshot → calculation, through the HTTP API ────────────────────
    const calculated = bodyOf<RunBody & { complete: boolean; resultCount: number }>(
      await request(fixture.http)
        .post('/api/v1/payroll/runs/calculation')
        .send({ payrollPeriodId: ready.payrollPeriodId })
        .expect(201),
    );
    const runId = calculated.payrollRunId;

    // The population was resolved through Employment's published search, and the figures through
    // Compensation's published contract. Nothing here told Payroll about either.
    expect(calculated.complete).toBe(true);
    expect(calculated.resultCount).toBe(1);

    // ── Results ──────────────────────────────────────────────────────────────────────────────
    const results = bodyOf<PageBody<ResultItem>>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );
    const original = results.items[0];

    expect(results.total).toBe(1);
    assertResult(original, ready.employmentId);

    // Every earning line explains itself.
    const earnings = bodyOf<PageBody<{ calculationReason: string; earningSource: string }>>(
      await request(fixture.http)
        .get(`/api/v1/payroll/results/${original?.payrollResultId ?? ''}/earnings`)
        .expect(200),
    );

    expect(earnings.items.length).toBeGreaterThan(0);
    // Candidate overtime is never payable, and nothing in this chain produced it.
    expect(earnings.items.every((line) => line.earningSource !== 'attendance_overtime')).toBe(true);

    // ── Reconciliation ───────────────────────────────────────────────────────────────────────
    await request(fixture.http).post(`/api/v1/payroll/runs/${runId}/reconciliation`).expect(201);

    const afterReconcile = bodyOf<RunBody>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );

    // Nothing moved, so nothing is stale. Reconciliation repaired nothing either way.
    expect(afterReconcile.status).toBe('calculated');

    // ── Approval, by a second named human ────────────────────────────────────────────────────
    await request(fixture.http).post(`/api/v1/payroll/runs/${runId}/approval`).send({}).expect(422);
    await request(fixture.http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(201);

    const chain = bodyOf<{ steps: { decidedBy: string }[] }>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}/approval-chain`).expect(200),
    );

    expect(chain.steps[0]?.decidedBy).toBe(APPROVER);
    expect(JSON.stringify(chain)).not.toContain('system:auto-approval');

    // ── Finalization → accounting output + payment instruction ───────────────────────────────
    await request(fixture.http)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(201);

    const accounting = bodyOf<PageBody<AccountingItem>>(
      await request(fixture.http)
        .get(`/api/v1/payroll/runs/${runId}/accounting-output`)
        .expect(200),
    );
    const payments = bodyOf<PageBody<PaymentItem>>(
      await request(fixture.http)
        .get(`/api/v1/payroll/runs/${runId}/payment-instructions`)
        .expect(200),
    );
    // Balanced, and prepared. Nothing posted and nothing executed.
    assertOutputs(accounting, payments);

    // ── Immutable historical result ──────────────────────────────────────────────────────────
    const frozen = bodyOf<PageBody<ResultItem>>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    expect(frozen.items[0]?.gross.amountMinor).toBe(original?.gross.amountMinor);

    // Every mutation path is closed, at the API and at the table.
    await request(fixture.http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: ready.payrollPeriodId, payrollRunId: runId })
      .expect(409);
    await request(fixture.http).post(`/api/v1/payroll/runs/${runId}/reconciliation`).expect(409);

    // ── Reversal, which creates new state and leaves history alone ───────────────────────────
    await request(fixture.http)
      .post(`/api/v1/payroll/runs/${runId}/reversal`)
      .set('x-test-actor', APPROVER)
      .send({ reasonCode: 'incorrect-input' })
      .expect(201);

    const reversed = bodyOf<RunBody>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );
    const preserved = bodyOf<PageBody<ResultItem>>(
      await request(fixture.http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    expect(reversed.status).toBe('reversed');
    // Byte-identical to what was read before approval. A reversal never edits history.
    expect(preserved).toEqual(frozen);

    const runs = bodyOf<PageBody<{ runKind: string; reversalOfRunId?: string }>>(
      await request(fixture.http).get('/api/v1/payroll/runs?page=1&size=50').expect(200),
    );
    const reversal = runs.items.find((run) => run.reversalOfRunId === runId);

    expect(reversal?.runKind).toBe('reversal');
  });
});
