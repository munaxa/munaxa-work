import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadEmployment, loadRecord } from './record-api';
import { anEmployment } from './record.fixture';

/**
 * The composition layer: which questions the record asks, and what it does when it gets no answer.
 *
 * Two kinds of assertion, and both matter for different reasons.
 *
 * **Behavioural** — the record must fail *closed*. In this deployment every business endpoint
 * answers 401, because the only `PlatformAuthenticationPort` implementation authenticates nobody,
 * so "no answer" is the ordinary condition rather than a fault. Every section must come back absent
 * rather than empty, and one module refusing must not take the others with it.
 *
 * **Structural** — read against the source rather than the behaviour, because the property is about
 * what this file is allowed to import and to send. A screen that reached into a module's internals,
 * or that sent a write, would be a boundary violation that no rendered output would reveal.
 */

const BASE = 'http://127.0.0.1:3000';
const SOURCE = readFileSync(new URL('./record-api.ts', import.meta.url), 'utf8');

/**
 * Every path a controller in this repository actually serves, read from the modules themselves.
 *
 * Collected rather than listed, so a route that is renamed or removed makes this fail instead of a
 * hand-kept copy quietly agreeing with a screen that is now wrong.
 */
const SERVED: readonly string[] = [
  'assets',
  'attendance',
  'career',
  'documents',
  'employment',
  'learning',
  'leave',
  'letters',
  'people',
  'relations',
].flatMap((module) => {
  const directory = new URL(`../../../../packages/modules/${module}/src/api/`, import.meta.url);

  return readdirSync(directory)
    .filter((file) => file.endsWith('.controller.ts'))
    .flatMap((file) =>
      [
        ...readFileSync(new URL(file, directory), 'utf8').matchAll(
          /@Controller\(\{ path: '([^']+)'/g,
        ),
      ].map((match) => match[1] ?? ''),
    );
});

const refuseEverything = (): void => {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 401 })));
};

const answerOnly = (path: string, body: unknown): void => {
  vi.stubGlobal('fetch', (input: string) =>
    Promise.resolve(
      input.startsWith(`${BASE}${path}`)
        ? new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        : new Response('', { status: 401 }),
    ),
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading one employee', () => {
  it('returns nothing for an employment the API will not answer for', async () => {
    refuseEverything();

    expect(await loadEmployment('01900000-0000-7000-8000-00000000e001')).toBeUndefined();
  });

  it('returns nothing rather than throwing when the API cannot be reached at all', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

    expect(await loadEmployment('01900000-0000-7000-8000-00000000e001')).toBeUndefined();
  });

  it('leaves every section absent when every module refuses', async () => {
    refuseEverything();

    const record = await loadRecord(anEmployment());

    expect(record.employment).toBeDefined();
    for (const value of [
      record.profile,
      record.assignments,
      record.reportingLines,
      record.contracts,
      record.documents,
      record.letters,
      record.balances,
      record.attendanceDays,
      record.career,
      record.learning,
      record.violations,
      record.clearance,
    ]) {
      expect(value).toBeUndefined();
    }
  });

  /**
   * The property the whole screen depends on: one module refusing is one section withheld, not a
   * blank page. A caller who may read documents and not disciplinary records sees the documents.
   */
  it('keeps the sections a caller may read when the others refuse', async () => {
    answerOnly('/api/v1/documents', { items: [{ documentId: 'd1' }] });

    const record = await loadRecord(anEmployment());

    expect(record.documents).toHaveLength(1);
    expect(record.violations).toBeUndefined();
    expect(record.clearance).toBeUndefined();
  });

  it('asks each module about the employment it was given, and no other', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await loadRecord(anEmployment());

    // Fourteen: the employment's own facts, its history, the operational modules, and the
    // tenant's leave types. The manager is the fifteenth and is not among them, because this
    // employment names none.
    expect(asked).toHaveLength(14);
    const other = '01900000-0000-7000-8000-00000000e002';
    for (const url of asked) expect(url).not.toContain(other);
    // The person's own read is keyed on the person; every other read is keyed on the employment.
    expect(asked.filter((url) => url.includes('00000000p001'))).toHaveLength(1);
  });

  /**
   * The manager costs a request only when there is a manager.
   *
   * An employment with no reporting line is the ordinary case for the top of an organization, and
   * spending a round trip to be told so on every one of those records is latency for nothing.
   */
  it('asks about the manager only when the employment names one', async () => {
    const manager = '01900000-0000-7000-8000-00000000e002';
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await loadRecord({ ...anEmployment(), managerEmploymentId: manager });

    expect(asked).toHaveLength(15);
    expect(asked.filter((url) => url.includes(manager))).toHaveLength(1);
  });

  it('resolves the manager to a name, and only the manager', async () => {
    const manager = '01900000-0000-7000-8000-00000000e002';
    answerOnly(`/api/v1/employments/${manager}`, {
      ...anEmployment(),
      personName: { en: 'Omar Nasser', ar: 'عمر ناصر' },
    });

    const record = await loadRecord({ ...anEmployment(), managerEmploymentId: manager });

    expect(record.managerName).toEqual({ en: 'Omar Nasser', ar: 'عمر ناصر' });
    // Nothing else was resolved to a name: a unit and a position have no bounded read by identifier.
    expect(record.assignments).toBeUndefined();
  });

  /**
   * The regression behind the status timeline: whose history renders is decided by the requested
   * employment, never by which row happened to be first in a page.
   *
   * The workforce directory used to fetch `page.items[0]`'s history and render it under a heading
   * that named nobody. The stub here answers a *different* history for each of two employments, so
   * a loader that asked for any employment other than the requested one returns the wrong
   * `recordedBy` and fails.
   */
  it('returns the requested employment’s history, with two distinct employments on offer', async () => {
    const requested = '01900000-0000-7000-8000-00000000e001';
    const other = '01900000-0000-7000-8000-00000000e002';
    const historyFor = (employmentId: string, recordedBy: string): unknown => ({
      employmentId,
      statusHistory: [
        {
          recordId: `${employmentId}-h1`,
          employmentId,
          toStatus: 'active',
          effectiveFrom: '2021-03-01',
          recordedBy,
          recordedAt: '2021-03-01T08:00:00.000Z',
        },
      ],
      assignments: [],
      reportingLines: [],
      contracts: [],
    });
    vi.stubGlobal('fetch', (input: string) => {
      const answers = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });

      if (input.startsWith(`${BASE}/api/v1/employments/${requested}/history`)) {
        return Promise.resolve(answers(historyFor(requested, 'membership-hr-041')));
      }
      if (input.startsWith(`${BASE}/api/v1/employments/${other}/history`)) {
        return Promise.resolve(answers(historyFor(other, 'membership-hr-099')));
      }
      return Promise.resolve(new Response('', { status: 401 }));
    });

    const record = await loadRecord(anEmployment());

    expect(record.history?.employmentId).toBe(requested);
    expect(record.history?.statusHistory[0]?.recordedBy).toBe('membership-hr-041');
  });

  it('never caches a page of one named person’s data', async () => {
    const options: RequestInit[] = [];
    vi.stubGlobal('fetch', (_input: string, init: RequestInit) => {
      options.push(init);
      return Promise.resolve(new Response('', { status: 401 }));
    });

    await loadRecord(anEmployment());

    for (const init of options) expect(init.cache).toBe('no-store');
  });
});

describe('what the composition layer is allowed to touch', () => {
  it('imports every type from a published contract, never from a module’s internals', () => {
    const imports = [...SOURCE.matchAll(/from '(@work\/[^']+)'/g)].map((match) => match[1] ?? '');

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      const published = specifier === '@work/config' || specifier.endsWith('/contracts');

      expect([specifier, published]).toEqual([specifier, true]);
    }
  });

  it('sends no write of any kind', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE', 'method:']) {
      expect([verb, SOURCE.includes(verb)]).toEqual([verb, false]);
    }
  });

  /**
   * Every path it asks for is served by a controller that exists.
   *
   * A screen calling a route nobody wrote fails at runtime as an empty section, which is exactly
   * what this deployment looks like when nothing is authenticated — so the mistake would be
   * invisible until somebody wired authentication up. Checking the prefixes against the modules'
   * own `@Controller` declarations catches it now.
   */
  it('asks only for paths a controller serves', () => {
    const asked = [...SOURCE.matchAll(/`\/(api\/v1\/)?([a-z][a-z-]*(?:\/[a-z][a-z-]*)*)/g)].map(
      (match) => match[2] ?? '',
    );

    expect(asked.length).toBeGreaterThan(0);
    for (const path of asked) {
      const served = SERVED.some(
        (controller) => path === controller || path.startsWith(`${controller}/`),
      );

      expect([path, served]).toEqual([path, true]);
    }
  });
});
