import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS } from '@work/career';

import {
  CONNECTION,
  EMPLOYEE_ID,
  PEER_ID,
  POSITION_ID,
  TENANT_A,
  http,
  openCareerApi,
  permitting,
  requireDatabaseInCi,
  type CareerApiFixture,
  type PageBody,
  type ProblemBody,
  type SuccessionDetailBody,
} from './career-api.fixture.js';
import {
  BASE,
  aCareerPlan,
  aReadinessLevel,
  aSuccessionPlan,
  post,
} from './career-api-scenario.js';

/**
 * Two requests that arrive together, and the routes that do not exist.
 *
 * **A stale write is refused by the database, and it is a 409.** The version travels in the request
 * body, into the command, and into the `where` clause of the `update` itself — not into a read
 * before it. Two requests that both read version 1 cannot both apply, and the loser is told the row
 * moved on rather than being told to report a bug.
 *
 * **A retry is not a race.** Nominating the same person twice is somebody clicking twice: both
 * requests succeed, both name the same nomination, and the bench has one name on it. Convergence and
 * conflict are different outcomes for different situations, and collapsing either into the other
 * would be wrong in a way a review would notice a year later.
 *
 * **The absences are asserted rather than described.** Each route below is the natural shape of a
 * capability this product does not have — evidence documents, scheduled reviews, notification
 * delivery, analytics, critical-position enumeration, executing a recommendation. A route answering
 * anything but a refusal would be a promise the product cannot keep.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API concurrency suite');

suite('career API concurrency and absences', () => {
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

  describe('optimistic concurrency, over HTTP', () => {
    /**
     * Two requests, one version, one winner.
     *
     * Both read version 1 and both ask to move the same plan. The version travels into the `where`
     * clause of the `update` itself, so the loser's write matches no row and the repository raises
     * `ConcurrencyException` — which the shared Problem Details filter turns into a 409. Nothing is
     * seeded: the plan was created over HTTP, and the final state is read back the same way.
     */
    it('applies exactly one of two moves issued from the same version, and answers 409 to the other', async () => {
      const careerPlanId = await aCareerPlan(application);
      const move = (to: string) =>
        http(application)
          .post(`${BASE}/plans/${careerPlanId}/status`)
          .send({ to, expectedVersion: 1 });

      const [first, second] = await Promise.all([move('active'), move('abandoned')]);
      const statuses = [first.status, second.status].sort((left, right) => left - right);

      expect(statuses).toEqual([201, 409]);

      const loser = first.status === 409 ? first : second;

      expect((loser.body as ProblemBody).detail).toContain('changed since it was read');

      // And the version moved exactly once. A second successful write would have made it 3.
      const page = (await http(application).get(`${BASE}/plans`).expect(200)).body as PageBody<{
        readonly version: number;
        readonly status: string;
      }>;

      expect(page.items[0]?.version).toBe(2);
      expect(['active', 'abandoned']).toContain(page.items[0]?.status);
    });

    it('refuses a stale version outright, and the same request succeeds once it is current', async () => {
      const successionPlanId = await aSuccessionPlan(application);

      // A bench with nobody on it does not activate; the nomination is what makes the first write
      // succeed, so the second one is stale for the reason under test rather than for another.
      await post(application, `${BASE}/succession-plans/${successionPlanId}/successors`, {
        employmentId: EMPLOYEE_ID,
      });
      await post(application, `${BASE}/succession-plans/${successionPlanId}/activation`, {
        expectedVersion: 1,
      });

      const stale = await http(application)
        .post(`${BASE}/succession-plans/${successionPlanId}/archive`)
        .send({ expectedVersion: 1 })
        .expect(409);

      expect((stale.body as ProblemBody).status).toBe(409);

      await http(application)
        .post(`${BASE}/succession-plans/${successionPlanId}/archive`)
        .send({ expectedVersion: 2 })
        .expect(201);
    });

    /** Convergence, not conflict: the same nomination twice is somebody clicking twice. */
    it('converges when the same nomination is issued twice at once', async () => {
      const successionPlanId = await aSuccessionPlan(application);
      const nominate = () =>
        http(application)
          .post(`${BASE}/succession-plans/${successionPlanId}/successors`)
          .send({ employmentId: EMPLOYEE_ID });

      const [first, second] = await Promise.all([nominate(), nominate()]);

      expect([first.status, second.status]).toEqual([201, 201]);

      const bodies = [first.body, second.body] as { successorId: string; created: boolean }[];

      // One created it; both name it. The bench has one name on it, which is the only answer a
      // succession review can act on.
      expect(bodies.filter((body) => body.created)).toHaveLength(1);
      expect(bodies[0]?.successorId).toBe(bodies[1]?.successorId);

      const read = await http(application)
        .get(`${BASE}/succession-plans/${successionPlanId}`)
        .expect(200);

      expect((read.body as SuccessionDetailBody).successors).toHaveLength(1);
    });

    it('keeps two different nominees when both are nominated at once', async () => {
      const successionPlanId = await aSuccessionPlan(application);
      const nominate = (employmentId: string) =>
        http(application)
          .post(`${BASE}/succession-plans/${successionPlanId}/successors`)
          .send({ employmentId });

      await Promise.all([nominate(EMPLOYEE_ID), nominate(PEER_ID)]);

      const read = await http(application)
        .get(`${BASE}/succession-plans/${successionPlanId}`)
        .expect(200);
      const { successors } = read.body as SuccessionDetailBody;

      expect(successors.map((held) => held.employmentId).sort()).toEqual(
        [EMPLOYEE_ID, PEER_ID].sort(),
      );
    });
  });

  describe('what the API does not offer', () => {
    /**
     * The absences, asserted rather than described.
     *
     * Each of these would be the natural shape of a capability this product does not have, and a
     * route answering anything but 404 or 405 would be a promise it cannot keep.
     */
    it.each([
      ['post', `${BASE}/readiness/assessments/evidence`],
      ['post', `${BASE}/development-plans/documents`],
      ['get', `${BASE}/succession-plans/critical-positions`],
      ['get', `${BASE}/analytics/bench-strength`],
      ['post', `${BASE}/mobility-recommendations/execute`],
      ['post', `${BASE}/succession-plans/reviews/schedule`],
      ['post', `${BASE}/notifications`],
    ])('publishes no %s %s', async (method, route) => {
      const response =
        method === 'post'
          ? await http(application).post(route).send({})
          : await http(application).get(route);

      expect([route, response.status < 400]).toEqual([route, false]);
    });

    it('offers no route that mutates a readiness assessment once it is written', async () => {
      const readinessLevelId = await aReadinessLevel(application);
      const successionPlanId = await aSuccessionPlan(application);
      const recorded = await post(application, `${BASE}/readiness/assessments`, {
        employmentId: EMPLOYEE_ID,
        readinessLevelId,
        successionPlanId,
        assessedOn: '2026-06-01',
      });
      const assessmentId = recorded.readinessAssessmentId ?? '';

      // Issued one at a time. `supertest` binds an ephemeral server per request, so building three
      // up front and awaiting them afterwards races the listener and fails with ECONNREFUSED —
      // which would look like a route that existed and then vanished.
      const patched = await http(application)
        .patch(`${BASE}/readiness/assessments/${assessmentId}`)
        .send({});
      const put = await http(application)
        .put(`${BASE}/readiness/assessments/${assessmentId}`)
        .send({});
      const deleted = await http(application).delete(
        `${BASE}/readiness/assessments/${assessmentId}`,
      );

      for (const response of [patched, put, deleted]) {
        expect(response.status).toBeGreaterThanOrEqual(400);
      }
    });

    it('has no route that names a position by anything but its identifier', async () => {
      // A criticality filter is the shape D-4 would need. It is refused as an undeclared property
      // on a write, and ignored — never honoured — as an unknown filter on a read.
      await http(application)
        .post(`${BASE}/succession-plans`)
        .send({ positionId: POSITION_ID, criticality: 'critical' })
        .expect(400);

      const filtered = await http(application)
        .get(`${BASE}/succession-plans?criticality=critical`)
        .expect(200);

      expect((filtered.body as PageBody<unknown>).total).toBe(0);
    });
  });
});
