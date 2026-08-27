import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadApproval, loadApprovals, loadInstance } from './api';
import { anInstanceDetail } from './approvals.fixture';

/**
 * What the approvals screens ask for, and what they do when they get no answer.
 *
 * **Behavioural** — refused and empty must survive the round trip as different values, because the
 * screen renders them as opposite sentences. In this deployment refused is the ordinary case: the
 * pipeline checks `workflow.approval.read-own` before the handler runs, and no request carries a
 * principal.
 *
 * **Structural** — read against the source, because the property is about what this file is allowed
 * to send. A composed request that named a membership would let anybody holding the permission read
 * anybody's queue, and no rendered output would reveal it.
 */

const BASE = 'http://127.0.0.1:3000/api/v1/workflow';
const SOURCE = readFileSync(new URL('./api.ts', import.meta.url), 'utf8');

/**
 * Every path this file constructs, and nothing else.
 *
 * The assertions below are about the *requests*, so they read the request literals rather than the
 * whole file: prose that explains why a queue may not name an approver would otherwise fail a test
 * looking for the word "approver" in a URL.
 */
const REQUESTS = [...SOURCE.matchAll(/read<[^(]*\(\s*`([^`]*)`/g)].map((match) => match[1] ?? '');

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading the queue', () => {
  it('reports a refusal as absent, not as an empty queue', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 403 })));

    const approvals = await loadApprovals();

    expect(approvals.pending).toBeUndefined();
    expect(approvals.decided).toBeUndefined();
  });

  it('reports an empty answer as an empty queue, not as a refusal', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ items: [], total: 0 })));

    const approvals = await loadApprovals();

    expect(approvals.pending).toEqual({ items: [], total: 0 });
    expect(approvals.decided).toEqual({ items: [], total: 0 });
  });

  it('keeps the queue a caller may read when the other is refused', async () => {
    vi.stubGlobal('fetch', (input: string) =>
      Promise.resolve(
        input.includes('/approvals/decided')
          ? json({ items: [{ decisionId: 'd1' }], total: 1 })
          : new Response('', { status: 403 }),
      ),
    );

    const approvals = await loadApprovals();

    expect(approvals.pending).toBeUndefined();
    expect(approvals.decided?.total).toBe(1);
  });

  /** The server's total, carried through untouched — never replaced by the page length. */
  it('carries the server’s total rather than the page length', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ items: [{ stepId: 's1' }], total: 317 })));

    const approvals = await loadApprovals();

    expect(approvals.pending?.total).toBe(317);
    expect(approvals.pending?.items).toHaveLength(1);
  });

  it('returns nothing rather than throwing when the API cannot be reached', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('ECONNREFUSED')));

    const approvals = await loadApprovals();

    expect(approvals.pending).toBeUndefined();
  });

  it('asks for both queues and nothing else', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 403 }));
    });

    await loadApprovals();

    expect(asked).toEqual([
      `${BASE}/approvals/pending?page=1&size=25`,
      `${BASE}/approvals/decided?page=1&size=25`,
    ]);
  });
});

describe('reading one approval', () => {
  it('returns nothing for an instance the API will not resolve', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 404 })));

    expect(await loadInstance('01900000-0000-7000-8000-00000000i001')).toBeUndefined();
  });

  it('asks for the timeline and the port status once the instance resolved', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (input: string) => {
      asked.push(input);
      return Promise.resolve(new Response('', { status: 403 }));
    });

    const approval = await loadApproval(anInstanceDetail());

    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('/instances/01900000-0000-7000-8000-00000000i001/history');
    expect(asked[1]).toContain('/approvals/01900000-0000-7000-8000-00000000i001/status');
    expect(approval.history).toBeUndefined();
    expect(approval.status).toBeUndefined();
  });

  it('never caches one person’s work', async () => {
    const options: RequestInit[] = [];
    vi.stubGlobal('fetch', (_input: string, init: RequestInit) => {
      options.push(init);
      return Promise.resolve(new Response('', { status: 403 }));
    });

    await loadApprovals();

    for (const init of options) expect(init.cache).toBe('no-store');
  });
});

describe('what the approvals reads are allowed to do', () => {
  /**
   * The most important structural property on these screens.
   *
   * Neither queue read may carry an identity of any kind. A queue endpoint that accepted one would
   * let anybody holding the permission read anybody's queue, which is why the API declares no such
   * parameter and why this file must not invent one.
   */
  it('names no identity in any composed request', () => {
    expect(REQUESTS.length).toBeGreaterThan(0);
    for (const request of REQUESTS) {
      for (const identity of [
        'membership',
        'workforceUser',
        'platformUser',
        'approver',
        'onBehalfOf',
        '/me',
        'userId',
      ]) {
        expect([request, identity, request.includes(identity)]).toEqual([request, identity, false]);
      }
    }
  });

  /**
   * The only value a queue read interpolates is the shared page constant.
   *
   * `${PAGE}` is `page=1&size=25`, fixed in this file and the same for every caller. Anything else
   * interpolated into a queue path would be a value from somewhere — and the only somewhere a
   * screen has is the request, which is exactly how a queue endpoint stops being the caller's own.
   */
  it('interpolates only the shared page constant into either queue read', () => {
    const queues = REQUESTS.filter(
      (request) =>
        request.startsWith('/approvals/pending') || request.startsWith('/approvals/decided'),
    );

    expect(queues).toHaveLength(2);
    for (const request of queues) {
      expect([...request.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1])).toEqual(['PAGE']);
    }
    expect(SOURCE).toContain("const PAGE = 'page=1&size=25'");
  });

  it('sends no write of any kind', () => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE', 'method:']) {
      expect([verb, SOURCE.includes(verb)]).toEqual([verb, false]);
    }
    // No request reaches the decision endpoint: deciding is a write and this slice makes none.
    for (const request of REQUESTS) expect(request).not.toContain('/decision');
  });

  it('imports only published contracts', () => {
    const imports = [...SOURCE.matchAll(/from '(@work\/[^']+)'/g)].map((match) => match[1] ?? '');

    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) {
      const published = specifier === '@work/config' || specifier.endsWith('/contracts');

      expect([specifier, published]).toEqual([specifier, true]);
    }
  });

  /** Every path it asks for is one the workflow module's controllers actually serve. */
  it('asks only for paths a controller serves', () => {
    const asked = [...SOURCE.matchAll(/`\/([a-z-]+(?:\/[a-z-]+)*)/g)].map(
      (match) => match[1] ?? '',
    );
    const controllers = readFileSync(
      new URL(
        '../../../../packages/modules/workflow/src/api/approval.controller.ts',
        import.meta.url,
      ),
      'utf8',
    );
    const instances = readFileSync(
      new URL(
        '../../../../packages/modules/workflow/src/api/instance.controller.ts',
        import.meta.url,
      ),
      'utf8',
    );

    expect(controllers).toContain("path: 'workflow/approvals'");
    expect(instances).toContain("path: 'workflow/instances'");
    expect(asked.length).toBeGreaterThan(0);
    for (const path of asked) {
      const [root] = path.split('/');

      expect([path, ['approvals', 'instances'].includes(root ?? '')]).toEqual([path, true]);
    }
  });
});
