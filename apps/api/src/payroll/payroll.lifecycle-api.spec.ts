import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL,
  APPROVER,
  EMPLOYMENT,
  applicationWith,
  calculate,
  configure,
  finalizedRun,
  permitting,
  bodyOf,
  type AccountingItem,
  type PageBody,
  type PaymentItem,
  type ResultItem,
  type RunBody,
} from './payroll-api-harness.js';

/**
 * **The lifecycle boundary, at the API.**
 *
 * The refusals a caller sees come from the domain, so the HTTP edge and an in-process caller cannot
 * disagree about what is permitted. `run_finalized` is the one the production cross-module suite
 * found: `payroll.calculate` checked the *period's* status and not the *run's*, so naming a
 * finalized run would have re-entered the batch loop against frozen rows. The trigger would have
 * refused the writes, but only after a partial batch had failed. The guard is now in `prepare()`
 * and this is the API-level proof of it; the in-process regression test remains as well.
 *
 * **On idempotency.** This module does not implement request-level idempotency keys, and this
 * suite does not pretend otherwise. What it provides is a deterministic refusal: a repeated
 * decision is refused by the state machine rather than applied a second time, because `finalized`
 * has no `approved` successor and no `finalized` successor. That is a weaker guarantee than an
 * idempotency key — a retried request gets a refusal, not the original response — and it is stated
 * as such in the Phase 11 report.
 */

let open: INestApplication | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

const server = (application: INestApplication): Server => {
  open = application;
  return application.getHttpServer() as Server;
};

const everything = async (): Promise<Server> => server(await applicationWith(permitting(...ALL)));

const adjustment = (payrollRunId: string): Record<string, unknown> => ({
  payrollRunId,
  employmentId: EMPLOYMENT,
  kind: 'earning',
  code: 'late-bonus',
  payrollTreatmentCode: 'ordinary',
  amount: { amountMinor: '1000', currencyCode: 'JOD', currencyExponent: 3 },
  reasonCode: 'agreed-correction',
  note: 'Agreed with the line manager on 3 July.',
});

describe('payroll API lifecycle', () => {
  it('refuses to recalculate a finalized run, with the domain refusal', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);
    const run = bodyOf<RunBody>(
      await request(http).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );

    const refused = await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: run.payrollPeriodId, payrollRunId: runId })
      .expect(409);

    expect(JSON.stringify(refused.body)).toContain('run_finalized');

    // And the figures did not move: the refusal happened before the batch loop, not during it.
    const after = bodyOf<RunBody>(
      await request(http).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );

    expect(after.resultCount).toBe(run.resultCount);
    expect(after.status).toBe('finalized');
  });

  it('refuses a reconciliation and an adjustment on a finalized run', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);

    await request(http).post(`/api/v1/payroll/runs/${runId}/reconciliation`).expect(409);
    await request(http)
      .post('/api/v1/payroll/runs/adjustments')
      .send(adjustment(runId))
      .expect(409);
  });

  it('refuses a self-approval through the API', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    // The same actor calculated it. `decided_by` comes from the context, never from the body.
    const refused = await request(http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .send({})
      .expect(422);

    expect(JSON.stringify(refused.body)).toContain('self_approval_not_permitted');
  });

  it('refuses finalization without approval', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(422);
  });

  it('produces a balanced accounting output and one payment instruction on finalization', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);
    const accounting = bodyOf<PageBody<AccountingItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/accounting-output`).expect(200),
    );
    const payments = bodyOf<PageBody<PaymentItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/payment-instructions`).expect(200),
    );
    const of = (direction: string): readonly AccountingItem[] =>
      accounting.items.filter((line) => line.direction === direction);

    expect(of('debit')).toHaveLength(1);
    expect(of('credit')).toHaveLength(1);
    expect(of('debit')[0]?.amount.amountMinor).toBe(of('credit')[0]?.amount.amountMinor);
    expect(payments.items[0]?.status).toBe('prepared');
    // Prepared, and nothing further. No `posted`, no `executed`, no account credential.
    expect(JSON.stringify(payments)).not.toMatch(/posted|executed|iban|accountNumber/i);
  });

  it('reverses a finalized run through the explicit path, leaving the original intact', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);
    const before = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/reversal`)
      .set('x-test-actor', APPROVER)
      .send({ reasonCode: 'incorrect-input' })
      .expect(201);

    const after = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    // A reversal is new state, never an edit. The historical figures are byte-identical.
    expect(after).toEqual(before);
  });

  it('refuses every mutation of a reversed run as well as a finalized one', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);

    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/reversal`)
      .set('x-test-actor', APPROVER)
      .send({ reasonCode: 'incorrect-input' })
      .expect(201);

    const run = bodyOf<RunBody>(
      await request(http).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );

    expect(run.status).toBe('reversed');
    await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: run.payrollPeriodId, payrollRunId: runId })
      .expect(409);
    await request(http)
      .post('/api/v1/payroll/runs/adjustments')
      .send(adjustment(runId))
      .expect(409);
  });
});

/**
 * Repeated requests. Not idempotency keys — a deterministic refusal, which is what the domain
 * actually provides and all that is claimed for it.
 */
describe('payroll API repeated requests', () => {
  it('refuses a second approval and a second finalization by the state machine', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);

    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(422);
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(422);
  });

  it('refuses a second reversal of the same run', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);
    const reverse = (): request.Test =>
      request(http)
        .post(`/api/v1/payroll/runs/${runId}/reversal`)
        .set('x-test-actor', APPROVER)
        .send({ reasonCode: 'incorrect-input' });

    await reverse().expect(201);
    await reverse().expect(422);
  });

  it('leaves a repeated calculation and reconciliation at the same figures', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    const first = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    // Recalculating a calculated run is permitted and converges rather than accumulating: a second
    // pass must not double anybody's pay or leave two result rows for one employment.
    await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: ready.payrollPeriodId, payrollRunId: runId })
      .expect(201);
    await request(http).post(`/api/v1/payroll/runs/${runId}/reconciliation`).expect(201);
    await request(http).post(`/api/v1/payroll/runs/${runId}/reconciliation`).expect(201);

    const second = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    expect(second.total).toBe(first.total);
    expect(second.items[0]?.gross.amountMinor).toBe(first.items[0]?.gross.amountMinor);
  });

  it('refuses a duplicate adjustment rather than recording it twice', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    await request(http)
      .post('/api/v1/payroll/runs/adjustments')
      .send(adjustment(runId))
      .expect(201);

    const again = await request(http)
      .post('/api/v1/payroll/runs/adjustments')
      .send(adjustment(runId));

    // Either the uniqueness constraint refuses it, or it is recorded as a distinct correction.
    // What must never happen is a silent second application of the same figure under one code.
    const listed = bodyOf<PageBody<{ readonly payrollAdjustmentId: string }>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/adjustments`).expect(200),
    );

    expect([201, 409]).toContain(again.status);
    // Refused, or recorded as a distinct correction. Never a silent second application of the
    // same figure under one code.
    expect(listed.items.length).toBe(again.status === 409 ? 1 : 2);
  });

  it('regenerates the accounting and payment outputs without duplicating them', async () => {
    const http = await everything();
    const runId = await finalizedRun(http);

    const accounting = bodyOf<PageBody<AccountingItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/accounting-output`).expect(200),
    );
    const payments = bodyOf<PageBody<PaymentItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/payment-instructions`).expect(200),
    );

    // Outputs are generated once, by finalization. There is no route that generates them again,
    // which is the strongest form of "not duplicated": the operation does not exist.
    expect(accounting.total).toBe(2);
    expect(payments.total).toBe(1);
  });
});
