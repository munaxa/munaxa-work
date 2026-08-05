import { beforeEach, describe, expect, it } from 'vitest';
import { assertSucceeded } from '@work/testing';

import type { OrganizationSnapshot } from '../contracts/views.js';
import { STANDARD_UNIT_TYPES } from '../contracts/standard-unit-types.js';

import {
  JANUARY,
  JUNE,
  TENANT_A,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
} from './organization-test-harness.js';

/**
 * Moving a whole structure in and out, and the standard levels offered as a starting set.
 *
 * The import assertions are the ones that matter: it dispatches the *same commands* an
 * administrator would issue one at a time, so every invariant applies — and because it is not
 * atomic, it has to be resumable, which is what the second-run test checks.
 */

const bilingual = (en: string, ar: string): Record<string, string> => ({ en, ar });

describe('moving a structure in and out', () => {
  beforeEach(() => {
    testClock.reset();
  });

  const aSmallImport = {
    unitTypes: [
      { code: 'company', name: bilingual('Company', 'شركة'), ordinal: 10 },
      {
        code: 'department',
        name: bilingual('Department', 'إدارة'),
        ordinal: 60,
        allowedParentCodes: ['company'],
        allowedAtRoot: false,
      },
    ],
    units: [
      // Deliberately out of order: the department appears before the company it belongs to. A
      // spreadsheet is not sorted, and a single-pass import would fail on the forward reference.
      {
        code: 'HR',
        unitTypeCode: 'department',
        name: bilingual('Human Resources', 'الموارد البشرية'),
        parentCode: 'GROUP',
        effectiveFrom: JANUARY,
      },
      {
        code: 'GROUP',
        unitTypeCode: 'company',
        name: bilingual('The Group', 'المجموعة'),
        effectiveFrom: JANUARY,
      },
    ],
  };

  it('loads a structure whose rows are in any order', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const imported = assertSucceeded(
        await send<{ unitsCreated: number; unitsPlaced: number }>(harness, {
          commandName: 'organization.import-structure',
          ...aSmallImport,
        }),
      );

      expect(imported).toMatchObject({ unitsCreated: 2, unitsPlaced: 2 });

      const snapshot = assertSucceeded(
        await ask<OrganizationSnapshot>(harness, { queryName: 'organization.export-structure' }),
      );

      expect(snapshot.units.map((unit) => unit.code).sort()).toEqual(['GROUP', 'HR']);
      expect(snapshot.placements).toHaveLength(2);
    }));

  it('can be run again after a correction, reusing what the first run wrote', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertSucceeded(
        await send(harness, { commandName: 'organization.import-structure', ...aSmallImport }),
      );

      // The whole point of resumability: the second run must not duplicate, and must not fail.
      const again = assertSucceeded(
        await send<{ unitsCreated: number; unitsReused: number; unitsPlaced: number }>(harness, {
          commandName: 'organization.import-structure',
          ...aSmallImport,
        }),
      );

      expect(again).toMatchObject({ unitsCreated: 0, unitsReused: 2, unitsPlaced: 2 });

      const snapshot = assertSucceeded(
        await ask<OrganizationSnapshot>(harness, { queryName: 'organization.export-structure' }),
      );

      expect(snapshot.units).toHaveLength(2);
      expect(snapshot.placements).toHaveLength(2);
    }));

  it('enforces the same invariants an administrator would meet one unit at a time', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const refused = await send(harness, {
        commandName: 'organization.import-structure',
        unitTypes: aSmallImport.unitTypes,
        units: [
          {
            code: 'HALF',
            unitTypeCode: 'company',
            // English only. The import must refuse it exactly as the API would.
            name: { en: 'Half named' },
            effectiveFrom: JANUARY,
          },
        ],
      });

      expect(refused.ok === false && refused.error).toMatchObject({ kind: 'rejected' });
    }));

  it('names the row when a parent is in neither the file nor the tenant', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);
      const refused = await send(harness, {
        commandName: 'organization.import-structure',
        unitTypes: aSmallImport.unitTypes,
        units: [
          {
            code: 'HR',
            unitTypeCode: 'department',
            name: bilingual('Human Resources', 'الموارد البشرية'),
            parentCode: 'MISSING',
            effectiveFrom: JANUARY,
          },
        ],
      });

      expect(refused.ok === false && refused.error).toMatchObject({
        kind: 'validation',
        failures: [{ field: 'units.HR.parentCode' }],
      });
    }));

  it('exports every placement period, not merely the structure in force today', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      assertSucceeded(
        await send(harness, { commandName: 'organization.import-structure', ...aSmallImport }),
      );

      const snapshot = assertSucceeded(
        await ask<OrganizationSnapshot>(harness, { queryName: 'organization.export-structure' }),
      );
      const hr = snapshot.units.find((unit) => unit.code === 'HR');

      if (hr === undefined) throw new Error('setup');

      // A second company arrives, and HR transfers to it in June. Running the same import
      // command with an extra row is how a structure grows — the existing rows are reused.
      assertSucceeded(
        await send(harness, {
          commandName: 'organization.import-structure',
          unitTypes: aSmallImport.unitTypes,
          units: [
            {
              code: 'GROUP2',
              unitTypeCode: 'company',
              name: bilingual('The Other Group', 'المجموعة الأخرى'),
              effectiveFrom: JANUARY,
            },
          ],
        }),
      );
      const group2 = assertSucceeded(
        await ask<OrganizationSnapshot>(harness, { queryName: 'organization.export-structure' }),
      ).units.find((unit) => unit.code === 'GROUP2');

      if (group2 === undefined) throw new Error('setup');
      assertSucceeded(
        await send(harness, {
          commandName: 'organization.place-unit',
          unitId: hr.id,
          parentUnitId: group2.id,
          effectiveFrom: JUNE,
        }),
      );

      const after = assertSucceeded(
        await ask<OrganizationSnapshot>(harness, { queryName: 'organization.export-structure' }),
      );

      // An export carrying only today's structure would be a backup that discarded the history
      // this module exists to keep.
      expect(after.placements.filter((period) => period.unitId === hr.id)).toHaveLength(2);
    }));
});

describe('the standard unit types', () => {
  it('are offered as data, and nothing installs them', () => {
    expect(STANDARD_UNIT_TYPES).toHaveLength(8);
    expect(STANDARD_UNIT_TYPES.map((type) => type.code)).toContain('legal-entity');
  });

  it('are named in both first-class languages, so a tenant adopting them reads correctly in Arabic', () => {
    for (const type of STANDARD_UNIT_TYPES) {
      expect(type.name.en.trim()).not.toBe('');
      expect(type.name.ar.trim()).not.toBe('');
    }
  });

  it('nominate exactly the level that carries a legal registration', () => {
    const carrying = STANDARD_UNIT_TYPES.filter((type) => type.carriesLegalEntity);

    expect(carrying.map((type) => type.code)).toEqual(['legal-entity']);
  });

  it('permit a legal entity beneath a legal entity, because groups register subsidiaries', () => {
    const legalEntity = STANDARD_UNIT_TYPES.find((type) => type.code === 'legal-entity');

    expect(legalEntity?.allowedParentCodes).toContain('legal-entity');
  });

  it('can be adopted through the ordinary command, with no special path', async () =>
    asTenant(TENANT_A, async () => {
      const harness = harnessFor(TENANT_A);

      for (const type of STANDARD_UNIT_TYPES) {
        assertSucceeded(
          await send(harness, { commandName: 'organization.define-unit-type', ...type }),
        );
      }

      const listed = assertSucceeded(
        await ask<readonly unknown[]>(harness, { queryName: 'organization.list-unit-types' }),
      );

      expect(listed).toHaveLength(STANDARD_UNIT_TYPES.length);
    }));
});
