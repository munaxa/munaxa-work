import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  CONNECTION,
  HR,
  MANAGER,
  PEER,
  TENANT_A,
  TENANT_B,
  http,
  openPerformanceApi,
  permitting,
  requireDatabaseInCi,
  type PageBody,
  type PerformanceApiFixture,
  type ProblemBody,
} from './performance-api.fixture.js';
import { BASE, NAME, configure, enrol, post } from './performance-api-scenario.js';
import { EMPLOYEE_ID, MANAGER_ID, OUTSIDER_ID, PEER_ID } from './phase-thirteen-upstream.js';
import { ALL_PERFORMANCE_PERMISSIONS, PerformancePermissions } from '@work/performance';

/**
 * The Performance API's security matrix, over **real PostgreSQL with row-level security on**, as an
 * unprivileged role.
 *
 * Every state these tests reach was reached over HTTP. Nothing is seeded directly: a security test
 * that passed against a database state no client could produce would be a security test about
 * nothing.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance API security suite');

suite('performance API security', () => {
  let fixture: PerformanceApiFixture;

  beforeAll(async () => {
    fixture = await openPerformanceApi();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const asTenant = (tenantId: string, actor = HR) =>
    fixture.applicationFor(tenantId, permitting(...ALL_PERFORMANCE_PERMISSIONS), actor);

  it('refuses a request that arrived with no authenticated principal, as 401 rather than 500', async () => {
    const application = await asTenant(TENANT_A);
    const response = await http(application)
      .get(`${BASE}/cycles`)
      .set('x-test-actor', 'none')
      .expect(401);

    // A 500 here would be the tenant exception surfacing from somewhere deep — the wrong answer to
    // "you are not signed in", and the wrong thing to read in a log at three in the morning.
    expect((response.body as ProblemBody).status).toBe(401);
  });

  it('does not let one tenant read another’s cycles, reviews or ratings', async () => {
    const first = await asTenant(TENANT_A);
    const configured = await configure(first);

    await enrol(first, configured.cycleId, EMPLOYEE_ID);

    const second = await asTenant(TENANT_B);
    const cycles = await http(second).get(`${BASE}/cycles`).expect(200);
    const reviews = await http(second).get(`${BASE}/reviews`).expect(200);

    // Not merely "no items": the totals must be zero too. A count computed without the tenant
    // predicate leaks how many reviews exist elsewhere even when no row comes back.
    expect((cycles.body as PageBody<unknown>).items).toEqual([]);
    expect((cycles.body as PageBody<unknown>).total).toBe(0);
    expect((reviews.body as PageBody<unknown>).items).toEqual([]);
    expect((reviews.body as PageBody<unknown>).total).toBe(0);
  });

  it('answers 404 — not 403 — when the other tenant names a review by its identifier', async () => {
    const first = await asTenant(TENANT_A);
    const configured = await configure(first);
    const reviewId = await enrol(first, configured.cycleId, EMPLOYEE_ID);
    const second = await asTenant(TENANT_B);

    // 403 would confirm the review exists, which is the disclosure: it says somebody is being
    // appraised. Row-level security makes it invisible, and the API must not soften that.
    await http(second).get(`${BASE}/reviews/${reviewId}`).expect(404);
  });

  it('refuses every protected operation to a caller holding no permission, naming the permission', async () => {
    const application = await fixture.applicationFor(TENANT_A, permitting());
    const response = await http(application).get(`${BASE}/cycles`).expect(403);

    // The permission is named because the caller is authenticated and an administrator can act on
    // "you need performance.cycle.read". It reveals nothing about the data.
    expect((response.body as ProblemBody).detail ?? '').toContain('performance.cycle.read');
  });

  it('does not let a review’s own manager grant a read-team caller access to it', async () => {
    const owner = await asTenant(TENANT_A);
    const configured = await configure(owner);
    const reviewId = await enrol(owner, configured.cycleId, EMPLOYEE_ID);

    // The caller holds `read-team` and nothing else, and names the manager the review actually has.
    // This is the IDOR: over HTTP it is one query parameter away, and the answer must be 404.
    const teamOnly = await fixture.applicationFor(
      TENANT_A,
      permitting(PerformancePermissions.reviewReadTeam, PerformancePermissions.cycleRead),
      MANAGER,
    );

    await http(teamOnly)
      .get(`${BASE}/reviews/${reviewId}?managerEmploymentId=${MANAGER_ID}`)
      .expect(404);

    // And naming somebody else's manager reaches nothing either — the parameter is a filter, never
    // a credential.
    await http(teamOnly)
      .get(`${BASE}/reviews/${reviewId}?managerEmploymentId=${OUTSIDER_ID}`)
      .expect(404);

    const queue = await http(teamOnly)
      .get(`${BASE}/reviews?managerEmploymentId=${MANAGER_ID}`)
      .expect(200);

    expect((queue.body as PageBody<unknown>).items).toEqual([]);
    expect((queue.body as PageBody<unknown>).total).toBe(0);
  });

  it('admits an invited reviewer and refuses an uninvited one, over the real route', async () => {
    const owner = await asTenant(TENANT_A);
    const configured = await configure(owner);
    const reviewId = await enrol(owner, configured.cycleId, EMPLOYEE_ID);

    await post(owner, `${BASE}/reviews/${reviewId}/reviewers`, {
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });

    // Writing an assessment is gated by `performance.assess`; what narrows the *peer* path is the
    // invitation the handler looks up, not a second permission. `assess-peer` gates accepting or
    // declining an invitation, which is a different act. The report records the asymmetry.
    const invited = await fixture.applicationFor(
      TENANT_A,
      permitting(PerformancePermissions.assess, PerformancePermissions.assessPeer),
      PEER,
    );

    // The invited reviewer succeeds. This assertion is the regression test for the defect where
    // `authorizationFor` returned a string on both paths, so *every* invited reviewer was refused —
    // a panel that looked secure because nothing worked.
    await http(invited)
      .post(`${BASE}/reviews/${reviewId}/assessments`)
      .send({ assessmentKind: 'peer', assessorEmploymentId: PEER_ID })
      .expect(201);

    // Somebody nobody invited is refused, holding the same permission. **403 rather than 404**:
    // the caller was told this review exists — they were invited to the panel — so naming the
    // permission discloses nothing they did not already know.
    const uninvited = await http(invited)
      .post(`${BASE}/reviews/${reviewId}/assessments`)
      .send({ assessmentKind: 'peer', assessorEmploymentId: OUTSIDER_ID })
      .expect(403);

    expect((uninvited.body as ProblemBody).detail).toBe('Requires performance.assess-peer.');
  });

  it('does not let a reviewer invited to one review assess another', async () => {
    const owner = await asTenant(TENANT_A);
    const configured = await configure(owner);
    const invitedTo = await enrol(owner, configured.cycleId, EMPLOYEE_ID);

    await post(owner, `${BASE}/reviews/${invitedTo}/reviewers`, {
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });
    await post(owner, `${BASE}/cycles/${configured.cycleId}/participants`, {
      employmentIds: [PEER_ID],
    });

    const others = (
      await http(owner).get(`${BASE}/reviews?cycleId=${configured.cycleId}`).expect(200)
    ).body as PageBody<{ readonly reviewId: string }>;
    const elsewhere = others.items.find((review) => review.reviewId !== invitedTo)?.reviewId ?? '';
    const invited = await fixture.applicationFor(
      TENANT_A,
      permitting(PerformancePermissions.assess, PerformancePermissions.assessPeer),
      PEER,
    );

    // An invitation to one review reaches that review and no other. The reviewer holds the same
    // permissions they used successfully a test earlier; what they lack here is the invitation.
    const refused = await http(invited)
      .post(`${BASE}/reviews/${elsewhere}/assessments`)
      .send({ assessmentKind: 'peer', assessorEmploymentId: PEER_ID })
      .expect(403);

    expect((refused.body as ProblemBody).detail).toBe('Requires performance.assess-peer.');
  });

  it('refuses calibration to a caller who may complete but not calibrate, and the reverse', async () => {
    const owner = await asTenant(TENANT_A);
    const configured = await configure(owner);

    await enrol(owner, configured.cycleId, EMPLOYEE_ID);

    const completer = await fixture.applicationFor(
      TENANT_A,
      permitting(PerformancePermissions.complete, PerformancePermissions.cycleRead),
    );

    // `calibrate` and `complete` are separate on purpose: one permission covering both would let
    // whoever ran the calibration meeting sign off its outcomes unreviewed.
    await http(completer)
      .post(`${BASE}/calibration-sessions`)
      .send({ cycleId: configured.cycleId, code: 'engineering', name: NAME })
      .expect(403);
  });

  it('returns a Problem Details body with no stack trace, SQL or table name', async () => {
    const application = await asTenant(TENANT_A);
    const response = await http(application)
      .post(`${BASE}/cycles`)
      .send({ code: 'NOT A CODE', name: NAME })
      .expect(400);
    const problem = response.body as ProblemBody;
    const rendered = JSON.stringify(problem);

    expect(problem.status).toBe(400);
    expect(rendered).not.toMatch(/performance_cycle|select |insert into|at Object\.|\.ts:\d+/u);
  });
});
