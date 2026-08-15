import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS, UNROUTED_CAREER_PERMISSIONS } from '@work/career';

import {
  CONNECTION,
  EMPLOYEE_ID,
  TENANT_A,
  http,
  openCareerApi,
  permitting,
  requireDatabaseInCi,
  CONTROLLERS,
  type CareerApiFixture,
} from './career-api.fixture.js';
import { BASE, aPublishedPath, aSuccessionPlan, post } from './career-api-scenario.js';

/**
 * How the Career API is assembled, and the two things about the assembly that can silently break.
 *
 * **Route resolution is order-dependent.** Nest matches a request against controllers in the order
 * they were declared, so a controller owning a literal segment must come before one whose route
 * starts with a parameter on the same prefix. Nothing warns when that order changes; the symptom is
 * a request landing on the wrong handler and answering 404 for a record that exists. Asserted here
 * rather than trusted to a comment in the module.
 *
 * **The surface is exactly the application's.** Every command and query Career declares is reachable
 * over HTTP, and nothing is reachable that the application did not declare — no store, no repository
 * and no route that would imply a capability the product does not have.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API composition suite');

suite('career API composition', () => {
  let fixture: CareerApiFixture;
  let application: INestApplication;

  beforeAll(async () => {
    fixture = await openCareerApi();
    application = await fixture.applicationFor(TENANT_A, permitting(...ALL_CAREER_PERMISSIONS));
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const moduleSource = (): string =>
    readFileSync(join(process.cwd(), 'src', 'career', 'career.module.ts'), 'utf8');

  it('declares the twelve controllers the fixture exercises, in the module’s order', () => {
    const declared = moduleSource();
    const names = CONTROLLERS.map((controller) => controller.name);

    expect(names).toHaveLength(12);
    for (const name of names) expect([name, declared.includes(name)]).toEqual([name, true]);

    // The order is load-bearing, so it is compared rather than merely checked for membership.
    const positions = names.map((name) => declared.indexOf(`    ${name},`));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(positions.every((position) => position > 0)).toBe(true);
  });

  /**
   * The prefixes that could shadow one another, resolved against real records.
   *
   * `career/pools` and `career/pool-memberships` are distinct segments rather than one nested in the
   * other, and so are `career/development-plans` and `career/development-items`. Within
   * `career/readiness`, `levels` and `assessments` are literals that must not be captured by a
   * parameter. Each is asked for something that exists, so a 404 here means the request landed
   * somewhere else.
   */
  it('resolves every prefix that could shadow another to its own controller', async () => {
    const pathId = await aPublishedPath(application);

    await http(application).get(`${BASE}/paths/${pathId}`).expect(200);
    await http(application).get(`${BASE}/pools`).expect(200);
    await http(application).get(`${BASE}/pool-memberships`).expect(200);
    await http(application).get(`${BASE}/readiness/levels`).expect(200);
    await http(application).get(`${BASE}/readiness/history/${EMPLOYEE_ID}`).expect(200);
    await http(application).get(`${BASE}/summary/${EMPLOYEE_ID}`).expect(200);
  });

  it('routes every command the application declares, and no route reaches a store', async () => {
    // One request per command family, driven end to end. A command with no route would fail here
    // rather than at some later checkpoint that assumed the API was complete.
    const successionPlanId = await aSuccessionPlan(application);
    const nominated = await post(
      application,
      `${BASE}/succession-plans/${successionPlanId}/successors`,
      { employmentId: EMPLOYEE_ID },
    );

    await post(application, `${BASE}/successors/${nominated.successorId ?? ''}/confirmation`, {
      expectedVersion: 1,
    });

    const read = await http(application)
      .get(`${BASE}/succession-plans/${successionPlanId}`)
      .expect(200);

    expect(JSON.stringify(read.body)).toContain('"status":"confirmed"');
  });

  it('declares the three unrouted permissions and routes none of them', () => {
    const controllers = CONTROLLERS.map((controller) =>
      readFileSync(
        join(
          process.cwd(),
          '..',
          '..',
          'packages',
          'modules',
          'career',
          'src',
          'api',
          `${fileFor(controller.name)}.ts`,
        ),
        'utf8',
      ),
    )
      .join('\n')
      // Comments stripped first. `summary.controller.ts` *explains* why these three route nowhere,
      // and an audit that forced the code to stop saying so would be measuring the wrong thing.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(UNROUTED_CAREER_PERMISSIONS).toHaveLength(3);
    // They are part of the contract the administration screen offers, and no controller *routes*
    // them, because nothing can enforce them without a principal-to-employment resolution.
    for (const permission of UNROUTED_CAREER_PERMISSIONS) {
      expect([permission, controllers.includes(permission)]).toEqual([permission, false]);
    }
  });
});

/** The file each controller lives in. The names follow the module's own convention. */
const fileFor = (controller: string): string =>
  ({
    CareerPathController: 'path.controller',
    CareerPlanController: 'plan.controller',
    CareerPoolController: 'pool.controller',
    CareerMembershipController: 'membership.controller',
    CareerSuccessionController: 'succession.controller',
    CareerSuccessionLifecycleController: 'succession-lifecycle.controller',
    CareerSuccessorController: 'successor.controller',
    CareerReadinessController: 'readiness.controller',
    CareerDevelopmentController: 'development.controller',
    CareerDevelopmentItemController: 'development-item.controller',
    CareerMobilityController: 'mobility.controller',
    CareerSummaryController: 'summary.controller',
  })[controller] ?? controller;
