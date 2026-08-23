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
import { relationsModule } from './relations-module.js';
import { ALL_RELATIONS_PERMISSIONS, RelationsPermissions } from './relations-permissions.js';
import { inMemoryRelationsStores } from './in-memory-stores.js';
import type { ViolationPageView, ViolationView } from '../contracts/views.js';

/**
 * Who may do what — and, more importantly, who may not.
 *
 * AD-007 says access here is restricted **independently of ordinary employee access**. That is a
 * claim about permissions nobody holds, so most of this suite is negative: it tries every
 * neighbouring grant, every wildcard somebody might reach for, and every permission from every other
 * module, and asserts that each one opens nothing.
 */

const OTHER_MODULE_PERMISSIONS = [
  'employee.read',
  'employment.read',
  'employment.manage',
  'people.read',
  'document.read',
  'document.manage',
  'document.read-sensitive',
  'letter.include-salary',
  'workflow.instance.read',
  'workflow.approval.read-own',
  'performance.review.read',
  'payroll.run.manage',
  'organization.calendar.read',
  'identity.membership.read',
];

const WILDCARDS = [
  '*',
  'relations.*',
  'relations.violation.*',
  'relations.category.*',
  'relations',
];

describe('the permission set', () => {
  it('is exactly four, and every one is explicit', () => {
    expect(ALL_RELATIONS_PERMISSIONS).toStrictEqual([
      'relations.category.read',
      'relations.category.manage',
      'relations.violation.read',
      'relations.violation.record',
    ]);
  });

  /**
   * No permission names a capability that does not exist.
   *
   * A grant for investigations, actions, warnings, grievances or appeals would be one somebody could
   * hold over nothing — and the day the capability lands, they hold it already (D-5.2-04).
   */
  it.each([
    'investigation',
    'action',
    'warning',
    'grievance',
    'appeal',
    'penalty',
    'admin',
    'manage-all',
  ])('declares nothing for the absent capability %s', (absent) => {
    expect(
      ALL_RELATIONS_PERMISSIONS.filter((permission) => permission.includes(absent)),
    ).toStrictEqual([]);
  });

  it('contains no wildcard and no prefix', () => {
    for (const permission of ALL_RELATIONS_PERMISSIONS) {
      expect(permission).not.toContain('*');
      expect(permission.startsWith('relations.')).toBe(true);
    }
  });

  /** Every handler declares one, and the four declared are exactly the four published. */
  it('is declared one per handler, and covers every handler', () => {
    const module = relationsModule({
      unitOfWork: { execute: () => Promise.reject(new Error('not called')) } as never,
      stores: inMemoryRelationsStores(),
      employments: { exists: () => Promise.resolve(true) },
      clock: { now: () => new Date() },
    });
    const declared = [...(module.commands ?? []), ...(module.queries ?? [])].map(
      (handler) => handler.permission,
    );

    expect(declared).toHaveLength(6);
    for (const permission of declared) expect(ALL_RELATIONS_PERMISSIONS).toContain(permission);
    expect([...new Set(declared)].sort()).toStrictEqual([...ALL_RELATIONS_PERMISSIONS].sort());
  });
});

describe('what each operation requires', () => {
  const EMPLOYMENT = uuidV7();

  const harnessWith = (permissions: readonly string[]): Harness => {
    const harness = harnessFor({ permissions });

    harness.employments.add(EMPLOYMENT);
    return harness;
  };

  it('opens the catalogue to a reader, and refuses them the ability to change it', async () => {
    const seeded = harnessFor();

    seeded.employments.add(EMPLOYMENT);
    await givenCategory(seeded);

    const reader = harnessWith([RelationsPermissions.categoryRead]);

    await expect(
      reader.as(ADMINISTRATOR, () => ask(reader, { queryName: 'relations.categories' })),
    ).resolves.toStrictEqual([]);

    const refused = await reader.as(ADMINISTRATOR, () =>
      attempt(reader, {
        commandName: 'relations.define-category',
        code: 'late-arrival',
        name: { en: 'Late', ar: 'تأخر' },
        severity: 'minor',
        sequence: 1,
        repeatWindowDays: 30,
        source: 'tenant',
      }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('forbidden');
  });

  /**
   * Recording is not reading. Somebody who may file a report is not thereby entitled to browse
   * everyone else's — which is the separation AD-007 asks for, stated as a test.
   */
  it('lets a recorder record, and refuses them the read', async () => {
    const setup = harnessFor();

    setup.employments.add(EMPLOYMENT);

    const categoryId = await givenCategory(setup);
    const recorder = harnessWith([RelationsPermissions.violationRecord]);
    const recorded = await recorder.as(OFFICER, () =>
      attempt(recorder, {
        commandName: 'relations.record-violation',
        employmentId: EMPLOYMENT,
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Something happened.',
      }),
    );

    // The category lives in the other harness's store, so this refusal is `not_found` rather than
    // `forbidden` — which is the point: authorization passed, and the *data* was absent.
    expect(recorded.ok ? '' : recorded.error.kind).not.toBe('forbidden');

    const refused = await recorder.as(OFFICER, () =>
      tryAsk(recorder, { queryName: 'relations.read-violation', violationId: uuidV7() }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('forbidden');
  });

  it.each([
    ['relations.categories', { queryName: 'relations.categories' }],
    ['relations.read-violation', { queryName: 'relations.read-violation', violationId: uuidV7() }],
    ['relations.violations', { queryName: 'relations.violations', employmentId: uuidV7() }],
  ])('refuses %s to a caller holding nothing at all', async (_name, query) => {
    const nobody = harnessWith([]);
    const refused = await nobody.as(OFFICER, () => tryAsk(nobody, query));

    expect(refused.ok ? '' : refused.error.kind).toBe('forbidden');
  });

  it.each(OTHER_MODULE_PERMISSIONS)(
    'is not opened by %s from another module',
    async (permission) => {
      const outsider = harnessWith([permission]);

      for (const query of [
        { queryName: 'relations.categories' },
        { queryName: 'relations.read-violation', violationId: uuidV7() },
        { queryName: 'relations.violations', employmentId: uuidV7() },
      ]) {
        const refused = await outsider.as(OFFICER, () => tryAsk(outsider, query));

        expect(refused.ok ? '' : refused.error.kind).toBe('forbidden');
      }
    },
  );

  it.each(WILDCARDS)('is not opened by the pretender %s', async (pretender) => {
    const pretending = harnessWith([pretender]);
    const refused = await pretending.as(OFFICER, () =>
      tryAsk(pretending, { queryName: 'relations.categories' }),
    );

    expect(refused.ok ? '' : refused.error.kind).toBe('forbidden');
  });
});

describe('the access trail', () => {
  let harness: Harness;
  const EMPLOYMENT = uuidV7();
  let violationId: string;

  beforeEach(async () => {
    harness = harnessFor();
    harness.employments.add(EMPLOYMENT);

    const categoryId = await givenCategory(harness);
    const created = await harness.as(OFFICER, () =>
      send<{ violationId: string }>(harness, {
        commandName: 'relations.record-violation',
        employmentId: EMPLOYMENT,
        violationCategoryId: categoryId,
        occurredOn: '2026-08-14',
        description: 'Absent without notice.',
      }),
    );

    violationId = created.violationId;
    harness.stores.accessRows.length = 0;
  });

  it('records a read of one violation, naming the reader and the record', async () => {
    await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId }),
    );

    expect(harness.stores.accessRows).toHaveLength(1);
    expect(harness.stores.accessRows[0]?.action).toBe('violation_read');
    expect(harness.stores.accessRows[0]?.actor).toBe(OFFICER);
    expect(harness.stores.accessRows[0]?.violationId).toBe(violationId);
  });

  /** One event per record disclosed, not one per query — otherwise which records were seen is lost. */
  it('records one entry per violation a list disclosed', async () => {
    await harness.as(OFFICER, () =>
      ask<ViolationPageView>(harness, {
        queryName: 'relations.violations',
        employmentId: EMPLOYMENT,
      }),
    );

    expect(harness.stores.accessRows).toHaveLength(1);
    expect(harness.stores.accessRows[0]?.action).toBe('violation_listed');
  });

  /**
   * A catalogue read is **not** audited, and that line is the approval's.
   *
   * A catalogue names nobody. Auditing it would be the "audit every query" mechanism D-5.2-05
   * forbids, and it would bury the reads that matter under reads that never mattered.
   */
  it('records nothing for a catalogue read', async () => {
    await harness.as(ADMINISTRATOR, () => ask(harness, { queryName: 'relations.categories' }));

    expect(harness.stores.accessRows).toHaveLength(0);
  });

  it('records nothing when the violation was not found, so an identifier cannot write into the trail', async () => {
    await harness.as(OFFICER, () =>
      tryAsk(harness, { queryName: 'relations.read-violation', violationId: uuidV7() }),
    );

    expect(harness.stores.accessRows).toHaveLength(0);
  });

  it('records nothing when the caller was refused, because no handler ran', async () => {
    const outsider = harnessFor({ permissions: [] });

    await outsider.as(OFFICER, () =>
      tryAsk(outsider, { queryName: 'relations.read-violation', violationId }),
    );

    expect(outsider.stores.accessRows).toHaveLength(0);
  });

  /**
   * The trail says who looked at what, and nothing about the matter.
   *
   * Copying the employment, category or description here would make the audit table a second,
   * less-guarded copy of the thing it audits.
   */
  it('carries no employment, category, severity or description', async () => {
    await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId }),
    );

    const [event] = harness.stores.accessRows;

    expect(Object.keys(event ?? {}).sort()).toStrictEqual([
      'accessEventId',
      'action',
      'actor',
      'correlationId',
      'occurredAt',
      'violationId',
    ]);
    expect(JSON.stringify(event)).not.toContain(EMPLOYMENT);
    expect(JSON.stringify(event)).not.toContain('Absent without notice');
  });

  it('carries the correlation identifier of the request that made the read', async () => {
    await harness.as(OFFICER, () =>
      ask<ViolationView>(harness, { queryName: 'relations.read-violation', violationId }),
    );

    expect(harness.stores.accessRows[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
