import { describe, expect, it } from 'vitest';

import {
  ADMINISTRATOR,
  ask,
  givenCategory,
  givenViolation,
  harnessFor,
  OFFICER,
  tryAsk,
} from './relations-test-harness.js';
import { RelationsPermissions } from './relations-permissions.js';
import type { EscalationContextView, ViolationView } from '../contracts/views.js';

/**
 * Checkpoint 3's capability through the real handlers: the repeat count and the ordinal.
 *
 * Split from `checkpoint-three.test.ts` at the 400-line budget rather than exempted. The division is
 * by subject — that file covers the two approved decisions, this one covers the counting — so a
 * reader looking for the window rules finds them in one place.
 */

describe('Checkpoint 3 · repeat-violation context', () => {
  const seedViolations = async (
    harness: ReturnType<typeof harnessFor>,
    categoryId: string,
    employmentId: string,
    dates: readonly string[],
  ): Promise<void> => {
    for (const occurredOn of dates) {
      await givenViolation(harness, {
        employmentId,
        violationCategoryId: categoryId,
        occurredOn,
      });
    }
  };

  it('reports no occurrences for an employment with none', async () => {
    const harness = harnessFor();
    const categoryId = await givenCategory(harness, { repeatWindowDays: 180 });

    const context = await harness.as(OFFICER, () =>
      ask<EscalationContextView>(harness, {
        queryName: 'relations.escalation-context',
        employmentId: '01940000-0000-7000-8000-0000000000e9',
        violationCategoryId: categoryId,
        asAt: '2026-08-23',
      }),
    );

    expect(context).toMatchObject({ occurrences: 0, windowDays: 180, windowFrom: '2026-02-24' });
    expect(context.violationIds).toStrictEqual([]);
  });

  it("applies the tenant's configured window, so a different window gives a different answer", async () => {
    const harness = harnessFor();
    const employmentId = '01940000-0000-7000-8000-0000000000e5';
    const wide = await givenCategory(harness, { code: 'wide-window', repeatWindowDays: 180 });
    const narrow = await givenCategory(harness, { code: 'narrow-window', repeatWindowDays: 7 });

    await seedViolations(harness, wide, employmentId, ['2026-08-20', '2026-05-01']);
    await seedViolations(harness, narrow, employmentId, ['2026-08-20', '2026-05-01']);

    const askContext = (violationCategoryId: string) =>
      harness.as(OFFICER, () =>
        ask<EscalationContextView>(harness, {
          queryName: 'relations.escalation-context',
          employmentId,
          violationCategoryId,
          asAt: '2026-08-23',
        }),
      );

    // The whole point of Checkpoint 3: `repeat_window_days` now changes the result.
    expect((await askContext(wide)).occurrences).toBe(2);
    expect((await askContext(narrow)).occurrences).toBe(1);
  });

  it('counts the exact boundary day and excludes the day before it', async () => {
    const harness = harnessFor();
    const employmentId = '01940000-0000-7000-8000-0000000000e6';
    const categoryId = await givenCategory(harness, { repeatWindowDays: 180 });

    await seedViolations(harness, categoryId, employmentId, ['2026-02-24', '2026-02-23']);

    const context = await harness.as(OFFICER, () =>
      ask<EscalationContextView>(harness, {
        queryName: 'relations.escalation-context',
        employmentId,
        violationCategoryId: categoryId,
        asAt: '2026-08-23',
      }),
    );

    expect(context.occurrences).toBe(1);
  });

  it('refuses a malformed reference date rather than quietly using today', async () => {
    const harness = harnessFor();
    const categoryId = await givenCategory(harness);

    await expect(
      harness.as(OFFICER, () =>
        tryAsk(harness, {
          queryName: 'relations.escalation-context',
          employmentId: '01940000-0000-7000-8000-0000000000e7',
          violationCategoryId: categoryId,
          asAt: '23/08/2026',
        }),
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { kind: 'rejected', reason: 'relations.rejection.as_at_malformed' },
    });
  });

  it('refuses an unknown category', async () => {
    const harness = harnessFor();

    await expect(
      harness.as(OFFICER, () =>
        tryAsk(harness, {
          queryName: 'relations.escalation-context',
          employmentId: '01940000-0000-7000-8000-0000000000e8',
          violationCategoryId: '01940000-0000-7000-8000-00000000dead',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'not_found' } });
  });

  it('audits each violation the count disclosed, and none when it disclosed none', async () => {
    const harness = harnessFor();
    const employmentId = '01940000-0000-7000-8000-0000000000ea';
    const categoryId = await givenCategory(harness, { repeatWindowDays: 180 });

    await seedViolations(harness, categoryId, employmentId, ['2026-08-20', '2026-08-01']);
    harness.stores.accessRows.length = 0;

    await harness.as(ADMINISTRATOR, () =>
      ask<EscalationContextView>(harness, {
        queryName: 'relations.escalation-context',
        employmentId,
        violationCategoryId: categoryId,
        asAt: '2026-08-23',
      }),
    );

    expect(harness.stores.accessRows.map((row) => row.action)).toStrictEqual([
      'escalation_read',
      'escalation_read',
    ]);

    harness.stores.accessRows.length = 0;
    await harness.as(ADMINISTRATOR, () =>
      ask<EscalationContextView>(harness, {
        queryName: 'relations.escalation-context',
        employmentId: '01940000-0000-7000-8000-0000000000eb',
        violationCategoryId: categoryId,
        asAt: '2026-08-23',
      }),
    );

    expect(harness.stores.accessRows).toHaveLength(0);
  });

  it('requires the violation read permission', async () => {
    const harness = harnessFor({ permissions: [RelationsPermissions.categoryRead] });

    await expect(
      harness.as(OFFICER, () =>
        tryAsk(harness, {
          queryName: 'relations.escalation-context',
          employmentId: '01940000-0000-7000-8000-0000000000ec',
          violationCategoryId: '01940000-0000-7000-8000-0000000000cc',
        }),
      ),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } });
  });

  it('carries the occurrence ordinal on a single violation read', async () => {
    const harness = harnessFor();
    const employmentId = '01940000-0000-7000-8000-0000000000ed';
    const categoryId = await givenCategory(harness, { repeatWindowDays: 180 });

    await seedViolations(harness, categoryId, employmentId, ['2026-06-01', '2026-07-01']);

    const third = await givenViolation(harness, {
      employmentId,
      violationCategoryId: categoryId,
      occurredOn: '2026-08-01',
    });

    const view = await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId: third }),
    );

    expect(view.occurrence).toBe(3);
  });

  /** Nothing is written by any of this — the count is a projection, asserted as one. */
  it('persists no repeat state anywhere', async () => {
    const harness = harnessFor();
    const employmentId = '01940000-0000-7000-8000-0000000000ee';
    const categoryId = await givenCategory(harness, { repeatWindowDays: 180 });

    await seedViolations(harness, categoryId, employmentId, ['2026-08-01', '2026-08-02']);

    await harness.as(OFFICER, () =>
      ask<EscalationContextView>(harness, {
        queryName: 'relations.escalation-context',
        employmentId,
        violationCategoryId: categoryId,
        asAt: '2026-08-23',
      }),
    );

    for (const row of harness.stores.violationRows.values()) {
      const keys = Object.keys(row);

      for (const forbidden of ['occurrence', 'repeatCount', 'isRepeat', 'escalationLevel']) {
        expect(keys).not.toContain(forbidden);
      }
    }
  });
});
