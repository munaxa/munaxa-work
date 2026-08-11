import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL,
  ENORMOUS,
  applicationWith,
  bodyOf,
  calculate,
  configure,
  defineGroup,
  openPeriod,
  permitting,
  type AccountingItem,
  type GroupBody,
  type PageBody,
  type PeriodItem,
  type ResultItem,
} from './payroll-api-harness.js';

/**
 * The Payroll API's transport concerns: money on the wire, route resolution, input refusal and
 * pagination.
 *
 * The route-ordering assertion is not decoration. `POST /payroll/runs/calculation` and
 * `GET /payroll/runs/:payrollRunId` are the same shape to a router, and so are
 * `runs/:id/reconciliation` and `runs/:id/results`. A controller declared in the wrong order makes
 * one resolve to the other, and no unit test would notice.
 *
 * The **money assertion** is the one to read first: a gross of 9,007,199,254,740,993 minor units
 * leaves the API as an exact decimal string. A JSON number would have rounded it to
 * 9,007,199,254,740,992 somewhere on the way out, and nobody would have seen where. The same value
 * is carried through real PostgreSQL and back in `payroll.postgres-api.spec.ts`.
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

describe('the payroll API', () => {
  it('keeps a salary above 2^53 exact all the way out of the API', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    const results = bodyOf<PageBody<ResultItem>>(
      await request(http).get(`/api/v1/payroll/runs/${runId}/results`).expect(200),
    );
    const only = results.items[0];

    // A decimal string, exact. A JSON number would read 9007199254740992 here.
    expect(only?.gross.amountMinor).toBe(ENORMOUS);
    expect(only?.net.amountMinor).toBe(ENORMOUS);
    expect(only?.gross.currencyExponent).toBe(3);
    // And it is genuinely a string on the wire, not a number the client must not touch.
    expect(typeof only?.gross.amountMinor).toBe('string');
  });

  it('resolves literal routes before parameterised ones', async () => {
    const http = await everything();
    const ready = await configure(http);

    // If `:payrollRunId` were declared first, this would resolve to a run read and 404.
    await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .send({ payrollPeriodId: ready.payrollPeriodId })
      .expect(201);

    await request(http).get('/api/v1/payroll/dashboard').expect(200);
    await request(http).get('/api/v1/payroll/groups').expect(200);
    await request(http).get('/api/v1/payroll/periods').expect(200);
  });

  it('refuses a malformed request before it reaches a handler', async () => {
    const http = await everything();

    await request(http)
      .post('/api/v1/payroll/groups')
      .send({ code: 'BAD CODE', name: {}, payFrequency: 'fortnightly' })
      .expect(400);
  });

  it('refuses a monetary amount sent as a JSON number', async () => {
    const http = await everything();
    const ready = await configure(http);

    // 9007199254740993 as a JSON number is already 9007199254740992 by the time it parses.
    // The only safe answer is to refuse the shape rather than to round somebody's salary.
    await request(http)
      .post('/api/v1/payroll/runs/adjustments')
      .send({
        payrollRunId: await calculate(http, ready.payrollPeriodId),
        employmentId: '018fb0d2-0000-7000-8000-000000000001',
        kind: 'earning',
        code: 'late-bonus',
        payrollTreatmentCode: 'ordinary',
        amount: { amountMinor: 1000, currencyCode: 'JOD', currencyExponent: 3 },
        reasonCode: 'agreed-correction',
        note: 'A number where minor units belong.',
      })
      .expect(400);
  });
});

/**
 * **Every collection is bounded.** There is no route on this module that returns an unbounded
 * payroll result set, and a page size arriving from an untrusted edge is clamped rather than
 * trusted — `Number('abc')` is `NaN`, which compares false against every bound and would sail
 * through a naive check.
 */
describe('payroll API pagination', () => {
  const withPeriods = async (count: number): Promise<Server> => {
    const http = await everything();
    const { payrollGroupId } = bodyOf<GroupBody>(await defineGroup(http).expect(201));

    for (let month = 1; month <= count; month += 1) {
      await openPeriod(http, payrollGroupId, month);
    }
    return http;
  };

  it('returns a first page, a subsequent page and an empty page beyond the end', async () => {
    const http = await withPeriods(5);

    const page = async (query: string): Promise<PageBody<PeriodItem>> =>
      bodyOf<PageBody<PeriodItem>>(
        await request(http).get(`/api/v1/payroll/periods?${query}`).expect(200),
      );
    const first = await page('page=1&size=2');
    const second = await page('page=2&size=2');
    const beyond = await page('page=99&size=2');

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(5);
    expect(second.total).toBe(5);
    expect(beyond.items).toHaveLength(0);

    // Distinct pages, not the same page twice — an off-by-one in the offset would show here.
    const ids = (body: PageBody<PeriodItem>): string[] =>
      body.items.map((item) => item.payrollPeriodId);

    expect(ids(first)).not.toEqual(ids(second));
  });

  it('clamps an oversized page and ignores a nonsense one', async () => {
    const http = await withPeriods(3);

    const page = async (query: string): Promise<PageBody<PeriodItem>> =>
      bodyOf<PageBody<PeriodItem>>(
        await request(http).get(`/api/v1/payroll/periods?${query}`).expect(200),
      );
    const oversized = await page('size=100000');
    const nonsense = await page('size=abc');
    const negative = await page('size=-1&page=-1');

    // MAX_PAGE_SIZE, not the caller's number.
    expect(oversized.items.length).toBeLessThanOrEqual(200);
    expect(nonsense.total).toBe(3);
    expect(nonsense.items).toHaveLength(3);
    expect(negative.items).toHaveLength(3);
  });

  it('bounds the result, accounting and payment collections too', async () => {
    const http = await everything();
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    for (const route of [
      `/api/v1/payroll/runs/${runId}/results`,
      `/api/v1/payroll/runs/${runId}/accounting-output`,
      `/api/v1/payroll/runs/${runId}/payment-instructions`,
    ]) {
      const response = bodyOf<PageBody<AccountingItem>>(
        await request(http).get(`${route}?size=100000`).expect(200),
      );

      expect(response.items.length).toBeLessThanOrEqual(200);
      expect(response).toHaveProperty('total');
    }
  });
});
