import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWorkflow } from './api';
import { RESPONSES, requested, stubEmpty, stubFetch, stubFiftyRows } from './api.fixture';
import { GROUP_ID } from './branches.fixture';

/**
 * What the screen asks the API for, how many times, and — the security assertion — with what.
 *
 * Two properties cannot be seen from any other suite. **The request count is bounded and does not
 * grow with the data**: a tenant with four thousand running approvals costs the same ten requests
 * as a tenant with one. And **no request names a person**: the two queue endpoints resolve the
 * caller from the authenticated request, so a membership on a query string would be this screen
 * asking to read somebody else's queue.
 *
 * What the screen *makes* of the answers is `api-payload.test.ts`; the stubbed API both suites run
 * against is `api.fixture.ts`. Split at the file-size budget, on that seam.
 */

describe('the requests the screen makes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks for exactly the ten endpoints it needs, and no others', async () => {
    stubFetch();

    await loadWorkflow();

    expect([...requested].sort()).toEqual([...Object.keys(RESPONSES)].sort());
    expect(requested).toHaveLength(10);
  });

  it('sends page and size on every collection request', async () => {
    stubFetch();

    await loadWorkflow();

    const collections = requested.filter((path) => path.includes('?'));

    // Three listings — workflows, approvals and approval groups — the timeline and the two queues.
    expect(collections).toHaveLength(6);
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

    expect(unpaged).toHaveLength(4);
    for (const path of unpaged) {
      expect([path, /\/[0-9a-f-]{36}(\/status)?$/.test(path)]).toEqual([path, true]);
    }
  });

  /**
   * The N+1 assertion, made where an N+1 would actually appear.
   *
   * Each listing returns rows; a screen that read a detail per row would issue one request per
   * workflow, per version, per approval, per approval group, per queue entry and per history entry.
   * Here the listings return **fifty rows each** and the request count is unchanged — which is the
   * only way to distinguish "reads the first row" from "reads every row" without counting by hand.
   *
   * The approval groups are the newest way to get this wrong: the listing carries no member count,
   * so a column showing one would take a detail read per row. Fifty groups, one detail read.
   */
  it('issues the same requests for fifty rows as for one', async () => {
    stubFiftyRows();

    await loadWorkflow();

    // Fifty workflows, fifty approvals, fifty groups, fifty queue entries, fifty timeline entries —
    // and still ten requests. A per-row read would have made this three hundred.
    expect(requested).toHaveLength(10);
    expect(requested.filter((path) => path.startsWith('/definitions/'))).toHaveLength(1);
    expect(requested.filter((path) => path.startsWith('/instances/'))).toHaveLength(2);
    expect(requested.filter((path) => path.includes('/status'))).toHaveLength(1);
    // One group detail for fifty groups, and never one per row.
    expect(requested.filter((path) => path.startsWith('/approval-groups/'))).toHaveLength(1);
  });

  /** A tenant with one group of everything: the detail read happens once, for that one row. */
  it('reads one group’s members, and reads them from the first row of the listing', async () => {
    stubFetch();

    const workflow = await loadWorkflow();

    expect(requested.filter((path) => path.startsWith('/approval-groups/'))).toEqual([
      `/approval-groups/${GROUP_ID}`,
    ]);
    expect(workflow.group?.members).toHaveLength(2);
    // The listing's total is the server's own count over the tenant, not the page it returned.
    expect([workflow.groups.length, workflow.groupsTotal]).toEqual([1, 90]);
  });

  it('makes five requests for an empty tenant, because there is no first row to read', async () => {
    stubEmpty();

    const workflow = await loadWorkflow();

    // The three listings and the two queues, and none of the four details.
    expect(requested).toHaveLength(5);
    expect(workflow.unavailable).toBe(false);
    expect(workflow.definitionsTotal).toBe(0);
  });

  /** One row is the ordinary case, and it costs the full ten — no more and no fewer. */
  it('makes ten requests for a tenant with one of everything', async () => {
    stubFetch();

    await loadWorkflow();

    expect(requested).toHaveLength(10);
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

  /**
   * And asks for **nothing about the manager or the target** beyond the rows it already has.
   *
   * Phase 16C is the shape that would make a per-row request tempting: a manager step names a
   * membership, a step carries a service level, and a screen wanting either the person's name or the
   * time left could reach for a lookup per row. Both arrive inside the reads above, so none of these
   * paths is asked for — and a screen that started asking would fail here rather than in a
   * production trace.
   */
  it('asks for no manager, reporting line or service-level lookup of its own', async () => {
    stubFetch();

    await loadWorkflow();

    for (const path of requested) {
      for (const lookup of [
        'manager',
        'reporting',
        'my-manager',
        'sla',
        'service-level',
        'routing',
        'escalation',
        'expiry',
        'asOf',
        'now=',
      ]) {
        expect([path, lookup, path.includes(lookup)]).toEqual([path, lookup, false]);
      }
    }
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
