import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_LEARNING_PERMISSIONS } from '@work/learning';

import {
  CONNECTION,
  HR,
  TENANT_A,
  http,
  openLearningApi,
  permitting,
  requireDatabaseInCi,
  type CertificationBody,
  type LearningApiFixture,
  type PageBody,
  type ProblemBody,
} from './learning-api.fixture.js';
import { BASE, NAME, aPublishedCourse, post } from './learning-api-scenario.js';
import { DOCUMENT_ID, EMPLOYEE_ID, TODAY } from './phase-fourteen-upstream.js';

/**
 * The Learning API's contract: what a valid request returns, what an invalid one returns, which
 * route a path resolves to, and where every collection's bounds actually are.
 *
 * Route resolution is asserted rather than commented. Nest resolves by controller declaration
 * order, and a `:courseId` declared before a literal segment swallows it — the Phase 10 lesson, and
 * not one this module should have to learn again. Learning's prefixes are deliberately disjoint,
 * and these tests are what keep that true rather than accidental.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Learning API contract suite');

suite('learning API contract', () => {
  let fixture: LearningApiFixture;
  let api: INestApplication;

  beforeAll(async () => {
    fixture = await openLearningApi();
    api = await fixture.applicationFor(TENANT_A, permitting(...ALL_LEARNING_PERMISSIONS), HR);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('resolves every literal segment to its own route rather than to an identifier', async () => {
    const { courseId, courseVersionId } = await aPublishedCourse(api);

    // `course-versions` is its own resource, not a course whose identifier is `course-versions`.
    await post(api, `${BASE}/course-versions/${courseVersionId}/assessments`, {
      title: NAME,
      kind: 'practical',
      required: true,
    });
    // `course-categories` likewise, and `history/:employmentId` is not a certification.
    await post(api, `${BASE}/course-categories`, { code: 'safety', name: NAME });
    await http(api).get(`${BASE}/history/${EMPLOYEE_ID}`).expect(200);
    // And `:courseId` still resolves when it is genuinely an identifier: a course that does not
    // exist is a 404 rather than a 200 from some other handler that matched first.
    await http(api).get(`${BASE}/courses/${EMPLOYEE_ID}`).expect(404);
    await http(api).get(`${BASE}/courses/${courseId}`).expect(200);
  });

  describe('every collection is bounded, and the bound is the API’s rather than the caller’s', () => {
    const codes = ['one', 'two', 'three', 'four', 'five'];

    const fiveCourses = async (): Promise<void> => {
      for (const code of codes) await aPublishedCourse(api, { code });
    };

    const pageOf = async (queryString: string): Promise<PageBody<{ readonly code: string }>> =>
      (await http(api).get(`${BASE}/courses${queryString}`).expect(200)).body as PageBody<{
        readonly code: string;
      }>;

    it('returns the first page, a subsequent page, and a page past the end', async () => {
      await fiveCourses();

      const first = await pageOf('?page=1&size=2');
      const second = await pageOf('?page=2&size=2');
      const beyond = await pageOf('?page=4&size=2');

      expect([first.items.length, first.total]).toEqual([2, 5]);
      expect([second.items.length, second.total]).toEqual([2, 5]);
      // Not an error: asking for the fourth page of five rows is a legitimate question with an
      // empty answer, and the total still says how many there are so a client can correct itself.
      expect([beyond.items, beyond.total]).toEqual([[], 5]);
      // The pages are disjoint. A bound applied after loading everything would repeat rows here.
      expect(first.items.map((course) => course.code)).not.toEqual(
        second.items.map((course) => course.code),
      );
    });

    it('returns an empty page for a filter that matches nothing, with a total to match', async () => {
      await fiveCourses();

      const none = await pageOf('?delivery=e_learning');

      expect([none.items, none.total]).toEqual([[], 0]);
    });

    it('honours the maximum page size and clamps an attempt to exceed it', async () => {
      await fiveCourses();

      const maximum = await pageOf('?size=200');
      const oversized = await pageOf('?size=5000');

      expect(maximum.items).toHaveLength(5);
      // Clamped rather than refused: the caller asked a legitimate question badly, and the answer
      // is a bounded page. An unbounded one is how a tenant with a hundred thousand rows falls over.
      expect(oversized.items).toHaveLength(5);
      expect(oversized.total).toBe(5);
    });

    it('treats a page size that is not a number as absent rather than as zero', async () => {
      await fiveCourses();

      // `Number('abc')` is `NaN`, which compares false against every bound and sails through a
      // naive check — and `size=0` would return nothing while claiming five exist.
      const nonsense = await pageOf('?size=abc&page=abc');

      expect(nonsense.items).toHaveLength(5);
    });
  });

  it('refuses an undeclared property rather than silently dropping it', async () => {
    const response = await http(api)
      .post(`${BASE}/course-categories`)
      .send({ code: 'safety', name: NAME, tenantId: TENANT_A })
      .expect(400);

    expect((response.body as ProblemBody).detail ?? '').toContain('tenantId');
  });

  it('separates a malformed request from a refused one: 400 for shape, 409 for the rule', async () => {
    await aPublishedCourse(api, { code: 'fire-safety' });

    // Malformed: `delivery` is not a delivery mode. The client can fix it by sending other bytes.
    await http(api)
      .post(`${BASE}/courses`)
      .send({ code: 'another', name: NAME, delivery: 'telepathy' })
      .expect(400);

    // Well-formed and refused: the code is taken. Resending it unchanged will always fail, which is
    // why it must not be a 400 — a client that saw one would retry with a different payload forever.
    await http(api)
      .post(`${BASE}/courses`)
      .send({ code: 'fire-safety', name: NAME, delivery: 'classroom' })
      .expect(409);
  });

  it('refuses a civil date that is an instant, and one that is not a date at all', async () => {
    const { courseId } = await aPublishedCourse(api);
    const body = { employmentId: EMPLOYEE_ID, courseId };

    // An ISO instant carries a time zone and a due date does not have one. Accepting it would let
    // the same date mean two days depending on where the client was.
    await http(api)
      .post(`${BASE}/assignments`)
      .send({ ...body, dueOn: '2026-09-30T00:00:00Z' })
      .expect(400);
    await http(api)
      .post(`${BASE}/assignments`)
      .send({ ...body, dueOn: '30/09/2026' })
      .expect(400);
  });

  it('refuses a mark that is not an exact decimal, and never rounds one that is', async () => {
    const { courseId, courseVersionId } = await aPublishedCourse(api, { requiresAssessment: true });
    const assessment = await post(api, `${BASE}/course-versions/${courseVersionId}/assessments`, {
      title: NAME,
      kind: 'practical',
      required: true,
    });
    const enrolment = await post(api, `${BASE}/enrolments`, {
      employmentId: EMPLOYEE_ID,
      courseId,
    });
    const recording = (mark: string) =>
      http(api)
        .post(`${BASE}/assessments/${assessment.assessmentId ?? ''}/results`)
        .send({
          enrolmentId: enrolment.enrolmentId,
          outcome: 'recorded',
          rawMark: mark,
          assessedOn: TODAY,
        });

    // Five decimals, and a value that is not a number at all. Both are the client's mistake, and
    // both are refused at the edge rather than becoming a column nobody can interpret.
    await recording('18.500001').expect(400);
    await recording('excellent').expect(400);
  });

  it('carries an evidence reference and no field implying a file exists anywhere', async () => {
    await post(api, `${BASE}/certifications`, {
      employmentId: EMPLOYEE_ID,
      title: 'Forklift licence',
      source: 'external',
      issuedOn: '2026-01-15',
      validUntil: '2027-01-15',
      evidenceDocumentId: DOCUMENT_ID,
    });

    const page = (
      await http(api).get(`${BASE}/certifications?employmentId=${EMPLOYEE_ID}`).expect(200)
    ).body as PageBody<Record<string, unknown>>;
    const certificate = page.items[0] ?? {};

    // The whole of the Documents integration is one question: does this reference exist. The view
    // carries **no filename, size, hash or URL** — there is no storage adapter in this repository,
    // and a field implying one would promise a download that never arrives.
    expect(certificate['evidenceDocumentId']).toBe(DOCUMENT_ID);
    for (const absent of ['url', 'downloadUrl', 'storageReference', 'fileName', 'contentType']) {
      expect(Object.keys(certificate)).not.toContain(absent);
    }

    fixture.facts.documentPresent = false;

    await http(api)
      .post(`${BASE}/certifications`)
      .send({
        employmentId: EMPLOYEE_ID,
        title: 'Citing a ghost',
        source: 'external',
        issuedOn: '2026-01-15',
        evidenceDocumentId: DOCUMENT_ID,
      })
      .expect(422);
  });

  it('derives validity against the day asked about and echoes that day back', async () => {
    await post(api, `${BASE}/certifications`, {
      employmentId: EMPLOYEE_ID,
      title: 'Forklift licence',
      source: 'external',
      issuedOn: '2026-01-15',
      validUntil: '2026-09-01',
    });

    const answerFor = async (
      queryString: string,
    ): Promise<
      PageBody<CertificationBody> & {
        readonly asOf: string;
      }
    > =>
      (await http(api).get(`${BASE}/certifications${queryString}`).expect(200))
        .body as PageBody<CertificationBody> & { readonly asOf: string };

    const today = await answerFor('');
    const withNotice = await answerFor('?noticeDays=30');
    const later = await answerFor('?asOf=2026-12-01');

    // Today is 2026-08-12. The same row, three answers, none of them stored anywhere.
    expect([today.asOf, today.items[0]?.validity]).toEqual(['2026-08-12', 'valid']);
    expect(withNotice.items[0]?.validity).toBe('expiring_soon');
    expect([later.asOf, later.items[0]?.validity]).toEqual(['2026-12-01', 'expired']);
  });

  it('exposes no route for a capability this product does not have', async () => {
    // Each of these is a real capability in some learning product and `NOT VERIFIED` in this one:
    // aggregate scoring, binary upload and download, notification delivery, self-service routing,
    // and Phase 14B's sessions, capacity and waitlists. A route that answered anything other than
    // 404 would be this API claiming something nothing behind it performs.
    const absent = [
      `${BASE}/enrolments/${EMPLOYEE_ID}/score`,
      `${BASE}/courses/${EMPLOYEE_ID}/content`,
      `${BASE}/notifications`,
      `${BASE}/me/assignments`,
      `${BASE}/sessions`,
      `${BASE}/waitlists`,
    ];

    for (const path of absent) await http(api).get(path).expect(404);
  });
});
