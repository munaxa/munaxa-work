import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS } from '@work/career';

import {
  CONNECTION,
  EMPLOYEE_ID,
  HR,
  POSITION_ID,
  TENANT_A,
  TENANT_B,
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
  aPublishedPath,
  aReadinessLevel,
  aRecommendation,
  aSuccessionPlan,
  aTalentPool,
  anActiveDevelopmentPlan,
  post,
} from './career-api-scenario.js';

/**
 * Two tenants holding **the same upstream identifiers**, over HTTP, under an unprivileged role.
 *
 * Both tenants have an employment called `EMPLOYEE_ID`, a position called `POSITION_ID` and an
 * assignment called `ASSIGNMENT_ID`. That is the whole point of the fixture: a suite whose tenants
 * held different values would pass whether or not the boundary worked, because every read would be
 * scoped by the value rather than by the tenant. Here the value is identical, so only the tenant can
 * be doing the separating.
 *
 * Four distinct questions, because "tenant B sees no rows" answers only the first:
 * a collection's **items**, a collection's **total**, an **exact-identifier** read, and a
 * **mutation** naming a foreign record. A count computed without the tenant predicate leaks how many
 * succession benches exist elsewhere even when no row comes back, and a 403 on an exact identifier
 * confirms the record exists — which for a bench is most of the secret.
 *
 * The role assertion this rests on is in `career.security.spec.ts`: neither SUPERUSER nor BYPASSRLS,
 * with row-level security enabled and forced on all twelve tables.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API tenancy suite');

suite('career API tenancy', () => {
  let fixture: CareerApiFixture;

  beforeAll(async () => {
    fixture = await openCareerApi();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const asTenant = (tenantId: string, actor = HR): Promise<INestApplication> =>
    fixture.applicationFor(tenantId, permitting(...ALL_CAREER_PERMISSIONS), actor);

  describe('two tenants holding the same upstream identifiers', () => {
    /** Everything tenant A owns, built over HTTP, so tenant B can be asked about all of it. */
    const aFullTenant = async (application: INestApplication): Promise<Record<string, string>> => {
      const pathId = await aPublishedPath(application);
      const careerPlanId = await aCareerPlan(application);
      const talentPoolId = await aTalentPool(application);
      const successionPlanId = await aSuccessionPlan(application);
      const readinessLevelId = await aReadinessLevel(application);
      const developmentPlanId = await anActiveDevelopmentPlan(application);
      const mobilityRecommendationId = await aRecommendation(application);

      await post(application, `${BASE}/pools/${talentPoolId}/memberships`, {
        employmentId: EMPLOYEE_ID,
        from: '2026-04-01',
      });
      await post(application, `${BASE}/succession-plans/${successionPlanId}/successors`, {
        employmentId: EMPLOYEE_ID,
      });
      // Readiness is always readiness *for* something — the application refuses an assessment that
      // names neither a position nor a bench, because "ready" on its own says nothing actionable.
      await post(application, `${BASE}/readiness/assessments`, {
        employmentId: EMPLOYEE_ID,
        readinessLevelId,
        successionPlanId,
        assessedOn: '2026-06-01',
      });

      return {
        pathId,
        careerPlanId,
        talentPoolId,
        successionPlanId,
        developmentPlanId,
        mobilityRecommendationId,
      };
    };

    it('shows neither tenant the other’s collections — nor their totals', async () => {
      const first = await asTenant(TENANT_A);

      await aFullTenant(first);

      const second = await asTenant(TENANT_B);

      for (const collection of [
        'paths',
        'plans',
        'pools',
        'pool-memberships',
        'succession-plans',
        'mobility-recommendations',
      ]) {
        const body = (await http(second).get(`${BASE}/${collection}`).expect(200))
          .body as PageBody<unknown>;

        // Not merely "no items": the totals must be zero too. A count computed without the tenant
        // predicate leaks how many succession benches exist elsewhere even when no row comes back.
        expect([collection, body.items, body.total]).toEqual([collection, [], 0]);
      }
    });

    it('answers 404 — never 403 — when the other tenant names a record by its exact identifier', async () => {
      const first = await asTenant(TENANT_A);
      const owned = await aFullTenant(first);
      const second = await asTenant(TENANT_B);

      for (const [route, identifier] of [
        [`${BASE}/paths`, owned['pathId']],
        [`${BASE}/succession-plans`, owned['successionPlanId']],
        [`${BASE}/development-plans`, owned['developmentPlanId']],
      ] as const) {
        // 403 would confirm the record exists, which for a succession bench is most of the secret.
        const response = await http(second).get(`${route}/${identifier ?? ''}`);

        expect([route, response.status]).toEqual([route, 404]);
      }
    });

    it('shows the other tenant an empty readiness history and summary for the same person', async () => {
      const first = await asTenant(TENANT_A);

      await aFullTenant(first);

      const second = await asTenant(TENANT_B);
      const history = await http(second)
        .get(`${BASE}/readiness/history/${EMPLOYEE_ID}`)
        .expect(200);
      const summary = await http(second).get(`${BASE}/summary/${EMPLOYEE_ID}`).expect(200);

      // The same employment identifier exists in both tenants, deliberately. What tenant B may read
      // about that person is what tenant B recorded, which is nothing.
      expect((history.body as { readonly assessments: readonly unknown[] }).assessments).toEqual(
        [],
      );
      expect(JSON.stringify(summary.body)).not.toContain('"readinessLevelId"');
    });

    it('leaves the other tenant’s record untouched when a mutation names it', async () => {
      const first = await asTenant(TENANT_A);
      const owned = await aFullTenant(first);
      const second = await asTenant(TENANT_B);

      const attempted = await http(second)
        .post(`${BASE}/succession-plans/${owned['successionPlanId'] ?? ''}/activation`)
        .send({ expectedVersion: 1 });

      expect(attempted.status).toBe(404);

      // And the plan is exactly as tenant A left it: still draft, still at version 1.
      const after = await http(first)
        .get(`${BASE}/succession-plans/${owned['successionPlanId'] ?? ''}`)
        .expect(200);
      const { plan } = after.body as SuccessionDetailBody;

      expect([plan.status, plan.version]).toEqual(['draft', 1]);
    });

    it('refuses an upstream identifier that is real only in the other tenant', async () => {
      const first = await asTenant(TENANT_A);

      // The position exists in tenant B and, for this test, nowhere else. Naming it from tenant A
      // asks Organization inside tenant A's context, and Organization answers for tenant A.
      fixture.facts.positions = fixture.facts.positions.filter(
        (held) => !(held.positionId === POSITION_ID && held.tenantId === TENANT_A),
      );

      const refused = await http(first)
        .post(`${BASE}/succession-plans`)
        .send({ positionId: POSITION_ID })
        .expect(422);

      expect((refused.body as ProblemBody).detail).toBe('career.rejection.position-not-found');

      const second = await asTenant(TENANT_B);

      await http(second)
        .post(`${BASE}/succession-plans`)
        .send({ positionId: POSITION_ID })
        .expect(201);
    });
  });
});
