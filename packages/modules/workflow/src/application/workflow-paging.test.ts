import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkflowDefinitionView } from '../contracts/views.js';
import type { PendingApprovalView } from '../contracts/execution-views.js';
import { publishedProcess, runningApproval } from './workflow-scenarios.js';
import { DEFAULT_PAGE_SIZE, MAXIMUM_PAGE_SIZE, pageOf } from './workflow-paging.js';
import { APPROVER, ask, harnessFor, type Harness } from './workflow-test-harness.js';
import type { Page } from './workflow-ports.js';

/**
 * Every bound a collection read takes, and the values a caller can actually send.
 *
 * `pageOf` is tested directly as well as through a query, because the interesting inputs are the
 * ones an HTTP edge might not have rejected: `NaN` from an unparsed string, a fraction, a negative,
 * `Infinity`. Career's and Learning's copies of this helper turn `NaN` into a `NaN` limit — they are
 * protected by a `class-validator` integer rule at the edge and are not defective in production, but
 * an application layer should not depend on an edge a reconciliation command or another module may
 * not pass through. This copy is written to survive them; the others are recorded as debt.
 */

describe('the page a query is bounded to', () => {
  it('defaults, clamps and floors rather than refusing', () => {
    expect(pageOf({})).toStrictEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(pageOf({ page: 3, size: 10 })).toStrictEqual({ limit: 10, offset: 20 });
    expect(pageOf({ size: 10_000 })).toStrictEqual({ limit: MAXIMUM_PAGE_SIZE, offset: 0 });
    expect(pageOf({ page: 0 })).toStrictEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(pageOf({ page: -5 })).toStrictEqual({ limit: DEFAULT_PAGE_SIZE, offset: 0 });
    expect(pageOf({ size: 0 })).toStrictEqual({ limit: 1, offset: 0 });
    expect(pageOf({ page: 2.9, size: 10.7 })).toStrictEqual({ limit: 10, offset: 10 });
  });

  it('never produces NaN or Infinity, whatever it is handed', () => {
    // The defect the shared shape has: `Math.max(1, NaN)` is `NaN`, which reaches `slice(NaN, NaN)`
    // in a fake and `limit NaN` in SQL. Both are asserted rather than assumed.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const page = pageOf({ page: value, size: value });

      expect(Number.isFinite(page.limit)).toBe(true);
      expect(Number.isFinite(page.offset)).toBe(true);
      expect(page.limit).toBeGreaterThanOrEqual(1);
      expect(page.offset).toBeGreaterThanOrEqual(0);
    }
    expect(pageOf({ page: Number.NaN, size: Number.NaN })).toStrictEqual({
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
    });
  });
});

describe('paging a collection of definitions', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = harnessFor();
    for (let index = 0; index < 7; index += 1) {
      await publishedProcess(harness, [APPROVER], `process-${String(index)}`);
    }
  });

  const definitions = (query: Record<string, unknown>): Promise<Page<WorkflowDefinitionView>> =>
    ask<Page<WorkflowDefinitionView>>(harness, {
      queryName: 'workflow.search-definitions',
      ...query,
    });

  it('returns the first page, a middle page, the final page and an empty page beyond', async () => {
    const first = await definitions({ page: 1, size: 3 });
    const middle = await definitions({ page: 2, size: 3 });
    const last = await definitions({ page: 3, size: 3 });
    const beyond = await definitions({ page: 4, size: 3 });

    expect(first.items).toHaveLength(3);
    expect(middle.items).toHaveLength(3);
    expect(last.items).toHaveLength(1);
    expect(beyond.items).toStrictEqual([]);
    // The total is the same on every page: it counts the predicate, not the page.
    for (const page of [first, middle, last, beyond]) expect(page.total).toBe(7);
  });

  it('does not overlap or skip rows between pages', async () => {
    const first = await definitions({ page: 1, size: 3 });
    const second = await definitions({ page: 2, size: 3 });
    const third = await definitions({ page: 3, size: 3 });
    const seen = [...first.items, ...second.items, ...third.items].map(
      (definition) => definition.definitionId,
    );

    expect(new Set(seen).size).toBe(7);
  });

  it('orders deterministically, so the same page twice is the same page', async () => {
    const once = await definitions({ page: 2, size: 2 });
    const again = await definitions({ page: 2, size: 2 });

    expect(once.items.map((row) => row.definitionId)).toStrictEqual(
      again.items.map((row) => row.definitionId),
    );
  });

  it('clamps an oversized request and still reports the true total', async () => {
    const page = await definitions({ page: 1, size: 10_000 });

    expect(page.items).toHaveLength(7);
    expect(page.total).toBe(7);
  });

  it('survives an invalid page, an invalid size and a NaN', async () => {
    const invalid = await definitions({ page: -1, size: -1 });
    const notNumbers = await definitions({ page: Number.NaN, size: Number.NaN });

    expect(invalid.items).toHaveLength(1);
    expect(invalid.total).toBe(7);
    expect(notNumbers.items).toHaveLength(7);
    expect(notNumbers.total).toBe(7);
  });

  it('counts only what the filter matches', async () => {
    const filtered = await definitions({ status: 'retired' });

    expect(filtered.items).toStrictEqual([]);
    // A total that ignored the filter would say seven.
    expect(filtered.total).toBe(0);
  });

  it('returns an empty page rather than an error for a collection with nothing in it', async () => {
    const empty = harnessFor();
    const page = await ask<Page<WorkflowDefinitionView>>(empty, {
      queryName: 'workflow.search-definitions',
    });

    expect(page).toStrictEqual({ items: [], total: 0 });
  });
});

describe('paging the queue and the timeline', () => {
  it('pages a queue deeper than the page asked for, and totals the whole of it', async () => {
    const harness = harnessFor();

    for (let index = 0; index < 5; index += 1) {
      await runningApproval(harness, [APPROVER], `requisition-${String(index)}`);
    }

    const first = await harness.as(APPROVER, () =>
      ask<Page<PendingApprovalView>>(harness, {
        queryName: 'workflow.pending-approvals',
        page: 1,
        size: 2,
      }),
    );
    const last = await harness.as(APPROVER, () =>
      ask<Page<PendingApprovalView>>(harness, {
        queryName: 'workflow.pending-approvals',
        page: 3,
        size: 2,
      }),
    );

    expect([first.items.length, first.total]).toStrictEqual([2, 5]);
    expect([last.items.length, last.total]).toStrictEqual([1, 5]);
  });

  it('pages an instance timeline oldest first', async () => {
    const harness = harnessFor();
    const running = await runningApproval(harness, [APPROVER]);
    const timeline = await ask<Page<{ event: string }>>(harness, {
      queryName: 'workflow.read-history',
      instanceId: running.instanceId,
      page: 1,
      size: 1,
    });

    expect(timeline.items[0]?.event).toBe('instance-started');
    expect(timeline.total).toBe(2);
  });
});
