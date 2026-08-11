import 'reflect-metadata';

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PayrollPermissions } from '@work/payroll';
import { afterEach, describe, expect, it } from 'vitest';

import {
  ALL,
  applicationWith,
  calculate,
  configure,
  defineGroup,
  permitting,
} from './payroll-api-harness.js';

/**
 * **Authorization at the API, which is the authoritative one.**
 *
 * No permission is enforced by a guard on a controller class. Each application handler declares the
 * permission it requires and the kernel's pipeline enforces it before the handler runs, so the HTTP
 * edge cannot widen access by forgetting a decorator — and cannot narrow it either. These tests
 * exist to prove the edge did not quietly acquire a second opinion.
 *
 * The separation that matters most is `payroll.read` against `payroll.read-result`. The first sees
 * that a run covered 1,400 people; the second sees what a named person was paid. Collapsing them
 * would make every payroll administrator a reader of every salary in the company. The accounting
 * and payment exports are separate again, and from each other: a full payroll accounting export is
 * a full salary list by another name.
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

describe('payroll API authorization', () => {
  it('refuses a caller without the permission the operation requires', async () => {
    const http = server(await applicationWith(permitting(PayrollPermissions.read)));

    await defineGroup(http).expect(403);
  });

  it('refuses an unauthenticated caller before any permission is consulted', async () => {
    // Every permission granted, and still refused: there is no authenticated identity to grant to.
    const http = server(await applicationWith(permitting(...ALL), { actor: undefined }));

    const denied = await request(http).get('/api/v1/payroll/dashboard');
    const deniedWrite = await defineGroup(http);

    expect(denied.status).toBeGreaterThanOrEqual(401);
    expect(denied.status).toBeLessThan(404);
    expect(deniedWrite.status).toBeGreaterThanOrEqual(401);
    expect(deniedWrite.status).toBeLessThan(404);
  });

  it('separates payroll.read from payroll.read-result', async () => {
    const readOnly = server(
      await applicationWith(
        permitting(
          PayrollPermissions.read,
          PayrollPermissions.calculate,
          PayrollPermissions.manage,
        ),
      ),
    );
    const ready = await configure(readOnly);
    const runId = await calculate(readOnly, ready.payrollPeriodId);

    // The run is visible; the figures are not.
    await request(readOnly).get(`/api/v1/payroll/runs/${runId}`).expect(200);
    await request(readOnly).get(`/api/v1/payroll/runs/${runId}/results`).expect(403);
  });

  it('holds the accounting and payment outputs behind their own permissions', async () => {
    const http = server(
      await applicationWith(
        permitting(
          PayrollPermissions.read,
          PayrollPermissions.manage,
          PayrollPermissions.calculate,
          PayrollPermissions.readResult,
        ),
      ),
    );
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    // Reading every salary is not the same as reading the journal that totals them, and neither
    // is the same as reading the file that would pay them.
    await request(http).get(`/api/v1/payroll/runs/${runId}/accounting-output`).expect(403);
    await request(http).get(`/api/v1/payroll/runs/${runId}/payment-instructions`).expect(403);
  });

  it('holds an adjustment reason behind payroll.adjust, not payroll.read', async () => {
    const http = server(
      await applicationWith(
        permitting(
          PayrollPermissions.read,
          PayrollPermissions.manage,
          PayrollPermissions.calculate,
        ),
      ),
    );
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    // Reading a figure is not reading the sentence somebody wrote about why it changed.
    await request(http).get(`/api/v1/payroll/runs/${runId}/adjustments`).expect(200);
    await request(http).get(`/api/v1/payroll/runs/${runId}/adjustment-reasons`).expect(403);
  });

  it('refuses each decision route to a caller holding only the neighbouring permission', async () => {
    const http = server(
      await applicationWith(
        permitting(
          PayrollPermissions.read,
          PayrollPermissions.manage,
          PayrollPermissions.calculate,
          PayrollPermissions.readResult,
        ),
      ),
    );
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    // Calculating a payroll does not entitle anybody to approve one, finalize one or reverse one.
    await request(http).post(`/api/v1/payroll/runs/${runId}/approval`).send({}).expect(403);
    await request(http).post(`/api/v1/payroll/runs/${runId}/finalization`).expect(403);
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/reversal`)
      .send({ reasonCode: 'incorrect-input' })
      .expect(403);
  });

  it('does not disclose another payroll run through a not-found', async () => {
    const http = server(await applicationWith(permitting(...ALL)));

    await configure(http);

    // A well-formed identifier nobody in this tenant owns. "Forbidden" here would confirm that
    // somebody in this system was paid something, which is itself a disclosure.
    const missing = await request(http)
      .get('/api/v1/payroll/runs/018fb0d2-0000-7000-8000-0000000000ff')
      .expect(404);

    expect(JSON.stringify(missing.body)).not.toMatch(/tenant|exists|forbidden/i);
  });
});
