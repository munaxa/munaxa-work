import { beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  ADMINISTRATOR,
  OFFICER,
  ask,
  attempt,
  givenCategory,
  harnessFor,
  send,
  tryAsk,
  type Harness,
} from './relations-test-harness.js';
import type {
  ViolationCategoryView,
  ViolationPageView,
  ViolationView,
} from '../contracts/views.js';

/**
 * The catalogue and the recording, through the real dispatcher.
 *
 * This is the suite that answers "can a tenant actually operate this": define what its policy
 * recognises, record that something happened, read it back, and find the trail of who looked.
 */

describe('the violation catalogue, end to end', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = harnessFor();
  });

  it('defines an entry, reads it back, and starts it in use', async () => {
    const categoryId = await givenCategory(harness);
    const found = await harness.as(ADMINISTRATOR, () =>
      ask<readonly ViolationCategoryView[]>(harness, { queryName: 'relations.categories' }),
    );

    expect(found).toHaveLength(1);
    expect(found[0]?.violationCategoryId).toBe(categoryId);
    expect([found[0]?.code, found[0]?.severity, found[0]?.active]).toStrictEqual([
      'unauthorized-absence',
      'major',
      true,
    ]);
  });

  /**
   * Ordering is `(sequence, code)`, and the tie is what this asserts.
   *
   * Two entries sharing a rank must still come back in the same order every time — otherwise a
   * tenant's catalogue reshuffles between page loads. The tie breaks on code, which is unique, so
   * the order is total.
   */
  it('orders by sequence, then by code, so a shared rank still orders deterministically', async () => {
    await givenCategory(harness, { code: 'zeta', sequence: 5 });
    await givenCategory(harness, { code: 'alpha', sequence: 5 });
    await givenCategory(harness, { code: 'first', sequence: 1 });

    const found = await harness.as(ADMINISTRATOR, () =>
      ask<readonly ViolationCategoryView[]>(harness, { queryName: 'relations.categories' }),
    );

    expect(found.map((entry) => entry.code)).toStrictEqual(['first', 'alpha', 'zeta']);
  });

  it('refuses a second entry with the same code, as a conflict rather than a rejection', async () => {
    await givenCategory(harness);

    const again = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'relations.define-category',
        code: 'unauthorized-absence',
        name: { en: 'Absence again', ar: 'غياب' },
        severity: 'minor',
        sequence: 20,
        repeatWindowDays: 30,
        source: 'tenant',
      }),
    );

    expect(again.ok).toBe(false);
    expect(again.ok ? '' : again.error.kind).toBe('conflict');
  });

  it('amends what may change and re-checks the invariants against the amended shape', async () => {
    const categoryId = await givenCategory(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-category',
        violationCategoryId: categoryId,
        expectedVersion: 1,
        severity: 'gross',
        sequence: 3,
      }),
    );

    const [entry] = await harness.as(ADMINISTRATOR, () =>
      ask<readonly ViolationCategoryView[]>(harness, { queryName: 'relations.categories' }),
    );

    expect([entry?.severity, entry?.sequence, entry?.version]).toStrictEqual(['gross', 3, 2]);

    const invalid = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'relations.amend-category',
        violationCategoryId: categoryId,
        expectedVersion: 2,
        sequence: -4,
      }),
    );

    expect(invalid.ok ? '' : invalid.error.kind).toBe('rejected');
  });

  /** Deactivation is how an entry leaves service. It disappears from the default read, not from history. */
  it('hides a deactivated entry by default and shows it on request', async () => {
    const categoryId = await givenCategory(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-category',
        violationCategoryId: categoryId,
        expectedVersion: 1,
        active: false,
      }),
    );

    const active = await harness.as(ADMINISTRATOR, () =>
      ask<readonly ViolationCategoryView[]>(harness, { queryName: 'relations.categories' }),
    );
    const all = await harness.as(ADMINISTRATOR, () =>
      ask<readonly ViolationCategoryView[]>(harness, {
        queryName: 'relations.categories',
        includeInactive: true,
      }),
    );

    expect(active).toHaveLength(0);
    expect(all).toHaveLength(1);
    expect(all[0]?.active).toBe(false);
  });

  it('answers not_found when amending an entry that does not exist', async () => {
    const missing = await harness.as(ADMINISTRATOR, () =>
      attempt(harness, {
        commandName: 'relations.amend-category',
        violationCategoryId: uuidV7(),
        expectedVersion: 1,
        severity: 'minor',
      }),
    );

    expect(missing.ok ? '' : missing.error.kind).toBe('not_found');
  });
});

describe('recording a violation, end to end', () => {
  let harness: Harness;
  const EMPLOYMENT = uuidV7();

  beforeEach(() => {
    harness = harnessFor();
    harness.employments.add(EMPLOYMENT);
  });

  const recordOne = async (overrides: Record<string, unknown> = {}): Promise<string> => {
    const categoryId =
      (overrides.violationCategoryId as string | undefined) ?? (await givenCategory(harness));
    const created = await harness.as(OFFICER, () =>
      send<{ violationId: string }>(harness, {
        commandName: 'relations.record-violation',
        employmentId: EMPLOYMENT,
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Absent for two consecutive shifts without notice.',
        ...overrides,
      }),
    );

    return created.violationId;
  };

  it('records it, and reads it back with the frozen category and the recording instant', async () => {
    const violationId = await recordOne();
    const found = await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId }),
    );

    expect([found.employmentId, found.categoryCode, found.severity, found.state]).toStrictEqual([
      EMPLOYMENT,
      'unauthorized-absence',
      'major',
      'reported',
    ]);
    expect(found.occurredOn).toBe('2026-08-14');
    expect(found.recordedOn).toBe('2026-08-22T09:00:00.000Z');
  });

  /**
   * The reporter is the caller, and it cannot be supplied.
   *
   * Asserted from both sides: the row carries the authenticated actor, and a command that tried to
   * set one is ignored rather than honoured.
   */
  it('takes the reporter from the execution context and ignores one sent in the command', async () => {
    const violationId = await recordOne({ reportedBy: 'user:somebody-else' });

    expect(harness.stores.violationRows.get(violationId)?.reportedBy).toBe(OFFICER);
  });

  it('never publishes the reporter', async () => {
    const violationId = await recordOne();
    const found = await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId }),
    );

    expect(Object.keys(found)).not.toContain('reportedBy');
    expect(JSON.stringify(found)).not.toContain(OFFICER);
  });

  /**
   * An employment this tenant does not have, and one that never existed, get the same answer.
   *
   * That is what stops this command being used to enumerate another organisation's workforce one
   * identifier at a time.
   */
  it('answers not_found for an employment Employment does not recognise', async () => {
    const categoryId = await givenCategory(harness);
    const refused = await harness.as(OFFICER, () =>
      attempt(harness, {
        commandName: 'relations.record-violation',
        employmentId: uuidV7(),
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Something happened.',
      }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('not_found');
  });

  it('answers not_found for a category that does not exist', async () => {
    const refused = await harness.as(OFFICER, () =>
      attempt(harness, {
        commandName: 'relations.record-violation',
        employmentId: EMPLOYMENT,
        violationCategoryId: uuidV7(),
        occurredOn: '2026-08-14',
        description: 'Something happened.',
      }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('not_found');
  });

  it('refuses a category that is no longer in use', async () => {
    const categoryId = await givenCategory(harness);

    await harness.as(ADMINISTRATOR, () =>
      send(harness, {
        commandName: 'relations.amend-category',
        violationCategoryId: categoryId,
        expectedVersion: 1,
        active: false,
      }),
    );

    const refused = await harness.as(OFFICER, () =>
      attempt(harness, {
        commandName: 'relations.record-violation',
        employmentId: EMPLOYMENT,
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Something happened.',
      }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('rejected');
  });

  /** Nothing is written when the employment is refused — the check runs before the insert. */
  it('writes nothing when the employment is refused', async () => {
    const categoryId = await givenCategory(harness);

    await harness.as(OFFICER, () =>
      attempt(harness, {
        commandName: 'relations.record-violation',
        employmentId: uuidV7(),
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Something happened.',
      }),
    );

    expect(harness.stores.violationRows.size).toBe(0);
    expect(harness.stores.accessRows).toHaveLength(0);
  });

  it('lists one employment’s violations, newest conduct first, and pages them', async () => {
    const categoryId = await givenCategory(harness);

    await recordOne({ violationCategoryId: categoryId, occurredOn: '2026-08-01' });
    await recordOne({ violationCategoryId: categoryId, occurredOn: '2026-08-20' });
    await recordOne({ violationCategoryId: categoryId, occurredOn: '2026-08-10' });

    const page = await harness.as(OFFICER, () =>
      ask<ViolationPageView>(harness, {
        queryName: 'relations.violations',
        employmentId: EMPLOYMENT,
        pageSize: 2,
      }),
    );

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.occurredOn)).toStrictEqual(['2026-08-20', '2026-08-10']);
  });

  it('returns nothing for an employment with no violations, rather than failing', async () => {
    const page = await harness.as(OFFICER, () =>
      ask<ViolationPageView>(harness, {
        queryName: 'relations.violations',
        employmentId: uuidV7(),
      }),
    );

    expect([page.total, page.items.length]).toStrictEqual([0, 0]);
  });

  it('answers not_found for a violation that does not exist', async () => {
    const missing = await harness.as(OFFICER, () =>
      tryAsk(harness, { queryName: 'relations.read-violation', violationId: uuidV7() }),
    );

    expect(missing.ok ? '' : missing.error.kind).toBe('not_found');
  });
});
