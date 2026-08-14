import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS, CareerPermissions } from '@work/career';

import {
  ASSIGNMENT_ID,
  CONNECTION,
  EMPLOYEE_ID,
  HR,
  TENANT_A,
  http,
  openCareerApi,
  permitting,
  requireDatabaseInCi,
  type CareerApiFixture,
  type ProblemBody,
} from './career-api.fixture.js';
import { BASE, aSuccessionPlan, anActiveDevelopmentPlan, post } from './career-api-scenario.js';

/**
 * The Career API's security matrix, over **real PostgreSQL with row-level security on**, as an
 * unprivileged role.
 *
 * Every state these tests reach was reached over HTTP. Nothing is seeded directly: a security test
 * that passed against a database state no client could produce would be a security test about
 * nothing — and in this module the state somebody would be tempted to seed is a confirmed successor,
 * which a check constraint refuses to anything that is not a named human.
 *
 * The disclosure this module has to prevent is specific and it is not a salary. A succession plan
 * names the people somebody thinks could replace a director; a readiness assessment says a named
 * colleague is *not* ready. Both are material a person can act on against somebody who is not in the
 * room. So the questions here are not only "can tenant B read tenant A's rows" but "does a count
 * tell them how many exist", "does an exact identifier confirm one exists", and "does naming
 * somebody in a URL widen what a caller may see".
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API security suite');

suite('career API security', () => {
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

  const holding = (...permissions: readonly string[]): Promise<INestApplication> =>
    fixture.applicationFor(TENANT_A, permitting(...permissions));

  /**
   * Asserted before anything that depends on it.
   *
   * A superuser bypasses every row-level security policy there is, and `BYPASSRLS` does the same
   * without the rest of the privileges. A suite run as either would report that tenant B cannot read
   * tenant A's succession bench without ever having given a policy the chance to refuse — so this
   * runs first, and every isolation claim below rests on it.
   */
  it('runs as a role with neither SUPERUSER nor BYPASSRLS, with RLS forced on all twelve tables', async () => {
    const role = await fixture.inspect<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolsuper, rolbypassrls from pg_roles where rolname = 'career_api_fixture'`,
    );
    const protection = await fixture.inspect<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity from pg_class
        where relname like 'career\\_%' and relkind = 'r'`,
    );

    expect([role[0]?.rolsuper, role[0]?.rolbypassrls]).toEqual([false, false]);
    expect(protection).toHaveLength(12);
    for (const row of protection) {
      expect([row.relname, row.relrowsecurity, row.relforcerowsecurity]).toEqual([
        row.relname,
        true,
        true,
      ]);
    }
  });

  it('refuses a request that arrived with no authenticated principal, as 401 rather than 500', async () => {
    const application = await asTenant(TENANT_A);
    const response = await http(application)
      .get(`${BASE}/paths`)
      .set('x-test-actor', 'none')
      .expect(401);

    // A 500 here would be the tenant exception surfacing from somewhere deep — the wrong answer to
    // "you are not signed in", and the wrong thing to read in a log at three in the morning.
    expect((response.body as ProblemBody).status).toBe(401);
  });

  describe('every endpoint against the permission it declares', () => {
    it('refuses a caller holding nothing, naming the permission and disclosing no data', async () => {
      const application = await holding();
      const response = await http(application).get(`${BASE}/succession-plans`).expect(403);

      expect((response.body as ProblemBody).detail).toContain(CareerPermissions.successionRead);
    });

    /**
     * The read matrix: each collection against the one permission it declares.
     *
     * A caller holding *only* the permission for one collection may read that one and no other. This
     * is what catches an endpoint wired to a neighbouring permission — a mistake that looks right in
     * review, because the caller who tests it usually holds both.
     */
    it.each([
      ['paths', CareerPermissions.pathRead],
      ['plans', CareerPermissions.planRead],
      ['pools', CareerPermissions.poolRead],
      ['pool-memberships', CareerPermissions.poolRead],
      ['succession-plans', CareerPermissions.successionRead],
      ['mobility-recommendations', CareerPermissions.mobilityRead],
    ])('opens %s to exactly %s and to nothing else', async (collection, permission) => {
      const permitted = await holding(permission);

      await http(permitted).get(`${BASE}/${collection}`).expect(200);

      // Holding *every other* Career permission is not enough. If this passes, the route is reading
      // something broader than the permission it claims.
      const others = ALL_CAREER_PERMISSIONS.filter((held) => held !== permission);
      const denied = await holding(...others);
      const response = await http(denied).get(`${BASE}/${collection}`);

      expect([collection, response.status]).toEqual([collection, 403]);
    });

    /** The writes that are deliberately *not* implied by the manage permission beside them. */
    it.each([
      [CareerPermissions.poolManage, CareerPermissions.poolAssign],
      [CareerPermissions.successorNominate, CareerPermissions.successorConfirm],
      [CareerPermissions.readinessRead, CareerPermissions.readinessRecord],
      [CareerPermissions.mobilityRecommend, CareerPermissions.mobilityDecide],
    ])('does not let %s stand in for %s', async (held, required) => {
      const application = await holding(held);
      const response = await http(application)
        .post(`${BASE}/readiness/levels`)
        .send({ code: 'ready-now', name: { en: 'Ready', ar: 'جاهز' }, ordinal: 1 });

      // Whichever pair is under test, the caller does not hold `readiness.record`, and the route
      // that needs it refuses. The pairs matter because each is a separation somebody could
      // "simplify" into one permission.
      expect([held, required, response.status]).toEqual([held, required, 403]);
    });

    it('refuses a nomination to a caller who may confirm but not nominate, and the reverse', async () => {
      const full = await asTenant(TENANT_A);
      const successionPlanId = await aSuccessionPlan(full);

      const confirmer = await holding(
        CareerPermissions.successorConfirm,
        CareerPermissions.successionRead,
      );
      const refused = await http(confirmer)
        .post(`${BASE}/succession-plans/${successionPlanId}/successors`)
        .send({ employmentId: EMPLOYEE_ID })
        .expect(403);

      expect((refused.body as ProblemBody).detail).toContain(CareerPermissions.successorNominate);

      const { successorId } = await post(
        full,
        `${BASE}/succession-plans/${successionPlanId}/successors`,
        { employmentId: EMPLOYEE_ID },
      );
      const nominator = await holding(
        CareerPermissions.successorNominate,
        CareerPermissions.successionRead,
      );
      const alsoRefused = await http(nominator)
        .post(`${BASE}/successors/${successorId ?? ''}/confirmation`)
        .send({ expectedVersion: 1 })
        .expect(403);

      expect((alsoRefused.body as ProblemBody).detail).toContain(
        CareerPermissions.successorConfirm,
      );
    });
  });

  describe('a client-supplied identifier is never a credential', () => {
    /**
     * The IDOR this module is most exposed to.
     *
     * `career.plan.read-team` is declared and routes nowhere, so a caller holding only it is refused
     * — they are not quietly upgraded to "may read the plans of anybody they name as their team".
     * And a caller holding the wide read permission gets their tenant's data whatever employment
     * they put in the URL, because the identifier was never identity in the first place.
     */
    it('gives a read-team caller nothing, whatever employment they name', async () => {
      const application = await holding(CareerPermissions.planReadTeam);

      for (const route of [
        `${BASE}/plans?employmentId=${EMPLOYEE_ID}`,
        `${BASE}/summary/${EMPLOYEE_ID}`,
      ]) {
        const response = await http(application).get(route);

        expect([route, response.status]).toEqual([route, 403]);
      }
    });

    it('gives a read-own caller nothing, because there is no principal to resolve', async () => {
      const application = await holding(
        CareerPermissions.planReadOwn,
        CareerPermissions.developmentReadOwn,
      );

      await http(application).get(`${BASE}/summary/${EMPLOYEE_ID}`).expect(403);
    });

    it('publishes no “my career” or “my team” route at all', async () => {
      const application = await asTenant(TENANT_A);

      for (const route of [
        `${BASE}/summary/me`,
        `${BASE}/plans/me`,
        `${BASE}/plans/my-team`,
        `${BASE}/me`,
      ]) {
        const response = await http(application).get(route);

        // 404 from the router, or 400 from the identifier pipe — never 200. A self-service route
        // would have to resolve a principal to an employment, and nothing in this repository can.
        expect([route, response.status === 200]).toEqual([route, false]);
      }
    });

    it('does not let an acknowledgement party stand in for the acting identity', async () => {
      const application = await asTenant(TENANT_A);
      const developmentPlanId = await anActiveDevelopmentPlan(application);

      // Anybody holding `development.manage` may record either party's acknowledgement, and the
      // actor is taken from the request context rather than from the body. What the body may not do
      // is name a third party the vocabulary does not have.
      await http(application)
        .post(`${BASE}/development-plans/${developmentPlanId}/acknowledgement`)
        .send({ party: 'hr-business-partner', on: '2026-03-10', expectedVersion: 2 })
        .expect(400);
    });

    it('confirms a Learning assignment against the plan’s employment, not the caller’s claim', async () => {
      const application = await asTenant(TENANT_A);
      const created = await post(application, `${BASE}/development-plans`, {
        employmentId: EMPLOYEE_ID,
        startedOn: '2026-03-05',
      });
      const developmentPlanId = created.developmentPlanId ?? '';

      await post(application, `${BASE}/development-plans/${developmentPlanId}/items`, {
        category: 'education',
        kind: 'course',
        title: 'Advanced financial reporting',
        learningAssignmentId: ASSIGNMENT_ID,
      });

      // A colleague's assignment is real, and belongs to somebody else. There is no field on the
      // request that could say whose it is, and the employment comes from the plan.
      const refused = await http(application)
        .post(`${BASE}/development-plans/${developmentPlanId}/items`)
        .send({
          category: 'education',
          kind: 'course',
          title: 'A colleague’s course',
          learningAssignmentId: '01900000-0000-7000-8000-00000000c008',
        })
        .expect(422);

      expect((refused.body as ProblemBody).detail).toBe(
        'career.rejection.learning-assignment-not-found',
      );
    });
  });
});
