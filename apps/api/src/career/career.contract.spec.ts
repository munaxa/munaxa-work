import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';

import { ALL_CAREER_PERMISSIONS } from '@work/career';

import {
  CONNECTION,
  EMPLOYEE_ID,
  POSITION_ID,
  TENANT_A,
  http,
  openCareerApi,
  permitting,
  requireDatabaseInCi,
  type CareerApiFixture,
  type PageBody,
  type PathDetailBody,
  type ProblemBody,
} from './career-api.fixture.js';
import {
  BASE,
  NAME,
  aCareerPlan,
  aPublishedPath,
  aTalentPool,
  post,
} from './career-api-scenario.js';

/**
 * What the Career API accepts, what it refuses, and what it hands back — over real PostgreSQL.
 *
 * Three claims, and each is about the *wire* rather than about the application below it, because
 * each is a place where a correct application can still be wrapped in a wrong API.
 *
 * **A civil date is a day, and an impossible day is refused rather than rolled forward.** `2026-02-30`
 * matches the shape a pattern can check, and `Date.parse` accepts it — V8 rolls the day into March
 * and hands back a perfectly good instant. Nothing in this module may do that: an assessment on the
 * thirtieth of February is not an assessment on the second of March, and a client that got a 201
 * back would never learn its date was changed.
 *
 * **A whole number survives the round trip as itself.** Career holds no money, no rate and no
 * percentage (ADR-0074), so the exactness question here is not about decimals — it is that a
 * sequence of `500`, a rank of `50` and an ordinal of `100` come back as the integers they were
 * sent as, having been through no arithmetic and no float.
 *
 * **Pagination is bounded and the total is the server's.** A page beyond the last is an empty page;
 * `NaN`, negative and oversized values fall back rather than reaching a repository as `offset NaN`.
 */

const suite = CONNECTION === undefined ? describe.skip : describe;

requireDatabaseInCi('The Career API contract suite');

suite('career API contract', () => {
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

  describe('civil dates', () => {
    const create = (effectiveFrom: string) =>
      http(application)
        .post(`${BASE}/paths`)
        .send({ code: 'finance', name: NAME, kind: 'management', effectiveFrom });

    it.each(['2026-02-28', '2024-02-29', '2026-12-31'])('accepts %s', async (day) => {
      await create(day).expect(201);
    });

    /**
     * The four impossible days, and the reason each is worth its own case.
     *
     * `2026-02-30` and `2026-04-31` are days that never existed in months that do. `2025-02-29` is
     * the leap-year trap — real in 2024, not in 2025, and a validator that checked only the shape
     * would accept both. Each is refused, and none is normalized: the response is a refusal, not a
     * 201 carrying a different date than the one that was sent.
     */
    it.each(['2026-02-30', '2025-02-29', '2026-04-31'])(
      'refuses %s as an impossible day',
      async (day) => {
        const response = await create(day);

        // 422: the shape is right and the calendar is wrong, so the domain refused it by name.
        expect([day, response.status]).toEqual([day, 422]);
        expect((response.body as ProblemBody).detail).toContain('career.rejection.');
      },
    );

    it.each(['26-02-28', '2026-2-28', '2026/02/28', 'yesterday', '2026-02-28T00:00:00Z', ''])(
      'refuses %s as a malformed shape, at the edge',
      async (day) => {
        // 400 rather than 422: this one never reaches a handler, because the pattern stops it.
        const response = await create(day);

        expect([day, response.status]).toEqual([day, 400]);
      },
    );

    it('stores and returns the day exactly as it was sent', async () => {
      const pathId = await aPublishedPath(application);
      const read = await http(application).get(`${BASE}/paths/${pathId}`).expect(200);

      expect(
        (read.body as { readonly path: { readonly effectiveFrom: string } }).path.effectiveFrom,
      ).toBe('2026-01-01');
    });
  });

  describe('exact values', () => {
    /**
     * Career's numbers are three bounded ordinals, and this is the exactness claim that applies.
     *
     * There is no `18.50` in this module to lose a trailing zero from: the schema has no `numeric`,
     * no `double precision` and no money column, and every value a human enters is a small whole
     * number they chose. What must survive is the integer itself — sent, stored as `smallint`, read
     * back through the view and serialized — with nothing on the path having done arithmetic on it.
     */
    it('returns a stage sequence at its bound as the integer it was sent as', async () => {
      const created = await post(application, `${BASE}/paths`, {
        code: 'finance',
        name: NAME,
        kind: 'management',
        effectiveFrom: '2026-01-01',
      });
      const pathId = created.pathId ?? '';

      await post(application, `${BASE}/paths/${pathId}/stages`, {
        sequence: 500,
        name: NAME,
        targetPositionId: POSITION_ID,
      });

      const read = await http(application).get(`${BASE}/paths/${pathId}`).expect(200);
      const { stages } = read.body as PathDetailBody;

      expect(stages[0]?.sequence).toBe(500);
      // Not `500.0`, not `'500'`, and not a float that happens to print as 500.
      expect(Number.isInteger(stages[0]?.sequence)).toBe(true);
      expect(JSON.stringify(read.body)).toContain('"sequence":500');
    });

    it('refuses a number past the domain’s bound, and a decimal where an ordinal belongs', async () => {
      const created = await post(application, `${BASE}/paths`, {
        code: 'finance',
        name: NAME,
        kind: 'management',
        effectiveFrom: '2026-01-01',
      });
      const pathId = created.pathId ?? '';
      const stage = (sequence: unknown) =>
        http(application).post(`${BASE}/paths/${pathId}/stages`).send({ sequence, name: NAME });

      await stage(501).expect(400);
      await stage(1.5).expect(400);
      await stage(0).expect(400);
      await stage(-1).expect(400);
      await stage('1').expect(400);
    });

    it('carries no criticality, potential band, nine-box code or score on any response', async () => {
      const pathId = await aPublishedPath(application);
      const responses = await Promise.all([
        http(application).get(`${BASE}/paths/${pathId}`).expect(200),
        http(application).get(`${BASE}/paths`).expect(200),
      ]);

      for (const response of responses) {
        const body = JSON.stringify(response.body);

        for (const forbidden of ['criticality', 'potentialBand', 'nineBox', 'score', 'rating']) {
          expect([forbidden, body.includes(forbidden)]).toEqual([forbidden, false]);
        }
      }
    });
  });

  describe('pagination', () => {
    const page = (query: string) => http(application).get(`${BASE}/pools${query}`).expect(200);

    const threePools = async (): Promise<void> => {
      await aTalentPool(application, 'pool-one');
      await aTalentPool(application, 'pool-two');
      await aTalentPool(application, 'pool-three');
    };

    it('pages a collection, and the total stays the server’s own count', async () => {
      await threePools();

      const first = (await page('?page=1&size=2')).body as PageBody<unknown>;
      const last = (await page('?page=2&size=2')).body as PageBody<unknown>;
      const beyond = (await page('?page=99&size=2')).body as PageBody<unknown>;

      // Three rows across two pages: two, then one, then nothing — and the total says three every
      // time. A `total` computed from the returned rows would read 2, 1, 0 and tell a client
      // building a pager that the collection shrank as they walked it.
      expect([first.items.length, first.total]).toEqual([2, 3]);
      expect([last.items.length, last.total]).toEqual([1, 3]);
      expect([beyond.items.length, beyond.total]).toEqual([0, 3]);
    });

    /**
     * A malformed page or size falls back rather than reaching a repository.
     *
     * `Number('abc')` is `NaN`, and `NaN` compares false against every bound — so a naive check
     * passes it straight through to `offset NaN`, which is a driver error and a 500. The assertion
     * is on the *effect*: three pools exist, and a malformed page still returns all three from page
     * one rather than an error or an empty page.
     */
    it.each(['?page=0', '?page=-3', '?page=abc', '?page=NaN', '?page=1.5', '?page='])(
      'falls back to the first page for %s rather than reaching the repository',
      async (query) => {
        await threePools();

        const body = (await page(query)).body as PageBody<unknown>;

        expect([query, body.items.length, body.total]).toEqual([query, 3, 3]);
      },
    );

    it.each(['?size=0', '?size=-1', '?size=NaN', '?size=abc', '?size='])(
      'falls back to the default size for %s',
      async (query) => {
        await threePools();

        const body = (await page(query)).body as PageBody<unknown>;

        expect([query, body.items.length, body.total]).toEqual([query, 3, 3]);
      },
    );

    it('honours the minimum size, and bounds an oversized one instead of refusing it', async () => {
      await threePools();

      const smallest = (await page('?size=1')).body as PageBody<unknown>;
      // 99999 is past the kernel's own maximum, which *throws* rather than clamping — so an API
      // that passed the number through would answer 500 here. It is bounded before it gets there.
      const oversized = (await page('?size=99999')).body as PageBody<unknown>;

      expect([smallest.items.length, smallest.total]).toEqual([1, 3]);
      expect([oversized.items.length, oversized.total]).toEqual([3, 3]);
    });

    it('is bounded on every collection, with no route returning an unbounded list', async () => {
      await aCareerPlan(application);
      await aPublishedPath(application);

      for (const collection of [
        'paths',
        'plans',
        'pools',
        'pool-memberships',
        'succession-plans',
        'mobility-recommendations',
      ]) {
        // Every collection answers a page shape — `items` beside a server-computed `total` — rather
        // than a bare array, which is what an unbounded read would return.
        const body = (await http(application).get(`${BASE}/${collection}`).expect(200))
          .body as PageBody<unknown>;

        expect([collection, Array.isArray(body.items), typeof body.total]).toEqual([
          collection,
          true,
          'number',
        ]);
      }
    });
  });

  describe('the shapes on the wire', () => {
    it('rejects a property the API never declared, rather than dropping it silently', async () => {
      const response = await http(application)
        .post(`${BASE}/succession-plans`)
        .send({ positionId: POSITION_ID, criticality: 'critical' })
        .expect(400);

      expect((response.body as ProblemBody).detail).toContain('criticality');
    });

    it('answers RFC 9457 problem details, with a correlation identifier and nothing internal', async () => {
      // A malformed identifier is refused at the edge as a 400 — the client sent bytes it can fix.
      // Before the pipe was added it reached `where id = $1`, and PostgreSQL's `22P02` escaped as a
      // 500: a defect that told a caller with a typo to report a bug.
      const response = await http(application).get(`${BASE}/paths/not-a-uuid`).expect(400);
      const problem = response.body as ProblemBody;

      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(problem.status).toBe(400);
      expect(problem.correlationId).toBeDefined();
      for (const leak of ['select ', 'career_path', 'at Object.', 'node_modules']) {
        expect([leak, JSON.stringify(problem).includes(leak)]).toEqual([leak, false]);
      }
    });

    it('refuses an employment Employment does not have, as a named 422', async () => {
      const response = await http(application)
        .post(`${BASE}/plans`)
        .send({ employmentId: '01900000-0000-7000-8000-00000000dead', startedOn: '2026-03-01' })
        .expect(422);

      expect((response.body as ProblemBody).detail).toBe('career.rejection.employment-not-found');
    });

    it('reports a dependency that cannot answer as a refusal, and writes nothing', async () => {
      fixture.facts.employmentReachable = false;

      const response = await http(application)
        .post(`${BASE}/plans`)
        .send({ employmentId: EMPLOYEE_ID, startedOn: '2026-03-01' })
        .expect(422);

      expect((response.body as ProblemBody).detail).toBe('career.rejection.employment-not-found');

      const after = (await http(application).get(`${BASE}/plans`).expect(200))
        .body as PageBody<unknown>;

      expect(after.total).toBe(0);
    });
  });
});
