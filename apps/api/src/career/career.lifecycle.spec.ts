import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS } from '@work/career';

import {
  CONNECTION,
  EMPLOYEE_ID,
  TENANT_A,
  http,
  openCareerApi,
  permitting,
  requireDatabaseInCi,
  type CareerApiFixture,
  type DevelopmentPlanBody,
  type ProblemBody,
} from './career-api.fixture.js';
import {
  BASE,
  NAME,
  aCareerPlan,
  aPublishedPath,
  aReadinessLevel,
  aRecommendation,
  aSuccessionPlan,
  aTalentPool,
  anActiveDevelopmentPlan,
  post,
} from './career-api-scenario.js';

/**
 * What HTTP cannot do: skip a lifecycle rule, or win a race it lost.
 *
 * **A rule the application enforces must not have a way round it at the transport.** Each case below
 * drives an aggregate into a terminal or closed state over HTTP and then asks the API to do the
 * thing that state forbids. The answer must be the application's own named refusal — a 422 carrying
 * a catalogue key a portal can render — and never a 500, which would mean the rule was enforced by
 * something further down that was never asked politely.
 *
 * **A stale write is refused by the database, and it is a 409.** The version travels in the request
 * body, into the command, and into the `where` clause of the `update` itself — not into a read
 * before it. Two requests that both read version 1 cannot both apply.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API lifecycle suite');

suite('career API lifecycle', () => {
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

  const refusal = (body: unknown): string | undefined => (body as ProblemBody).detail;

  describe('a terminal state has no way round it', () => {
    it('refuses a stage on an archived path', async () => {
      const pathId = await aPublishedPath(application);

      await post(application, `${BASE}/paths/${pathId}/archive`, { expectedVersion: 2 });

      const refused = await http(application)
        .post(`${BASE}/paths/${pathId}/stages`)
        .send({ sequence: 2, name: NAME })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.path-archived');
    });

    it('refuses publishing a path that has no stages', async () => {
      const created = await post(application, `${BASE}/paths`, {
        code: 'empty',
        name: NAME,
        kind: 'management',
        effectiveFrom: '2026-01-01',
      });
      const refused = await http(application)
        .post(`${BASE}/paths/${created.pathId ?? ''}/publication`)
        .send({ expectedVersion: 1 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.path-has-no-stages');
    });

    it('refuses an illegal career-plan transition', async () => {
      const careerPlanId = await aCareerPlan(application);

      await post(application, `${BASE}/plans/${careerPlanId}/status`, {
        to: 'active',
        expectedVersion: 1,
      });
      await post(application, `${BASE}/plans/${careerPlanId}/status`, {
        to: 'archived',
        expectedVersion: 2,
      });

      const refused = await http(application)
        .post(`${BASE}/plans/${careerPlanId}/status`)
        .send({ to: 'active', expectedVersion: 3 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.plan-transition-refused');
    });

    it('refuses a new membership in a closed pool', async () => {
      const talentPoolId = await aTalentPool(application);

      await post(application, `${BASE}/pools/${talentPoolId}/closure`, { expectedVersion: 1 });

      const refused = await http(application)
        .post(`${BASE}/pools/${talentPoolId}/memberships`)
        .send({ employmentId: EMPLOYEE_ID, from: '2026-04-01' })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.pool-closed');
    });

    it('refuses activating an archived succession plan', async () => {
      const successionPlanId = await aSuccessionPlan(application);

      // A bench with nobody on it does not activate, so the plan is given a nominee first — the
      // refusal under test has to be the archival one rather than the emptiness one.
      await post(application, `${BASE}/succession-plans/${successionPlanId}/successors`, {
        employmentId: EMPLOYEE_ID,
      });
      await post(application, `${BASE}/succession-plans/${successionPlanId}/archive`, {
        expectedVersion: 1,
      });

      const refused = await http(application)
        .post(`${BASE}/succession-plans/${successionPlanId}/activation`)
        .send({ expectedVersion: 2 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.succession-transition-refused');
    });

    it('refuses confirming a withdrawn successor', async () => {
      const successionPlanId = await aSuccessionPlan(application);
      const nominated = await post(
        application,
        `${BASE}/succession-plans/${successionPlanId}/successors`,
        { employmentId: EMPLOYEE_ID },
      );
      const successorId = nominated.successorId ?? '';

      await post(application, `${BASE}/successors/${successorId}/withdrawal`, {
        reason: 'Took a role elsewhere',
        expectedVersion: 1,
      });

      const refused = await http(application)
        .post(`${BASE}/successors/${successorId}/confirmation`)
        .send({ expectedVersion: 2 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.successor-transition-refused');
    });

    /**
     * A retired level cannot be used to make a *new* statement about somebody.
     *
     * The rule lives on `record-readiness`, which is where a level becomes a claim about a named
     * person. Nominating a successor may cite a level that has since been retired — the application
     * checks only that it exists there — and that asymmetry is reported as an observation rather
     * than changed under an API checkpoint, since it is an application rule and not a transport one.
     */
    it('refuses recording readiness at a deactivated level', async () => {
      const readinessLevelId = await aReadinessLevel(application);
      const successionPlanId = await aSuccessionPlan(application);

      await post(application, `${BASE}/readiness/levels/${readinessLevelId}/deactivation`, {
        expectedVersion: 1,
      });

      const refused = await http(application)
        .post(`${BASE}/readiness/assessments`)
        .send({
          employmentId: EMPLOYEE_ID,
          readinessLevelId,
          successionPlanId,
          assessedOn: '2026-06-01',
        })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.readiness-level-not-found');
    });

    it('refuses activating a development plan with no items, then allows it once one exists', async () => {
      const created = await post(application, `${BASE}/development-plans`, {
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-05',
      });
      const developmentPlanId = created.developmentPlanId ?? '';

      const refused = await http(application)
        .post(`${BASE}/development-plans/${developmentPlanId}/status`)
        .send({ to: 'active', expectedVersion: 1 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.development-plan-has-no-items');

      await post(application, `${BASE}/development-plans/${developmentPlanId}/items`, {
        category: 'experience',
        kind: 'project',
        title: 'Lead the year-end close',
      });
      await http(application)
        .post(`${BASE}/development-plans/${developmentPlanId}/status`)
        .send({ to: 'active', expectedVersion: 1 })
        .expect(201);
    });

    it('refuses moving a completed development item back to planned', async () => {
      const developmentPlanId = await anActiveDevelopmentPlan(application);
      const read = await http(application)
        .get(`${BASE}/development-plans/${developmentPlanId}`)
        .expect(200);
      const item = (read.body as DevelopmentPlanBody).items[0];
      const itemId = item?.developmentItemId ?? '';

      // `planned → completed` is not a transition either; an item goes through `in_progress`. The
      // rule under test is the one that refuses going *back*, so the item is walked forward first.
      const version = item?.version ?? 1;

      await post(application, `${BASE}/development-items/${itemId}/status`, {
        to: 'in_progress',
        expectedVersion: version,
      });
      await post(application, `${BASE}/development-items/${itemId}/status`, {
        to: 'completed',
        expectedVersion: version + 1,
      });

      const refused = await http(application)
        .post(`${BASE}/development-items/${itemId}/status`)
        .send({ to: 'planned', expectedVersion: version + 2 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.development-item-transition-refused');
    });

    it('refuses deciding a recommendation that has already been decided', async () => {
      const mobilityRecommendationId = await aRecommendation(application);

      await post(
        application,
        `${BASE}/mobility-recommendations/${mobilityRecommendationId}/decision`,
        {
          to: 'accepted',
          expectedVersion: 1,
        },
      );

      const refused = await http(application)
        .post(`${BASE}/mobility-recommendations/${mobilityRecommendationId}/decision`)
        .send({ to: 'declined', expectedVersion: 2 })
        .expect(422);

      expect(refusal(refused.body)).toBe('career.rejection.recommendation-transition-refused');
    });

    it('refuses `expired` as a decision at the edge: it is derived, never written', async () => {
      const mobilityRecommendationId = await aRecommendation(application);

      await http(application)
        .post(`${BASE}/mobility-recommendations/${mobilityRecommendationId}/decision`)
        .send({ to: 'expired', expectedVersion: 1 })
        .expect(400);
    });
  });
});
