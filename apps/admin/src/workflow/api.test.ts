import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadWorkflow } from './api';
import {
  DEFINITION_ID,
  INSTANCE_ID,
  aDefinition,
  aDefinitionDetail,
  aDelegatedDecision,
  aHistory,
  aPendingApproval,
  anApprovalStatus,
  anInstance,
  anInstanceDetail,
} from './views.fixture';

/**
 * What the screen asks the API for, how many times, and — the security assertion — with what.
 *
 * **Mocked at the HTTP-client boundary and nowhere else.** `globalThis.fetch` is replaced; every
 * layer above it is the real one. Nothing here mocks a repository, a store, an application handler
 * or a domain rule — those are proved by the API suites against real PostgreSQL, and a UI test that
 * stubbed them would be asserting against a product nobody built.
 *
 * Two properties cannot be seen from any other suite. **The request count is bounded and does not
 * grow with the data**: a tenant with four thousand running approvals costs the same eight requests
 * as a tenant with one. And **no request names a person**: the two queue endpoints resolve the
 * caller from the authenticated request, so a membership on a query string would be this screen
 * asking to read somebody else's queue.
 */

const BASE = 'http://127.0.0.1:3000/api/v1/workflow';

/** Every path the screen is allowed to ask for, and what the API answers with. */
const RESPONSES: Readonly<Record<string, unknown>> = {
  '/definitions?page=1&size=50': { items: [aDefinition()], total: 4000 },
  '/instances?page=1&size=50': { items: [anInstance()], total: 4000 },
  [`/definitions/${DEFINITION_ID}`]: aDefinitionDetail(),
  [`/instances/${INSTANCE_ID}`]: anInstanceDetail(),
  [`/instances/${INSTANCE_ID}/history?page=1&size=50`]: { items: aHistory(), total: 9 },
  [`/approvals/${INSTANCE_ID}/status`]: anApprovalStatus(),
  '/approvals/pending?page=1&size=50': { items: [aPendingApproval()], total: 12 },
  '/approvals/decided?page=1&size=50': { items: [aDelegatedDecision()], total: 7 },
};

let requested: string[] = [];

/**
 * A fetch that answers from the table above and records what was asked.
 *
 * An unknown path answers 404 rather than throwing, because that is what a real API does for a route
 * this screen should not have called — and a test that threw would report "the screen crashed" where
 * the real defect is "the screen asked for something it should not have".
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

  it('asks for exactly the eight endpoints it needs, and no others', async () => {
    stubFetch();

    await loadWorkflow();

    expect([...requested].sort()).toEqual([...Object.keys(RESPONSES)].sort());
    expect(requested).toHaveLength(8);
  });

  it('sends page and size on every collection request', async () => {
    stubFetch();

    await loadWorkflow();

    const collections = requested.filter((path) => path.includes('?'));

    // Two listings, the timeline and the two queues.
    expect(collections).toHaveLength(5);
    for (const path of collections) {
      expect([path, path.includes('page=1')]).toEqual([path, true]);
      expect([path, path.includes('size=50')]).toEqual([path, true]);
    }
  });

  /** Everything without a query string is a detail read of one identified record. */
  it('makes only identified detail reads without paging', async () => {
    stubFetch();

    await loadWorkflow();

    const unpaged = requested.filter((path) => !path.includes('?'));

    expect(unpaged).toHaveLength(3);
    for (const path of unpaged) {
      expect([path, /\/[0-9a-f-]{36}(\/status)?$/.test(path)]).toEqual([path, true]);
    }
  });

  /**
   * The N+1 assertion, made where an N+1 would actually appear.
   *
   * Each listing returns rows; a screen that read a detail per row would issue one request per
   * workflow, per version, per approval, per queue entry and per history entry. Here the listings
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

    await loadWorkflow();

    // Fifty workflows, fifty approvals, fifty queue entries, fifty timeline entries — and still
    // eight requests. A per-row read would have made this two hundred and fifty.
    expect(requested).toHaveLength(8);
    expect(requested.filter((path) => path.startsWith('/definitions/'))).toHaveLength(1);
    expect(requested.filter((path) => path.startsWith('/instances/'))).toHaveLength(2);
    expect(requested.filter((path) => path.includes('/status'))).toHaveLength(1);
  });

  it('makes four requests for an empty tenant, because there is no first row to read', async () => {
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

    const workflow = await loadWorkflow();

    // The two listings and the two queues, and none of the four details.
    expect(requested).toHaveLength(4);
    expect(workflow.unavailable).toBe(false);
    expect(workflow.definitionsTotal).toBe(0);
  });

  /** One row is the ordinary case, and it costs the full eight — no more and no fewer. */
  it('makes eight requests for a tenant with one of everything', async () => {
    stubFetch();

    await loadWorkflow();

    expect(requested).toHaveLength(8);
  });
});

/**
 * The security property, asserted as an absence.
 *
 * Every one of these parameter names is a way of saying "read somebody else's queue". The API
 * refuses an undeclared body property outright, but a *query* parameter is the shape a screen could
 * add without anything failing — so the check is here, over every request the screen makes.
 */
describe('the identity the screen never sends', () => {
  beforeEach(() => {
    requested = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('names nobody on any request, least of all on the two queues', async () => {
    stubFetch();

    await loadWorkflow();

    for (const path of requested) {
      for (const identity of [
        'membershipId',
        'workforceUserId',
        'platformUserId',
        'approverMembershipId',
        'approverId',
        'actorId',
        'onBehalfOf',
        'delegate',
        'me=',
        'self',
      ]) {
        expect([path, identity, path.includes(identity)]).toEqual([path, identity, false]);
      }
    }
  });

  it('sends nothing but the page and the size on either queue', async () => {
    stubFetch();

    await loadWorkflow();

    const queues = requested.filter((path) => path.startsWith('/approvals/'));

    expect(queues.filter((path) => path.includes('?'))).toEqual([
      '/approvals/pending?page=1&size=50',
      '/approvals/decided?page=1&size=50',
    ]);
  });

  it('never asks Recruitment, Identity or People for anything', async () => {
    stubFetch();

    await loadWorkflow();

    for (const path of requested) {
      for (const module of ['recruitment/', 'identity', 'people', 'organization', 'employment']) {
        expect([path, module, path.includes(module)]).toEqual([path, module, false]);
      }
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
    stubFetch(['/definitions?page=1&size=50']);

    const workflow = await loadWorkflow();

    // One request, and the screen says the service did not answer rather than rendering a tenant
    // with nothing in it. A wall of seven more failed requests would tell nobody anything.
    expect(requested).toHaveLength(1);
    expect(workflow.unavailable).toBe(true);
  });

  it('keeps a refused queue empty without claiming the tenant is', async () => {
    stubFetch(['/approvals/pending?page=1&size=50']);

    const workflow = await loadWorkflow();

    expect(workflow.unavailable).toBe(false);
    expect(workflow.pending).toEqual([]);
    expect(workflow.pendingTotal).toBe(0);
    // The rest of the page still answered, with the server's own totals.
    expect(workflow.definitionsTotal).toBe(4000);
    expect(workflow.decidedTotal).toBe(7);
  });

  it('survives a transport failure without turning it into data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );

    const workflow = await loadWorkflow();

    expect(workflow.unavailable).toBe(true);
    expect(workflow.definitions).toEqual([]);
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

    const workflow = await loadWorkflow();

    expect([workflow.definitions.length, workflow.definitionsTotal]).toEqual([1, 4000]);
    expect([workflow.instances.length, workflow.instancesTotal]).toEqual([1, 4000]);
    expect([workflow.pending.length, workflow.pendingTotal]).toEqual([1, 12]);
    expect([workflow.decided.length, workflow.decidedTotal]).toEqual([1, 7]);
    expect([workflow.history.length, workflow.historyTotal]).toEqual([3, 9]);
  });

  it('keeps the timeline in the order the API returned it', async () => {
    stubFetch();

    const workflow = await loadWorkflow();

    expect(workflow.history.map((entry) => entry.event)).toEqual([
      'instance-started',
      'step-awaiting',
      'step-approved',
    ]);
  });

  it('keeps every identifier and instant exactly as the API sent them', async () => {
    stubFetch();

    const workflow = await loadWorkflow();

    expect(workflow.instances[0]?.instanceId).toBe(INSTANCE_ID);
    expect(workflow.instances[0]?.startedOn).toBe('2026-02-28T23:30:00.000Z');
    expect(workflow.definitions[0]?.version).toBe(3);
  });
});
