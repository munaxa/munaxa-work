import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ALL_LEARNING_PERMISSIONS } from '@work/learning';

import {
  CONNECTION,
  HR,
  TENANT_A,
  http,
  openLearningApi,
  permitting,
  requireDatabaseInCi,
  type AssessmentResultBody,
  type AssignmentBody,
  type CertificationBody,
  type CourseDetailBody,
  type LearningApiFixture,
  type PageBody,
  type ProblemBody,
} from './learning-api.fixture.js';
import {
  BASE,
  NAME,
  aMandatoryRule,
  aPublishedCourse,
  anEnrolment,
  post,
} from './learning-api-scenario.js';
import { DOCUMENT_ID, EMPLOYEE_ID, TODAY, UNIT_ID } from './phase-fourteen-upstream.js';

/**
 * The Learning API end to end: the whole journey over HTTP, the refusals that guard it, and the
 * three properties this transport is most able to break — a lifecycle field a client could set, a
 * concurrency conflict reported as a server fault, and an exact value normalized in transit.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning API lifecycle suite');

suite('learning API lifecycle', () => {
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

  const asHr = () => fixture.applicationFor(TENANT_A, permitting(...ALL_LEARNING_PERMISSIONS), HR);

  it('runs catalogue → requirement → enrolment → assessment → certificate over HTTP alone', async () => {
    const application = await asHr();
    const { courseId, courseVersionId } = await aPublishedCourse(application, {
      requiresAssessment: true,
    });
    const assessment = await post(
      application,
      `${BASE}/course-versions/${courseVersionId}/assessments`,
      { title: NAME, kind: 'practical', required: true },
    );
    const ruleId = await aMandatoryRule(application, courseId, UNIT_ID);

    // The audience is resolved through Employment's published contract, under a bounded grant.
    const run = await post(application, `${BASE}/mandatory-rules/${ruleId}/reconciliation`, {});

    expect(run).toMatchObject({ examined: 3, generated: 3 });

    const queue = (
      await http(application).get(`${BASE}/assignments?employmentId=${EMPLOYEE_ID}`).expect(200)
    ).body as PageBody<AssignmentBody>;
    const generated = queue.items[0];

    expect(generated?.source).toBe('mandatory_rule');
    // Derived from the due date and the day asked about, not read from a column.
    expect(generated?.overdue).toBe(true);

    const enrolmentId = (
      await post(application, `${BASE}/enrolments`, {
        employmentId: EMPLOYEE_ID,
        courseId,
        assignmentId: generated?.assignmentId,
      })
    ).enrolmentId;

    await post(application, `${BASE}/enrolments/${enrolmentId ?? ''}/start`, {
      expectedVersion: 1,
    });
    await post(application, `${BASE}/assessments/${assessment.assessmentId ?? ''}/results`, {
      enrolmentId,
      outcome: 'passed',
      rawMark: '18.50',
      rawMarkScale: 'out of 20',
      assessedOn: TODAY,
    });
    await post(application, `${BASE}/enrolments/${enrolmentId ?? ''}/completion`, {
      expectedVersion: 2,
      completedOn: TODAY,
    });

    // The completion closed the requirement it came from, in the same transaction — which is why
    // there is no satisfy route for a client to call.
    const closed = (
      await http(application).get(`${BASE}/assignments?employmentId=${EMPLOYEE_ID}`).expect(200)
    ).body as PageBody<AssignmentBody>;

    expect(closed.items[0]?.status).toBe('satisfied');

    await post(application, `${BASE}/certifications`, {
      employmentId: EMPLOYEE_ID,
      enrolmentId,
      courseId,
      title: 'Fire safety',
      source: 'learning_completion',
      issuedOn: TODAY,
      evidenceDocumentId: DOCUMENT_ID,
    });

    const held = (
      await http(application).get(`${BASE}/certifications?employmentId=${EMPLOYEE_ID}`).expect(200)
    ).body as PageBody<CertificationBody>;

    // The validity the pinned version was configured with, derived against the day asked about.
    expect(held.items[0]).toMatchObject({ validUntil: '2027-08-12', validity: 'valid' });

    const history = (await http(application).get(`${BASE}/history/${EMPLOYEE_ID}`).expect(200))
      .body as {
      readonly completedCourses: number;
      readonly activeCertifications: number;
      readonly openAssignments: number;
    };

    expect(history).toMatchObject({
      completedCourses: 1,
      activeCertifications: 1,
      openAssignments: 0,
    });
  });

  describe('a lifecycle field is never something a client sets', () => {
    it('refuses a PATCH that tries to archive a course through its status', async () => {
      const application = await asHr();
      const { courseId } = await aPublishedCourse(application);

      // `PATCH` amends a course's description. Archival is a `POST` to its own sub-resource with
      // its own rule, and a status a client could write would let a typo retire a safety course.
      await http(application)
        .patch(`${BASE}/courses/${courseId}`)
        .send({ expectedVersion: 2, status: 'archived' })
        .expect(400);

      const detail = (await http(application).get(`${BASE}/courses/${courseId}`).expect(200))
        .body as CourseDetailBody;

      expect(detail.course.status).toBe('published');
    });

    it('has no route that completes an enrolment without the completion permission’s act', async () => {
      const application = await asHr();
      const { courseId } = await aPublishedCourse(application);
      const enrolmentId = await anEnrolment(application, EMPLOYEE_ID, courseId);

      // There is no PATCH on an enrolment at all: every move it can make is a named act.
      await http(application)
        .patch(`${BASE}/enrolments/${enrolmentId}`)
        .send({ expectedVersion: 1, status: 'completed' })
        .expect(404);
    });
  });

  describe('a concurrent edit', () => {
    it('answers 409 for a stale version, never 500', async () => {
      const application = await asHr();
      const { courseId } = await aPublishedCourse(application);

      // The first publish moved the course to version 2. The second client still holds 1.
      const response = await http(application)
        .post(`${BASE}/courses/${courseId}/versions`)
        .send({ expectedVersion: 1, title: NAME, requiresAssessment: false })
        .expect(409);

      expect((response.body as ProblemBody).status).toBe(409);
    });

    it('lets exactly one of two simultaneous requests win, and tells the other it lost', async () => {
      const application = await asHr();
      const { courseId } = await aPublishedCourse(application);
      const amend = (en: string) =>
        http(application)
          .patch(`${BASE}/courses/${courseId}`)
          .send({ expectedVersion: 2, name: { en, ar: 'اسم' } });

      // Two genuinely independent requests, in flight together, on two connections from the pool.
      // Both are legitimate amendments — nothing in the domain refuses either — so the *only*
      // thing that can separate them is the version, which is the point.
      const [first, second] = await Promise.all([amend('Renamed once'), amend('Renamed twice')]);
      const statuses = [first.status, second.status].sort((left, right) => left - right);

      // One wins; the loser is told the row moved and reads it again. Neither is a 500, and the
      // loser's change is not silently applied on top — last-write-wins here would lose an edit
      // somebody made and show them their own stale copy as if it had been saved.
      expect(statuses).toEqual([200, 409]);

      const detail = (await http(application).get(`${BASE}/courses/${courseId}`).expect(200))
        .body as CourseDetailBody;

      expect(detail.course.version).toBe(3);
    });

    it('refuses a second simultaneous start rather than starting an enrolment twice', async () => {
      const application = await asHr();
      const { courseId } = await aPublishedCourse(application);
      const enrolmentId = await anEnrolment(application, EMPLOYEE_ID, courseId);
      const start = () =>
        http(application)
          .post(`${BASE}/enrolments/${enrolmentId}/start`)
          .send({ expectedVersion: 1 });

      const [first, second] = await Promise.all([start(), start()]);
      const statuses = [first.status, second.status].sort((left, right) => left - right);
      const [won] = statuses;
      const [, lost] = statuses;

      // Exactly one succeeds. The loser is refused by whichever guard reached it first — the
      // version, or the aggregate declining a second transition out of `enrolled` — and both are
      // correct answers. What must never happen is two successes, or a 500 for either.
      expect(won).toBe(201);
      expect([409, 422]).toContain(lost);

      const page = (
        await http(application).get(`${BASE}/enrolments?employmentId=${EMPLOYEE_ID}`).expect(200)
      ).body as PageBody<{ readonly status: string; readonly version: number }>;

      // One start applied, not two: an enrolment started twice would carry the wrong started-by.
      expect(page.items[0]).toMatchObject({ status: 'in_progress', version: 2 });
    });
  });

  it('does not turn 18.50 into 18.5 anywhere between the request and the response', async () => {
    const application = await asHr();
    const { courseId, courseVersionId } = await aPublishedCourse(application, {
      requiresAssessment: true,
    });
    const assessment = await post(
      application,
      `${BASE}/course-versions/${courseVersionId}/assessments`,
      { title: NAME, kind: 'practical', required: true },
    );
    const enrolmentId = await anEnrolment(application, EMPLOYEE_ID, courseId);

    await post(application, `${BASE}/assessments/${assessment.assessmentId ?? ''}/results`, {
      enrolmentId,
      outcome: 'passed',
      rawMark: '18.50',
      rawMarkScale: 'out of 20',
      assessedOn: TODAY,
    });

    const results = (
      await http(application)
        .get(`${BASE}/enrolments/${enrolmentId}/assessment-results`)
        .expect(200)
    ).body as readonly AssessmentResultBody[];

    // The exact string an assessor typed. A single `Number()` anywhere on this path — in a DTO
    // transform, a repository, a serializer — renders it `18.5`, which is a different mark in a
    // transcript and one nobody could explain a year later.
    expect(results[0]?.rawMark).toBe('18.50');
    // The regression this asserts against, stated so the reason cannot be edited away by accident.
    expect(String(Number('18.50'))).not.toBe('18.50');
  });

  it('records a notification intent and claims no delivery', async () => {
    const application = await asHr();
    const { courseId } = await aPublishedCourse(application);

    await post(application, `${BASE}/assignments`, {
      employmentId: EMPLOYEE_ID,
      courseId,
      dueOn: '2026-09-30',
    });

    const [sent] = fixture.notifications.sent;

    expect(sent?.templateKey).toBe('learning.assignment.created');
    // Nothing delivers. There is no `deliveredAt` to assert, and that absence is the honest state
    // of the capability — a route that implied delivery would promise what nothing performs.
    expect(Object.keys(sent ?? {})).not.toContain('deliveredAt');
  });
});
