import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCareer } from './api';
import {
  aBench,
  aDevelopmentDetail,
  aLevel,
  aMembership,
  aPath,
  aPathDetail,
  aPlan,
  aPool,
  aReadinessHistory,
  aRecommendation,
  aSuccessionDetail,
  aSuccessionPlan,
  aSummary,
} from './views.fixture';

/**
 * What the screen asks the API for, and how many times.
 *
 * **Mocked at the HTTP-client boundary and nowhere else.** `globalThis.fetch` is replaced; every
 * layer above it is the real one. Nothing here mocks a repository, a store, an application handler
 * or a domain rule — those are proved by the API suites against real PostgreSQL, and a UI test that
 * stubbed them would be asserting against a product nobody built. This is the first Admin module to
 * assert its request budget; the technique adds no dependency, because `vi` is already how this
 * repository writes tests.
 *
 * The property that matters most here cannot be seen from any other suite: **the request count is
 * bounded and does not grow with the data**. An API test proves one endpoint answers; a render test
 * proves markup appears; only this proves that a tenant with four thousand career plans costs the
 * same number of requests as a tenant with one, and that no detail read is issued per row.
 */

/**
 * The base the portal environment defaults to, and the prefix the API applies.
 *
 * Taken from `WORK_API_URL`'s own default rather than guessed: a mismatch here would strip nothing
 * from the recorded URL, every path would fail to match the response table, and the suite would
 * report "the screen asked for nothing" where the real answer is "the test looked in the wrong
 * place".
 */
const BASE = 'http://127.0.0.1:3000/api/v1/career';

/** Every path the screen is allowed to ask for, and what the API answers with. */
const RESPONSES: Readonly<Record<string, unknown>> = {
  '/paths?page=1&size=50': { items: [aPath()], total: 4000 },
  '/plans?page=1&size=50': { items: [aPlan()], total: 4000 },
  '/pools?page=1&size=50': { items: [aPool()], total: 12 },
  '/pool-memberships?page=1&size=50': { items: [aMembership()], total: 90 },
  '/readiness/levels': { items: [aLevel()] },
  '/succession-plans?page=1&size=50': { items: [aSuccessionPlan()], total: 7 },
  '/mobility-recommendations?page=1&size=50': {
    items: [aRecommendation()],
    total: 3,
    asOf: '2026-02-28',
  },
  '/paths/01900000-0000-7000-8000-0000000000a1': aPathDetail(),
  '/succession-plans/01900000-0000-7000-8000-000000000111': aSuccessionDetail(),
  '/succession-plans/01900000-0000-7000-8000-000000000111/bench-strength': aBench(),
  '/summary/01900000-0000-7000-8000-0000000000e1': aSummary(),
  '/readiness/history/01900000-0000-7000-8000-0000000000e1': aReadinessHistory(),
  '/development-plans/01900000-0000-7000-8000-000000000151': aDevelopmentDetail(),
};

let requested: string[] = [];

/**
 * A fetch that answers from the table above and records what was asked.
 *
 * An unknown path answers 404 rather than throwing, because that is what a real API does for a
 * route this screen should not have called — and a test that threw would report "the screen
 * crashed" where the real defect is "the screen asked for something it should not have".
 */
const stubFetch = (missing: readonly string[] = []): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace(BASE, '');

      requested.push(path);

      const body = missing.includes(path) ? undefined : RESPONSES[path];

      return Promise.resolve({
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        json: () => Promise.resolve(body),
      });
    }),
  );
};

describe('the requests the screen makes', () => {
  beforeEach(() => {
    requested = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for exactly the thirteen endpoints it needs, and no others', async () => {
    stubFetch();

    await loadCareer();

    expect([...requested].sort()).toEqual([...Object.keys(RESPONSES)].sort());
    expect(requested).toHaveLength(13);
  });

  it('sends page and size on every collection request', async () => {
    stubFetch();

    await loadCareer();

    const collections = requested.filter((path) => path.includes('?'));

    expect(collections).toHaveLength(6);
    for (const path of collections) {
      // The repository's established Admin page size, on every one of them.
      expect([path, path.includes('page=1')]).toEqual([path, true]);
      expect([path, path.includes('size=50')]).toEqual([path, true]);
    }
  });

  /**
   * The one unpaged read, and why it is not an oversight.
   *
   * The readiness ladder is bounded by the domain at a hundred rungs rather than by a page, and the
   * API declares no paging parameters on it — a ladder shown in halves is not a ladder. It is the
   * only collection read without `page` and `size`, and that is asserted rather than left to be
   * noticed.
   */
  it('sends no paging on the readiness ladder, which the domain bounds instead', async () => {
    stubFetch();

    await loadCareer();

    const unpaged = requested.filter((path) => !path.includes('?'));

    expect(unpaged).toContain('/readiness/levels');
    // Everything else without a query string is a detail read of one identified record.
    for (const path of unpaged) {
      expect([path, path === '/readiness/levels' || /\/[0-9a-f-]{36}/.test(path)]).toEqual([
        path,
        true,
      ]);
    }
  });

  /**
   * The N+1 assertion, made where an N+1 would actually appear.
   *
   * Each listing returns rows; a screen that read a detail per row would issue one request per path,
   * per succession plan, per employee, per successor and per development item. Here the listings
   * return **fifty rows each** and the request count is unchanged — which is the only way to
   * distinguish "reads the first row" from "reads every row" without counting by hand.
   */
  it('issues the same requests for fifty rows as for one', async () => {
    const many = <TItem>(item: TItem): readonly TItem[] => Array.from({ length: 50 }, () => item);

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = url.replace(BASE, '');

        requested.push(path);

        const single = RESPONSES[path] as { items?: readonly unknown[] } | undefined;
        const body =
          single?.items === undefined ? single : { ...single, items: many(single.items[0]) };

        return Promise.resolve({
          ok: body !== undefined,
          status: body === undefined ? 404 : 200,
          json: () => Promise.resolve(body),
        });
      }),
    );

    await loadCareer();

    // Fifty paths, fifty plans, fifty benches, fifty successors, fifty recommendations — and still
    // thirteen requests. A per-row read would have made this two hundred and sixty.
    expect(requested).toHaveLength(13);
    expect(requested.filter((path) => path.startsWith('/paths/'))).toHaveLength(1);
    expect(requested.filter((path) => path.startsWith('/summary/'))).toHaveLength(1);
    expect(requested.filter((path) => path.includes('/bench-strength'))).toHaveLength(1);
  });

  it('makes seven requests for an empty tenant, because there is no first row to read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        requested.push(url.replace(BASE, ''));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ items: [], total: 0 }),
        });
      }),
    );

    const career = await loadCareer();

    // The seven collection reads and none of the six details: an empty listing has no first row.
    expect(requested).toHaveLength(7);
    expect(career.unavailable).toBe(false);
    expect(career.pathsTotal).toBe(0);
  });

  it('never asks Organization or Performance for anything', async () => {
    stubFetch();

    await loadCareer();

    for (const path of requested) {
      // Every request is under Career's own prefix, and none of them carries a criticality filter
      // or reaches for a talent matrix. The screen has no adapter for either (D-4, D-5).
      expect([path, path.includes('organization') || path.includes('performance')]).toEqual([
        path,
        false,
      ]);
      expect([path, path.includes('criticality')]).toEqual([path, false]);
      expect([path, path.includes('talent-matrix')]).toEqual([path, false]);
    }
  });
});

describe('what the screen does with an answer it did not get', () => {
  beforeEach(() => {
    requested = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops after the first read when the API will not answer at all', async () => {
    stubFetch(['/paths?page=1&size=50']);

    const career = await loadCareer();

    // One request, and the screen says the service did not answer rather than rendering a tenant
    // with nothing in it. A wall of twelve more failed requests would tell nobody anything.
    expect(requested).toHaveLength(1);
    expect(career.unavailable).toBe(true);
  });

  it('reports a refused listing as withheld rather than as an empty bench', async () => {
    stubFetch(['/succession-plans?page=1&size=50']);

    const career = await loadCareer();

    // A 403 on succession is a permission boundary, and the screen distinguishes it from a tenant
    // that keeps no benches — which is what turning a refusal into zero rows would hide.
    expect(career.unavailable).toBe(false);
    expect(career.successionWithheld).toBe(true);
    expect(career.successionPlans).toEqual([]);
    expect(career.successionPlansTotal).toBe(0);
    // And no detail was read for a listing that returned nothing.
    expect(requested.filter((path) => path.includes('/bench-strength'))).toHaveLength(0);
  });

  it('keeps the server’s total when one listing fails and others do not', async () => {
    stubFetch(['/plans?page=1&size=50']);

    const career = await loadCareer();

    expect(career.plansTotal).toBe(0);
    // The paths listing still answered, and its total is the server's four thousand.
    expect(career.pathsTotal).toBe(4000);
    expect(career.paths).toHaveLength(1);
  });

  it('survives a transport failure without turning it into data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const career = await loadCareer();

    expect(career.unavailable).toBe(true);
    expect(career.paths).toEqual([]);
  });
});

describe('the values the screen carries through', () => {
  beforeEach(() => {
    requested = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes every total from the server rather than from the rows it received', async () => {
    stubFetch();

    const career = await loadCareer();

    // One row each, and the totals are the server's own.
    expect([career.paths.length, career.pathsTotal]).toEqual([1, 4000]);
    expect([career.plans.length, career.plansTotal]).toEqual([1, 4000]);
    expect([career.pools.length, career.poolsTotal]).toEqual([1, 12]);
    expect([career.memberships.length, career.membershipsTotal]).toEqual([1, 90]);
    expect([career.successionPlans.length, career.successionPlansTotal]).toEqual([1, 7]);
    expect([career.recommendations.length, career.recommendationsTotal]).toEqual([1, 3]);
  });

  it('takes asOf from the server and never from a clock', async () => {
    stubFetch();

    const career = await loadCareer();

    expect(career.asOf).toBe('2026-02-28');
    // The fixture's day is deliberately not today's, so a screen that stamped its own clock would
    // fail this rather than pass by coincidence.
    expect(career.asOf).not.toBe(new Date().toISOString().slice(0, 10));
  });
});
