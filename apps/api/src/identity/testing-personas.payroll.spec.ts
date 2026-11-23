import 'reflect-metadata';

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { currentContext, isSystemContext, type PermissionChecker } from '@work/kernel';
import { afterEach, describe, expect, it } from 'vitest';

import {
  APPROVER,
  REQUESTER,
  applicationWith,
  calculate,
  configure,
  defineGroup,
} from '../payroll/payroll-api-harness.js';

import { workGrantsFrom } from './platform-grants.js';
import { WORK_PERMISSION_CATALOGUE } from './work-permission-catalogue.js';

/**
 * The payroll personas at the HTTP edge (MW-003): the separation of duties the Testing roles are
 * built around, proved on the real payroll controllers and pipeline rather than on a table.
 *
 * Two people act in one scenario. The preparer configures and calculates a run with exactly the
 * grants Identity seeds for `work-testing-payroll-preparer`; the approver approves and finalizes it
 * with exactly those of `work-testing-payroll-approver`. Each is refused the other's half.
 */

interface Persona {
  readonly key: string;
  readonly grants: readonly string[];
}

const FIXTURE = 'apps/api/src/identity/testing-personas.fixture.json';

const fixturePath = (): string => {
  let directory = process.cwd();

  while (!existsSync(resolve(directory, FIXTURE))) {
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Could not find ${FIXTURE} above the working directory.`);
    directory = parent;
  }
  return resolve(directory, FIXTURE);
};

const PERSONAS = JSON.parse(readFileSync(fixturePath(), 'utf8')) as readonly Persona[];

const grantsOf = (key: string): ReadonlySet<string> => {
  const found = PERSONAS.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`No persona ${key} in the fixture.`);
  return workGrantsFrom(found.grants, WORK_PERMISSION_CATALOGUE);
};

/** The harness's two actors, each holding exactly one persona's grants. */
const BY_ACTOR: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  [REQUESTER, grantsOf('work-testing-payroll-preparer')],
  [APPROVER, grantsOf('work-testing-payroll-approver')],
]);

const asPersonas: PermissionChecker = {
  holds: (permission) => {
    const context = currentContext();

    if (context === undefined || isSystemContext(context) || !('actor' in context)) {
      return Promise.resolve(false);
    }
    return Promise.resolve(BY_ACTOR.get(context.actor)?.has(permission) ?? false);
  },
};

let open: INestApplication | undefined;

afterEach(async () => {
  await open?.close();
  open = undefined;
});

const server = async (): Promise<Server> => {
  open = await applicationWith(asPersonas, { actor: REQUESTER });
  return open.getHttpServer() as Server;
};

describe('the payroll preparer and approver personas', () => {
  it('let the preparer prepare and only the approver decide', async () => {
    const http = await server();

    // The preparer's job: configuration and calculation.
    const ready = await configure(http);
    const runId = await calculate(http, ready.payrollPeriodId);

    // And nothing past it: not approval, finalization, the payment file or reversal.
    await request(http).post(`/api/v1/payroll/runs/${runId}/approval`).send({}).expect(403);
    await request(http).post(`/api/v1/payroll/runs/${runId}/finalization`).expect(403);
    await request(http).get(`/api/v1/payroll/runs/${runId}/payment-instructions`).expect(403);

    // The approver decides the run the preparer calculated.
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/approval`)
      .set('x-test-actor', APPROVER)
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/payroll/runs/${runId}/finalization`)
      .set('x-test-actor', APPROVER)
      .expect(201);

    // The preparer still cannot reverse what was finalized.
    await request(http).post(`/api/v1/payroll/runs/${runId}/reversal`).send({}).expect(403);
  });

  it('refuse the approver every preparation route', async () => {
    const http = await server();
    const ready = await configure(http);

    await defineGroup(http, 'approver-group').set('x-test-actor', APPROVER).expect(403);
    await request(http)
      .post('/api/v1/payroll/runs/calculation')
      .set('x-test-actor', APPROVER)
      .send({ payrollPeriodId: ready.payrollPeriodId })
      .expect(403);
  });
});
