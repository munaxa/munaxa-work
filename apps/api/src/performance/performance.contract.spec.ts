import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ALL_PERFORMANCE_PERMISSIONS } from '@work/performance';

import {
  CONNECTION,
  HR,
  TENANT_A,
  http,
  openPerformanceApi,
  permitting,
  requireDatabaseInCi,
  type PageBody,
  type PerformanceApiFixture,
  type ProblemBody,
} from './performance-api.fixture.js';
import { BASE, NAME, configure, enrol, post } from './performance-api-scenario.js';
import { DOCUMENT_ID, EMPLOYEE_ID, MANAGER_ID, PEER_ID } from './phase-thirteen-upstream.js';

/**
 * The Performance API's contract: what a valid request returns, what an invalid one returns, and
 * which route a path resolves to.
 *
 * Route resolution is asserted rather than commented. Nest resolves by controller declaration
 * order, and three prefixes are shared between controllers — `performance/reviews`,
 * `performance/goals` and `performance/cycles`. A `:reviewId` declared before a literal segment
 * swallows it, which is the Phase 10 lesson and not one this module should have to learn again.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Performance API contract suite');

suite('performance API contract', () => {
  let fixture: PerformanceApiFixture;
  let api: INestApplication;

  beforeAll(async () => {
    fixture = await openPerformanceApi();
    api = await fixture.applicationFor(TENANT_A, permitting(...ALL_PERFORMANCE_PERMISSIONS), HR);
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('resolves every literal segment to its own route rather than to an identifier', async () => {
    const configured = await configure(api);

    // `talent/matrix` is a listing, not a placement whose identifier happens to be `matrix`.
    await http(api).get(`${BASE}/talent/matrix?cycleId=${configured.cycleId}`).expect(200);
    // `reconciliation` is a report, not a review.
    await http(api).get(`${BASE}/reconciliation?cycleId=${configured.cycleId}`).expect(200);
    // `calibration-sessions` is its own resource, not a cycle.
    await http(api).get(`${BASE}/calibration-sessions?cycleId=${configured.cycleId}`).expect(200);
    // And `:reviewId` still resolves when it is genuinely an identifier: a review that does not
    // exist is a 404 rather than a 200 from some other handler that matched first.
    await http(api).get(`${BASE}/reviews/${MANAGER_ID}`).expect(404);
  });

  it('returns the published shape for a rating scale, with scores as integer hundredths', async () => {
    await configure(api);

    const listing = (await http(api).get(`${BASE}/rating-scales`).expect(200)).body as PageBody<
      Record<string, unknown>
    >;
    const scale = listing.items[0] ?? {};

    expect(Object.keys(scale).sort()).toEqual(
      [
        'active',
        'code',
        'effectiveFrom',
        'levels',
        'maximumScore',
        'minimumScore',
        'name',
        'ratingScaleId',
        'version',
      ].sort(),
    );
    // No `id`, no `tenant_id`, no `created_by`, no `deleted_at`. A DTO is not a row.
    expect(scale['minimumScore']).toBe(100);
    expect(scale['maximumScore']).toBe(500);
    expect(scale['effectiveFrom']).toBe('2026-01-01');
  });

  it('refuses an undeclared property rather than silently dropping it', async () => {
    // `forbidNonWhitelisted` is what stops a client smuggling a field the API never declared into a
    // command — including one a future version might mean something by.
    const response = await http(api)
      .post(`${BASE}/goal-categories`)
      .send({ code: 'business', name: NAME, tenantId: TENANT_A })
      .expect(400);

    expect((response.body as ProblemBody).detail ?? '').toContain('tenantId');
  });

  it('separates a malformed request from a refused one: 400 for shape, 422 for the rule', async () => {
    const configured = await configure(api);

    // Malformed: `kind` is not a cycle kind. The client can fix it by sending different bytes.
    await http(api)
      .post(`${BASE}/cycles`)
      .send({
        code: 'another',
        name: NAME,
        reviewTemplateId: configured.templateId,
        kind: 'fortnightly',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      })
      .expect(400);

    // Well-formed and refused: the code is taken. Resending it unchanged will always fail, which is
    // why it must not be a 400 — a client that saw one would retry with a different payload forever.
    const conflicted = await http(api)
      .post(`${BASE}/cycles`)
      .send({
        code: 'annual-2026',
        name: NAME,
        reviewTemplateId: configured.templateId,
        kind: 'annual',
        periodStart: '2026-01-01',
        periodEnd: '2026-12-31',
      })
      .expect(409);

    expect((conflicted.body as ProblemBody).status).toBe(409);
  });

  it('refuses a civil date that is an instant, and one that is not a date at all', async () => {
    const configured = await configure(api);
    const body = {
      scope: 'individual',
      employmentId: EMPLOYEE_ID,
      cycleId: configured.cycleId,
      title: 'A goal',
      measurement: 'percentage',
      weightBasisPoints: 10_000,
      startDate: '2026-01-01',
    };

    // An ISO instant carries a time zone, and a due date does not have one. Accepting it would let
    // the same date mean two days depending on where the client was.
    await http(api)
      .post(`${BASE}/goals`)
      .send({ ...body, dueDate: '2026-06-30T00:00:00Z' })
      .expect(400);
    await http(api)
      .post(`${BASE}/goals`)
      .send({ ...body, dueDate: '30/06/2026' })
      .expect(400);
  });

  it('confirms an evidence document exists, and refuses a citation of one that does not', async () => {
    const configured = await configure(api);
    const body = {
      scope: 'individual',
      employmentId: EMPLOYEE_ID,
      cycleId: configured.cycleId,
      title: 'A goal with evidence',
      measurement: 'percentage',
      weightBasisPoints: 10_000,
      startDate: '2026-01-01',
      dueDate: '2026-06-30',
    };

    // The whole of the Documents integration is this one question. The response carries the
    // identifier and **no filename, size, hash or URL** — there is nothing else to carry, because
    // no storage adapter exists anywhere in this repository.
    const created = await post(api, `${BASE}/goals`, {
      ...body,
      evidenceDocumentId: DOCUMENT_ID,
    });
    const goal = (
      await http(api)
        .get(`${BASE}/goals/${created.goalId ?? ''}`)
        .expect(200)
    ).body as Record<string, unknown>;

    expect(goal['evidenceDocumentId']).toBe(DOCUMENT_ID);
    expect(Object.keys(goal)).not.toContain('url');
    expect(Object.keys(goal)).not.toContain('downloadUrl');
    expect(Object.keys(goal)).not.toContain('storageReference');

    fixture.facts.documentPresent = false;

    await http(api)
      .post(`${BASE}/goals`)
      .send({ ...body, title: 'Citing a ghost', evidenceDocumentId: DOCUMENT_ID })
      .expect(422);
  });

  it('returns self and peer assessments with no field implying either was counted', async () => {
    const configured = await configure(api);
    const reviewId = await enrol(api, configured.cycleId, EMPLOYEE_ID);

    await post(api, `${BASE}/reviews/${reviewId}/reviewers`, {
      reviewerEmploymentId: PEER_ID,
      role: 'peer',
    });

    const self = await post(api, `${BASE}/reviews/${reviewId}/assessments`, {
      assessmentKind: 'self',
      assessorEmploymentId: EMPLOYEE_ID,
    });

    await post(api, `${BASE}/assessments/${self.assessmentId ?? ''}/items`, {
      itemKind: 'competency',
      competencyId: configured.competencyIds[0],
      score: 500,
    });
    await post(api, `${BASE}/assessments/${self.assessmentId ?? ''}/submission`, {
      expectedVersion: 1,
    });

    const detail = (await http(api).get(`${BASE}/reviews/${reviewId}`).expect(200)).body as {
      readonly assessments: readonly Record<string, unknown>[];
      readonly peerAggregate: Record<string, unknown>;
    };
    const kept = detail.assessments.find((each) => each['assessmentKind'] === 'self') ?? {};
    const items = (kept['items'] ?? []) as readonly Record<string, unknown>[];

    // The self assessment is kept and readable in full — the employee's own 500 is still there.
    expect(kept['status']).toBe('submitted');
    expect(items.map((item) => item['score'])).toEqual([500]);
    // What is absent is any field suggesting it was weighted: no `weightBasisPoints`, no
    // `contribution`, no `countedTowards`. There is no weight for a self assessment, and the view
    // does not invent one.
    expect(Object.keys(kept)).not.toContain('weightBasisPoints');
    expect(Object.keys(kept)).not.toContain('contribution');
    expect(Object.keys(kept)).not.toContain('countedTowards');

    // The panel aggregate says `available`, never `anonymous`. Withholding a number is the only
    // protection this architecture provides, and the field name does not claim more.
    expect(Object.keys(detail.peerAggregate)).toContain('available');
    expect(Object.keys(detail.peerAggregate)).not.toContain('anonymous');
  });
});
