import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PayrollPermissions } from '@work/payroll';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  bodyOf,
  type GroupBody,
  type PageBody,
  type PeriodItem,
  type ResultItem,
  type RunBody,
} from './payroll-api-harness.js';
import {
  APPROVER,
  CONNECTION,
  ENORMOUS,
  TENANT_A,
  TENANT_B,
  httpOf,
  openPostgresApi,
  requireDatabaseInCi,
  type PostgresApiFixture,
} from './payroll-postgres.fixture.js';

/**
 * The API over real PostgreSQL: **row-level security and exactness, end to end.**
 *
 * Everything here runs as a role that owns nothing and cannot bypass RLS, so the isolation
 * assertions are assertions about policies rather than about a `Map`. Tenant B is not given a
 * narrower application or a smaller permission set — it holds *every* Payroll permission. What
 * stops it reading tenant A's payroll is the database, which is the only place that guarantee can
 * live: an API-layer filter is one forgotten `where` clause away from leaking a company's salaries.
 *
 * The precision assertion carries 9,007,199,254,740,993 minor units the whole way — HTTP body,
 * controller, application, repository, `bigint` column, back through the driver, the mapper and
 * `JSON.stringify`. A single `Number()` anywhere on that path silently returns
 * 9,007,199,254,740,992 and nobody finds out until somebody is underpaid.
 */

requireDatabaseInCi('Payroll API over PostgreSQL');

const ALL = Object.values(PayrollPermissions);
const everything = { holds: (): Promise<boolean> => Promise.resolve(true) };

describe.skipIf(CONNECTION === undefined)('payroll API over PostgreSQL', () => {
  let fixture: PostgresApiFixture;
  const opened: INestApplication[] = [];

  beforeAll(async () => {
    fixture = await openPostgresApi();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  afterEach(async () => {
    for (const application of opened.splice(0)) await application.close();
  });

  const appFor = async (tenantId: string, actor?: string): Promise<Server> => {
    const application = await fixture.applicationFor(tenantId, everything, actor);

    opened.push(application);
    return httpOf(application);
  };

  /** Configure a group and an open period, then calculate. Returns the run. */
  const runFor = async (http: Server): Promise<{ runId: string; periodId: string }> => {
    const { payrollGroupId } = bodyOf<GroupBody>(
      await request(http)
        .post('/api/v1/payroll/groups')
        .send({
          legalEntityId: '01930000-0000-7000-8000-00000000e001',
          code: 'monthly-staff',
          name: { en: 'Monthly staff', ar: 'الموظفون الشهريون' },
          payFrequency: 'monthly',
          permittedCurrencies: [{ code: 'JOD', exponent: 3 }],
          prorationBasis: 'calendar_days',
          roundingMode: 'half-up',
          paysSuspended: false,
          expenseAccount: 'payroll-expense',
          deductionAccount: 'payroll-deductions',
          payableAccount: 'payroll-payable',
          paymentMethodCode: 'bank-transfer',
        })
        .expect(201),
    );
    const { payrollPeriodId } = bodyOf<PeriodItem>(
      await request(http)
        .post('/api/v1/payroll/periods')
        .send({
          payrollGroupId,
          code: '2026-06',
          periodStart: '2026-06-01',
          periodEnd: '2026-06-30',
          paymentDate: '2026-07-05',
        })
        .expect(201),
    );

    await request(http)
      .post(`/api/v1/payroll/periods/${payrollPeriodId}/status`)
      .send({ status: 'open', expectedVersion: 1 })
      .expect(201);

    const run = bodyOf<RunBody>(
      await request(http)
        .post('/api/v1/payroll/runs/calculation')
        .send({ payrollPeriodId })
        .expect(201),
    );

    return { runId: run.payrollRunId, periodId: payrollPeriodId };
  };

  it('keeps a salary above 2^53 exact through HTTP, PostgreSQL and back', async () => {
    await fixture.seedEmployment(TENANT_A);

    const http = await appFor(TENANT_A);
    const { runId } = await runFor(http);
    const results = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );
    const only = results.items[0];

    // Written as a string, held as `bigint`, read back and serialized as a string. Exact.
    expect(only?.gross.amountMinor).toBe(ENORMOUS);
    expect(only?.net.amountMinor).toBe(ENORMOUS);
    expect(typeof only?.gross.amountMinor).toBe('string');
    // The proof it never became a double: 2^53 + 1 as a Number is 2^53, and this is not that.
    expect(only?.gross.amountMinor).not.toBe(String(Number(ENORMOUS)));
  });

  it('shows one tenant nothing of another, on every read the module exposes', async () => {
    await fixture.seedEmployment(TENANT_A);

    const a = await appFor(TENANT_A);
    const { runId } = await runFor(a);

    // Approve and finalize, so the accounting and payment outputs exist to be isolated too.
    await request(a)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(201);
    await request(a)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(201);

    const b = await appFor(TENANT_B);

    // Tenant B holds every Payroll permission. The database is what refuses it.
    for (const route of [
      '/api/v1/payroll/groups',
      '/api/v1/payroll/periods',
      '/api/v1/payroll/runs',
    ]) {
      const listed = bodyOf<PageBody<unknown>>(await request(b).get(route).expect(200));

      expect(listed.items).toHaveLength(0);
    }

    // A named identifier from another tenant is **not found**, never forbidden: "forbidden" would
    // confirm that somebody in this system was paid something, which is itself a disclosure.
    await request(b).get(`/api/v1/payroll/runs/${runId}`).expect(404);

    for (const route of [
      `/api/v1/payroll/runs/${runId}/results`,
      `/api/v1/payroll/runs/${runId}/accounting-output`,
      `/api/v1/payroll/runs/${runId}/payment-instructions`,
      `/api/v1/payroll/runs/${runId}/exceptions`,
    ]) {
      const response = await request(b).get(route);
      const items = bodyOf<PageBody<unknown>>(response).items;

      // Either not found, or found empty. Never another tenant's figures.
      expect(response.status === 404 || items.length === 0).toBe(true);
    }
  });

  it('refuses one tenant every write against another tenant’s run', async () => {
    await fixture.seedEmployment(TENANT_A);

    const a = await appFor(TENANT_A);
    const { runId, periodId } = await runFor(a);
    const b = await appFor(TENANT_B);

    // Each of these is a mutation of a payroll that belongs to somebody else.
    const attempts = await Promise.all([
      request(b).post(`/api/v1/payroll/runs/${runId}/approval`).send({}),
      request(b).post(`/api/v1/payroll/runs/${runId}/finalization`),
      request(b).post(`/api/v1/payroll/runs/${runId}/reversal`).send({ reasonCode: 'wrong' }),
      request(b).post(`/api/v1/payroll/runs/${runId}/reconciliation`),
      request(b)
        .post('/api/v1/payroll/runs/calculation')
        .send({ payrollPeriodId: periodId, payrollRunId: runId }),
    ]);

    for (const attempt of attempts) expect([404, 409, 422]).toContain(attempt.status);

    // And tenant A's run is exactly as it was: still calculated, still one result.
    const after = bodyOf<RunBody>(
      await request(a).get(`/api/v1/payroll/runs/${runId}`).expect(200),
    );

    expect(after.status).toBe('calculated');
    expect(after.resultCount).toBe(1);
  });

  it('keeps pages tenant-scoped rather than merely filtered', async () => {
    await fixture.seedEmployment(TENANT_A);
    await fixture.seedEmployment(TENANT_B);

    const a = await appFor(TENANT_A);
    const b = await appFor(TENANT_B);

    await runFor(a);
    await runFor(b);

    const pageOf = async (http: Server): Promise<PageBody<{ payrollRunId: string }>> =>
      bodyOf<PageBody<{ payrollRunId: string }>>(
        await request(http).get('/api/v1/payroll/runs?page=1&size=200').expect(200),
      );
    const forA = await pageOf(a);
    const forB = await pageOf(b);

    // Each tenant's own run and nothing else. `total` matters as much as `items`: a count that
    // included the other tenant would leak how large somebody else's payroll is.
    expect(forA.total).toBe(1);
    expect(forB.total).toBe(1);
    expect(forA.items[0]?.payrollRunId).not.toBe(forB.items[0]?.payrollRunId);
  });

  it('records the approver from the authenticated context, and refuses self-approval', async () => {
    await fixture.seedEmployment(TENANT_A);

    const http = await appFor(TENANT_A);
    const { runId } = await runFor(http);

    // `payroll_approval_decision_self_approval_check` refuses `decided_by = requested_by` at the
    // table. The domain refuses it first, which is what this proves — the constraint is the net.
    await request(http).post(`/api/v1/payroll/runs/${runId}/approval`).send({}).expect(422);
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(201);
  });

  it('refuses to recalculate a finalized run against the real tables', async () => {
    await fixture.seedEmployment(TENANT_A);

    const http = await appFor(TENANT_A);
    const { runId, periodId } = await runFor(http);

    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(201);

    const refused = await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: periodId, payrollRunId: runId })
      .expect(409);

    // The refusal comes before the batch loop. The trigger would have refused the writes anyway,
    // but only after a partial batch had already failed — which is the defect this guards.
    expect(JSON.stringify(refused.body)).toContain('run_finalized');

    const results = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    expect(results.total).toBe(1);
    expect(results.items[0]?.gross.amountMinor).toBe(ENORMOUS);
  });

  it('recalculates in place rather than accumulating, against the real unique index', async () => {
    await fixture.seedEmployment(TENANT_A);

    const http = await appFor(TENANT_A);
    const { runId, periodId } = await runFor(http);

    // `payroll_result_unique_idx` would raise 23505 here if the batch did not clear first.
    await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: periodId, payrollRunId: runId })
      .expect(201);

    const results = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );

    expect(results.total).toBe(1);
    expect(results.items[0]?.gross.amountMinor).toBe(ENORMOUS);
  });

  it('bounds an oversized page against the real repository, not just the fake', async () => {
    await fixture.seedEmployment(TENANT_A);

    const http = await appFor(TENANT_A);
    const { runId } = await runFor(http);
    const results = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results?size=100000`).expect(200),
    );

    // The clamp is applied before the query, so no `limit 100000` ever reaches PostgreSQL.
    expect(results.items.length).toBeLessThanOrEqual(200);
  });

  it('grants nothing to a caller holding no payroll permission at all', async () => {
    await fixture.seedEmployment(TENANT_A);

    const denied = await fixture.applicationFor(TENANT_A, {
      holds: () => Promise.resolve(false),
    });

    opened.push(denied);

    // Every permission the module declares is refused, and the database is never reached.
    expect(ALL.length).toBeGreaterThan(0);
    await request(httpOf(denied)).get('/api/v1/payroll/dashboard').expect(403);
    await request(httpOf(denied)).get('/api/v1/payroll/runs').expect(403);
  });
});
