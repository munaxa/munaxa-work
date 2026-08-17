import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWorkflow } from './api';
import { requested, stubFetch, stubUnreachable } from './api.fixture';
import { INSTANCE_ID, MANAGER } from './views.fixture';

/**
 * What the screen makes of the answers it gets — and of the ones it does not.
 *
 * The sibling suite counts requests; this one reads what came back. Both run against the same
 * stubbed API in `api.fixture.ts`, so neither can drift into testing a different product from the
 * other. Split from it at the file-size budget.
 *
 * The loader's whole job is to carry published values across without touching them, which is why
 * every assertion below is an equality against the fixture rather than a shape check: a total taken
 * from `items.length`, an absent field defaulted to zero, or a timeline re-sorted would each render
 * plausibly and be wrong.
 */

describe('what the screen does with an answer it did not get', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stops after the first read when the API will not answer at all', async () => {
    stubFetch(['/definitions?page=1&size=50']);

    const workflow = await loadWorkflow();

    // One request, and the screen says the service did not answer rather than rendering a tenant
    // with nothing in it. A wall of nine more failed requests would tell nobody anything.
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
    stubUnreachable();

    const workflow = await loadWorkflow();

    expect(workflow.unavailable).toBe(true);
    expect(workflow.definitions).toEqual([]);
  });
});

describe('the values the screen carries through', () => {
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

  /**
   * The 16C fields survive the transport **unchanged**, including the ones that are absent.
   *
   * `overdueByMinutes` is missing on a step within its target and present on one past it, and the
   * difference is the whole sentence: a loader that defaulted the absent one to zero would make
   * "not overdue" and "overdue by none" render identically, and no rendering test could tell them
   * apart afterwards.
   */
  it('carries the service level through untouched, absences included', async () => {
    stubFetch();

    const steps = (await loadWorkflow()).instance?.steps ?? [];

    expect(steps[1]?.serviceLevel).toStrictEqual({
      count: 2,
      unit: 'days',
      awaitingOn: '2026-02-28T23:30:00.000Z',
      dueOn: '2026-03-05T09:15:00.000Z',
      state: 'within',
    });
    expect(steps[1]?.serviceLevel?.overdueByMinutes).toBeUndefined();
    expect(steps[2]?.serviceLevel?.overdueByMinutes).toBe(90);
  });

  /**
   * A manager step reaches this screen as a **kind** in configuration and a **membership** at run
   * time, and the loader does neither half of the translation between them.
   */
  it('carries the manager configuration and its resolved membership through untouched', async () => {
    stubFetch();

    const workflow = await loadWorkflow();
    const steps = workflow.instance?.steps ?? [];
    const templates = workflow.definition?.publishedSteps ?? [];

    // Both rows exist, so neither assertion below can pass by finding nothing at that index.
    expect([steps.length, templates.length]).toEqual([3, 3]);
    // The running step is a membership and a concrete identifier, exactly as the API published it.
    // Nothing here re-reads it and nothing marks it as manager-derived.
    expect(steps[2]).toMatchObject({
      approverKind: 'membership',
      approverMembershipId: MANAGER,
    });
    // And the template it came from names a kind and nobody at all.
    expect(templates[2]).toMatchObject({
      approverKind: 'manager',
      serviceLevel: { count: 48, unit: 'hours' },
    });
    expect(templates[2]).not.toHaveProperty('approverMembershipId');
    expect(templates[2]).not.toHaveProperty('approverGroupId');
  });

  it('keeps every identifier and instant exactly as the API sent them', async () => {
    stubFetch();

    const workflow = await loadWorkflow();

    expect(workflow.instances[0]?.instanceId).toBe(INSTANCE_ID);
    expect(workflow.instances[0]?.startedOn).toBe('2026-02-28T23:30:00.000Z');
    expect(workflow.definitions[0]?.version).toBe(3);
  });
});
