import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  categoryAmong,
  cycleAmong,
  loadDetailContext,
  loadEmployments,
  loadGoal,
  loadPerformanceRegister,
  loadReview,
  registerAnsweredNothing,
} from './api';
import { CYCLE, REVIEW_A, aCycle, aFullRegister } from './performance.fixture';

/**
 * What this layer asks the API, and what it does with the answers.
 *
 * The assertions are about requests and outcomes rather than markup: whether a read is bounded,
 * whether a refusal is told from a not-found, whether the number of requests grows with the number
 * of rows, and whether anything here writes.
 */

const page = <TItem>(items: readonly TItem[], total: number): Response =>
  new Response(JSON.stringify({ items, total }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const status = (code: number): Response => new Response('{}', { status: code });

const original = globalThis.fetch;

/** Every path the layer asked for, in order, so a caller can assert on the whole round. */
let asked: string[] = [];

const answering = (respond: (path: string) => Response): void => {
  asked = [];
  globalThis.fetch = vi.fn((input: string) => {
    asked.push(input);
    return Promise.resolve(respond(input));
  }) as unknown as typeof fetch;
};

beforeEach(() => {
  asked = [];
});

afterEach(() => {
  globalThis.fetch = original;
});

describe('every read is bounded, and none is issued per row', () => {
  it('asks for a page and a size on every collection read', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : page([], 0)));
    await loadPerformanceRegister();

    const collections = asked.filter((path) => !/\/(reviews|goals)\/[^?]+$/.test(path));

    for (const path of collections) {
      expect([path, path.includes('page=1&size=50')]).toEqual([path, true]);
    }
  });

  /**
   * The number of requests must not grow with the number of cycles, reviews or goals. The register
   * reads the cycle list, picks one, and scopes six reads to it.
   */
  it('issues a fixed round regardless of how many cycles the tenant has', async () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      aCycle({ cycleId: `c${String(index)}`, status: 'closed' }),
    );

    answering((path) => (path.includes('/cycles') ? page(many, 40) : page([], 0)));
    await loadPerformanceRegister();

    // Four configuration reads, the cycles, and six scoped to the chosen cycle.
    expect(asked).toHaveLength(11);
  });

  it('issues no cycle-scoped read at all when there is no cycle', async () => {
    answering(() => page([], 0));
    await loadPerformanceRegister();

    expect(asked).toHaveLength(5);
    expect(asked.some((path) => path.includes('cycleId='))).toBe(false);
  });

  it('scopes every cycle-scoped read to the cycle it chose', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : page([], 0)));
    await loadPerformanceRegister();

    const scoped = asked.filter((path) => path.includes('cycleId='));

    // Goals, reviews, calibration sessions, the matrix and reconciliation. Feedback is not scoped
    // by cycle: the API does not accept a cycle on that read.
    expect(scoped).toHaveLength(5);
    for (const path of scoped) {
      expect([path, path.includes(CYCLE)]).toEqual([path, true]);
    }
  });
});

describe('a refusal is not an empty page, and not a not-found', () => {
  it('keeps a refused read absent so the screen can say withheld', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : status(403)));

    const register = await loadPerformanceRegister();

    expect(register.cycles).toEqual({ items: [aCycle()], total: 1 });
    expect(register.reviews).toBeUndefined();
    expect(register.placements).toBeUndefined();
  });

  it('keeps an empty read as an empty page, which is a different answer', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : page([], 0)));

    const register = await loadPerformanceRegister();

    expect(register.reviews).toEqual({ items: [], total: 0 });
  });

  it('reports a 404 on a detail read as missing and a 403 as refused', async () => {
    answering(() => status(404));
    expect(await loadGoal('g1')).toEqual({ kind: 'missing' });
    expect(await loadReview(REVIEW_A)).toEqual({ kind: 'missing' });

    answering(() => status(403));
    expect(await loadGoal('g1')).toEqual({ kind: 'refused' });
    expect(await loadReview(REVIEW_A)).toEqual({ kind: 'refused' });
  });

  it('treats an unreachable API as refused rather than as missing', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('offline')));

    expect(await loadReview(REVIEW_A)).toEqual({ kind: 'refused' });
  });

  it('says nothing answered only when nothing did', () => {
    expect(registerAnsweredNothing(aFullRegister())).toBe(false);
  });
});

describe('the employments a detail page names', () => {
  it('asks for at most two, and only for the identifiers it was given', async () => {
    answering(() => new Response(JSON.stringify({}), { status: 200 }));
    await loadEmployments('e1', 'm1');

    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('/employments/e1');
    expect(asked[1]).toContain('/employments/m1');
  });

  it('asks for none when neither identifier is present', async () => {
    answering(() => status(200));
    const employments = await loadEmployments(undefined, undefined);

    expect(asked).toHaveLength(0);
    expect(employments).toEqual({ subject: undefined, manager: undefined });
  });
});

describe('naming a cycle or a category costs no request', () => {
  it('finds them in the lists the page already read', () => {
    const cycles = { items: [aCycle()], total: 1 };
    const categories = {
      items: [
        {
          goalCategoryId: 'y1',
          code: 'OPS',
          name: { en: 'Operational', ar: 'تشغيلي' },
          active: true,
          version: 1,
        },
      ],
      total: 1,
    };

    expect(cycleAmong(cycles, CYCLE)?.code).toBe('FY26-ANNUAL');
    expect(cycleAmong(cycles, 'absent')).toBeUndefined();
    expect(cycleAmong(undefined, CYCLE)).toBeUndefined();
    expect(categoryAmong(categories, 'y1')?.code).toBe('OPS');
    expect(categoryAmong(categories, undefined)).toBeUndefined();
  });

  it('reads both lists in one round', async () => {
    answering(() => page([], 0));
    await loadDetailContext();

    expect(asked).toHaveLength(2);
  });
});

describe('this slice writes nothing', () => {
  it('issues no request carrying a method other than the default GET', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : page([], 0)));
    await loadPerformanceRegister();
    await loadReview(REVIEW_A);
    await loadGoal('g1');
    await loadEmployments('e1', undefined);

    const mocked = globalThis.fetch as unknown as { mock: { calls: readonly unknown[][] } };

    for (const call of mocked.mock.calls) {
      const options = call[1] as RequestInit | undefined;

      expect(options?.method).toBeUndefined();
      expect(options?.body).toBeUndefined();
    }
  });

  it('names no identity in any composed request', async () => {
    answering((path) => (path.includes('/cycles') ? page([aCycle()], 1) : page([], 0)));
    await loadPerformanceRegister();

    for (const path of asked) {
      for (const identity of [
        'managerEmploymentId',
        'membership',
        'workforceUser',
        'platformUser',
        'onBehalfOf',
        '/me',
        'userId',
      ]) {
        expect([path, identity, path.includes(identity)]).toEqual([path, identity, false]);
      }
    }
  });
});
