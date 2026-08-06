import { beforeEach, describe, expect, it } from 'vitest';

import type { PeopleSnapshot } from '../contracts/views.js';

import { IMPORT_LIMIT, type ImportOutcome } from './transfer.use-case.js';
import {
  ALL,
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './people-test-harness.js';

/**
 * Bulk import — which is precisely when a register acquires its duplicates.
 *
 * The property worth proving is that import takes **no shortcut**: it sends the same command an
 * administrator would, so every invariant and every duplicate check applies. A faster import that
 * wrote rows directly would bypass the check that is the entire point of AD-001.
 */

const rows = (count: number): readonly Record<string, unknown>[] =>
  Array.from({ length: count }, (_, index) => ({
    personNumber: `P-${String(index).padStart(4, '0')}`,
    legalName: { en: `Person ${String(index)}`, ar: `شخص ${String(index)}` },
  }));

describe('an import', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('creates every row through the same command an administrator uses', async () => {
    await asTenant(TENANT_A, async () => {
      const imported = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        rows: rows(5),
      });

      expect(imported.ok && imported.value.created).toBe(5);
      expect(imported.ok && imported.value.refused).toHaveLength(0);
    });
  });

  it('applies the same bilingual rule, refusing a row a screen would refuse', async () => {
    await asTenant(TENANT_A, async () => {
      const imported = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        rows: [{ personNumber: 'P-0001', legalName: { en: 'Only English' } }],
      });

      expect(imported.ok && imported.value.created).toBe(0);
      expect(imported.ok && imported.value.refused).toHaveLength(1);
    });
  });

  it('is resumable: a corrected file can simply be run again', async () => {
    await asTenant(TENANT_A, async () => {
      const first = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        rows: [...rows(2), { personNumber: 'P-BAD', legalName: { ar: 'ناقص' } }],
      });

      expect(first.ok && first.value.created).toBe(2);
      expect(first.ok && first.value.refused).toHaveLength(1);

      const corrected = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        rows: [...rows(2), { personNumber: 'P-BAD', legalName: { en: 'Fixed', ar: 'مصحح' } }],
      });

      // The two already written are skipped rather than failed, and the corrected row lands.
      expect(corrected.ok && corrected.value.skipped).toBe(2);
      expect(corrected.ok && corrected.value.created).toBe(1);
    });
  });

  it('runs duplicate detection on every row, and does not create a match by default', async () => {
    await asTenant(TENANT_A, async () => {
      const imported = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        rows: [
          {
            personNumber: 'P-0001',
            legalName: { en: 'Ahmed Al-Ghamdi', ar: 'أحمد الغامدي' },
            dateOfBirth: '1990-03-14',
          },
          {
            personNumber: 'P-0002',
            legalName: { en: 'Ahmed Alghamdi', ar: 'احمد الغامدي' },
            dateOfBirth: '1990-03-14',
          },
        ],
      });

      expect(imported.ok && imported.value.created).toBe(1);
      expect(imported.ok && imported.value.refused).toMatchObject([
        { personNumber: 'P-0002', reason: 'person_may_already_exist' },
      ]);
    });
  });

  it('creates the matches when the operator acknowledges them, and queues each for review', async () => {
    await asTenant(TENANT_A, async () => {
      const imported = await send<ImportOutcome>(harness, {
        commandName: 'people.import',
        acknowledgedDuplicates: true,
        rows: [
          {
            personNumber: 'P-0001',
            legalName: { en: 'Ahmed Al-Ghamdi', ar: 'أحمد الغامدي' },
            dateOfBirth: '1990-03-14',
          },
          {
            personNumber: 'P-0002',
            legalName: { en: 'Ahmed Alghamdi', ar: 'احمد الغامدي' },
            dateOfBirth: '1990-03-14',
          },
        ],
      });

      expect(imported.ok && imported.value.created).toBe(2);

      const queue = await ask<{ readonly total: number }>(harness, {
        queryName: 'people.list-duplicates',
        status: 'pending',
      });

      expect(queue.ok && queue.value.total).toBe(1);
    });
  });

  it('refuses a file beyond the bound by name, rather than being discovered at a timeout', async () => {
    await asTenant(TENANT_A, async () => {
      const imported = await send(harness, {
        commandName: 'people.import',
        rows: rows(IMPORT_LIMIT + 1),
      });

      expect(imported.ok).toBe(false);
      expect(!imported.ok && imported.error).toMatchObject({ kind: 'validation' });
    });
  });
});

describe('an export', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('round-trips a register through import and export', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, { commandName: 'people.import', rows: rows(3) });

      const exported = await ask<PeopleSnapshot>(harness, { queryName: 'people.export' });

      expect(exported.ok && exported.value.people).toHaveLength(3);
      expect(exported.ok && exported.value.people[0]?.legalName.ar).toContain('شخص');
    });
  });

  it('states the date it was taken as at, because the names in it are as at that date', async () => {
    await asTenant(TENANT_A, async () => {
      const exported = await ask<PeopleSnapshot>(harness, { queryName: 'people.export' });

      expect(exported.ok && exported.value.asOf).toBe('2026-08-06T09:00:00.000Z');
    });
  });
});
