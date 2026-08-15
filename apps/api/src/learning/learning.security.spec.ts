import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALL_LEARNING_PERMISSIONS, LearningPermissions } from '@work/learning';

import {
  CONNECTION,
  HR,
  TENANT_A,
  TENANT_B,
  http,
  openLearningApi,
  permitting,
  requireDatabaseInCi,
  type LearningApiFixture,
  type PageBody,
  type ProblemBody,
} from './learning-api.fixture.js';
import { BASE, NAME, aMandatoryRule, aPublishedCourse, post } from './learning-api-scenario.js';
import { EMPLOYEE_ID, MANAGER_ID, UNIT_ID } from './phase-fourteen-upstream.js';

/**
 * The Learning API's security matrix, over **real PostgreSQL with row-level security on**, as an
 * unprivileged role.
 *
 * Every state these tests reach was reached over HTTP. Nothing is seeded directly: a security test
 * that passed against a database state no client could produce would be a security test about
 * nothing.
 *
 * The disclosure this module has to prevent is specific. A training record says a named person was
 * put on a remedial safety course, failed an assessment, or had a licence revoked — and unlike a
 * salary, it is something a colleague can act on. So the questions here are not only "can tenant B
 * read tenant A's rows" but "does a count tell them how many exist", and "does naming somebody in a
 * URL widen what a caller may see".
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning API security suite');

suite('learning API security', () => {
  let fixture: LearningApiFixture;

  beforeAll(async () => {
    fixture = await openLearningApi();
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const asTenant = (tenantId: string, actor = HR) =>
    fixture.applicationFor(tenantId, permitting(...ALL_LEARNING_PERMISSIONS), actor);

  const holding = (...permissions: readonly string[]) =>
    fixture.applicationFor(TENANT_A, permitting(...permissions));

  it('refuses a request that arrived with no authenticated principal, as 401 rather than 500', async () => {
    const application = await asTenant(TENANT_A);
    const response = await http(application)
      .get(`${BASE}/courses`)
      .set('x-test-actor', 'none')
      .expect(401);

    // A 500 here would be the tenant exception surfacing from somewhere deep — the wrong answer to
    // "you are not signed in", and the wrong thing to read in a log at three in the morning.
    expect((response.body as ProblemBody).status).toBe(401);
  });

  it('refuses a caller holding nothing, naming the permission and disclosing no data', async () => {
    const application = await holding();
    const response = await http(application).get(`${BASE}/assignments`).expect(403);

    expect((response.body as ProblemBody).detail).toContain(LearningPermissions.assignmentRead);
  });

  describe('two tenants', () => {
    it('shows neither tenant the other’s courses, assignments or certifications — nor their totals', async () => {
      const first = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(first);

      await post(first, `${BASE}/assignments`, {
        employmentId: EMPLOYEE_ID,
        courseId,
        dueOn: '2026-09-30',
      });
      await post(first, `${BASE}/certifications`, {
        employmentId: EMPLOYEE_ID,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        validUntil: '2027-01-15',
      });

      const second = await asTenant(TENANT_B);

      for (const collection of ['courses', 'assignments', 'certifications']) {
        const response = await http(second).get(`${BASE}/${collection}`).expect(200);
        const page = response.body as PageBody<unknown>;

        // Not merely "no items": the totals must be zero too. A count computed without the tenant
        // predicate leaks how many training records exist elsewhere even when no row comes back.
        expect([collection, page.items, page.total]).toEqual([collection, [], 0]);
      }
    });

    it('answers 404 — not 403 — when the other tenant names a course by its identifier', async () => {
      const first = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(first);
      const second = await asTenant(TENANT_B);

      // 403 would confirm the course exists. Row-level security makes it invisible, and the API
      // must not soften that into an answer that discloses the other tenant's catalogue.
      await http(second).get(`${BASE}/courses/${courseId}`).expect(404);
    });

    it('refuses one tenant’s course used in the other’s assignment, naming the course', async () => {
      const first = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(first);
      const second = await asTenant(TENANT_B);
      const response = await http(second)
        .post(`${BASE}/assignments`)
        .send({ employmentId: EMPLOYEE_ID, courseId })
        .expect(404);

      // The employment is real and confirmed through Employment — it is the *course* that does not
      // exist here, and saying so discloses nothing about the other tenant.
      expect((response.body as ProblemBody).detail).toContain('learning_course');
    });

    it('shows one tenant nothing of the other’s learning history for the same person', async () => {
      const first = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(first);

      await post(first, `${BASE}/assignments`, { employmentId: EMPLOYEE_ID, courseId });

      const second = await asTenant(TENANT_B);
      const response = await http(second).get(`${BASE}/history/${EMPLOYEE_ID}`).expect(200);
      const history = response.body as {
        readonly assignments: readonly unknown[];
        readonly openAssignments: number;
        readonly completedCourses: number;
      };

      // The *same* employment identifier — real in both tenants' upstream world.
      expect([history.assignments, history.openAssignments, history.completedCourses]).toEqual([
        [],
        0,
        0,
      ]);
    });
  });

  describe('what a permission actually grants', () => {
    it('does not let assignment.manage waive a requirement', async () => {
      const managing = await holding(
        LearningPermissions.catalogueManage,
        LearningPermissions.assignmentManage,
        LearningPermissions.assignmentRead,
        LearningPermissions.assignmentReadAll,
      );
      const { courseId } = await aPublishedCourse(managing);
      const assigned = await post(managing, `${BASE}/assignments`, {
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      // Waiving is the one act that excuses somebody from a compliance obligation, and it is the
      // one an auditor asks about a year later. `manage` must not imply it.
      const response = await http(managing)
        .post(`${BASE}/assignments/${assigned.assignmentId ?? ''}/waiver`)
        .send({ expectedVersion: 1, reason: 'Holds an equivalent licence' })
        .expect(403);

      expect((response.body as ProblemBody).detail).toContain(LearningPermissions.assignmentWaive);
    });

    it('does not let certification.manage revoke a certificate', async () => {
      const managing = await holding(
        LearningPermissions.certificationManage,
        LearningPermissions.certificationRead,
        LearningPermissions.assignmentReadAll,
      );
      const issued = await post(managing, `${BASE}/certifications`, {
        employmentId: EMPLOYEE_ID,
        title: 'Forklift licence',
        source: 'external',
        issuedOn: '2026-01-15',
        validUntil: '2027-01-15',
      });

      await http(managing)
        .post(`${BASE}/certifications/${issued.certificationId ?? ''}/revocation`)
        .send({ expectedVersion: 1, reason: 'Licence surrendered' })
        .expect(403);
    });

    it('does not let enrolment.manage record a completion', async () => {
      const managing = await holding(
        LearningPermissions.catalogueManage,
        LearningPermissions.enrolmentManage,
      );
      const { courseId } = await aPublishedCourse(managing);
      const enrolment = await post(managing, `${BASE}/enrolments`, {
        employmentId: EMPLOYEE_ID,
        courseId,
      });

      // A completion is the evidence a certificate is issued from, and what a safety audit reads.
      await http(managing)
        .post(`${BASE}/enrolments/${enrolment.enrolmentId ?? ''}/completion`)
        .send({ expectedVersion: 1, completedOn: '2026-08-12' })
        .expect(403);
    });
  });

  describe('an identifier in a request is a filter, never a credential', () => {
    it('shows a read-team caller nothing, whatever manager identifier they supply', async () => {
      const hr = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(hr);

      await post(hr, `${BASE}/assignments`, { employmentId: EMPLOYEE_ID, courseId });

      const manager = await holding(
        LearningPermissions.assignmentRead,
        LearningPermissions.assignmentReadTeam,
      );

      // Nothing in this repository can prove this caller is anybody's manager (ADR-0032), so the
      // honest answer is nothing — and it stays nothing when they name a real manager, a real
      // report, or themselves. Honouring the parameter would be an IDOR wearing a permission's name.
      for (const supplied of [
        '',
        `?managerEmploymentId=${MANAGER_ID}`,
        `?employmentId=${EMPLOYEE_ID}`,
      ]) {
        const response = await http(manager).get(`${BASE}/assignments${supplied}`).expect(200);
        const page = response.body as PageBody<unknown>;

        expect([supplied, page.items, page.total]).toEqual([supplied, [], 0]);
      }
    });

    it('answers 404 for a history a read-team caller names, rather than confirming it exists', async () => {
      const hr = await asTenant(TENANT_A);
      const { courseId } = await aPublishedCourse(hr);

      await post(hr, `${BASE}/assignments`, { employmentId: EMPLOYEE_ID, courseId });

      const manager = await holding(
        LearningPermissions.assignmentRead,
        LearningPermissions.assignmentReadTeam,
      );

      // 403 would confirm this person has a training record, which is itself the disclosure.
      await http(manager).get(`${BASE}/history/${EMPLOYEE_ID}`).expect(404);
    });
  });

  it('refuses a body carrying a property the API never declared', async () => {
    const application = await asTenant(TENANT_A);
    const { courseId } = await aPublishedCourse(application);

    // `forbidNonWhitelisted` is what stops a client smuggling a field into a command — an actor, a
    // source, a status. A silently dropped property would look accepted and change nothing.
    const response = await http(application)
      .post(`${BASE}/assignments`)
      .send({ employmentId: EMPLOYEE_ID, courseId, source: 'mandatory_rule' })
      .expect(400);

    expect((response.body as ProblemBody).detail).toContain('source');
  });

  it('refuses a mandatory rule naming a unit Organization does not know', async () => {
    const application = await asTenant(TENANT_A);
    const { courseId } = await aPublishedCourse(application);
    const unknown = '01900000-0000-7000-8000-0000000000ff';

    // A compliance rule that silently covered nobody is worse than no rule at all.
    await http(application)
      .post(`${BASE}/mandatory-rules`)
      .send({
        courseId,
        name: NAME,
        kind: 'safety',
        audience: 'organization_unit',
        organizationUnitId: unknown,
        effectiveFrom: '2024-01-01',
        recurrenceMonths: 12,
        dueWithinDays: 30,
      })
      .expect(422);
  });

  it('refuses reconciliation as 422 when Employment cannot answer, never as a zero', async () => {
    const application = await asTenant(TENANT_A);
    const { courseId } = await aPublishedCourse(application);
    const ruleId = await aMandatoryRule(application, courseId, UNIT_ID);

    fixture.facts.employmentReachable = false;

    const response = await http(application)
      .post(`${BASE}/mandatory-rules/${ruleId}/reconciliation`)
      .send({})
      .expect(422);

    // "0 examined, 0 generated" would be a compliance report claiming everybody is up to date
    // about an organization it never looked at. A refusal is the only honest answer.
    expect((response.body as ProblemBody).status).toBe(422);
  });
});
