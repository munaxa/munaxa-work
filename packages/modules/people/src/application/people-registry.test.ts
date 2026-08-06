import { beforeEach, describe, expect, it } from 'vitest';

import type { PersonProfileView, PersonView } from '../contracts/views.js';

import {
  ALL,
  JANUARY,
  JUNE,
  MARCH,
  SEPTEMBER,
  TENANT_A,
  aPerson,
  asTenant,
  ask,
  harnessFor,
  send,
  testClock,
  type Harness,
} from './people-test-harness.js';

/**
 * The register itself, through the real pipeline.
 *
 * Every test in this file is run with **Arabic names**. Testing in English alone would let a
 * search that is broken for half this product's users pass the whole suite — the same reasoning
 * that made Phase 3 test its org chart in Arabic against a Riyadh working week.
 */

const SARA = { en: 'Sara Al-Amri', ar: 'سارة العامري' };
const SARA_MARRIED = { en: 'Sara Al-Ghamdi', ar: 'سارة الغامدي' };

describe('the register', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('gives one human being one permanent identifier', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);
      const read = await ask<PersonView>(harness, {
        queryName: 'people.read-person',
        personId,
      });

      expect(read.ok && read.value.personNumber).toBe('P-0001');
      expect(read.ok && read.value.legalName.ar).toBe('سارة العامري');
    });
  });

  it('refuses a second person with the number an existing one already has', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', SARA);

      const again = await send(harness, {
        commandName: 'people.create-person',
        personNumber: 'P-0001',
        legalName: { en: 'Someone Else', ar: 'شخص آخر' },
      });

      expect(again.ok).toBe(false);
      expect(!again.ok && again.error).toMatchObject({ reason: 'person_number_taken' });
    });
  });

  it('finds somebody by a half-remembered Arabic spelling, which is how a register is searched', async () => {
    await asTenant(TENANT_A, async () => {
      await aPerson(harness, 'P-0001', { en: 'Ahmed Al-Ghamdi', ar: 'أحمد الغامدي' });

      // Typed without the hamza — one name, two keyboards.
      const found = await ask<{ readonly items: readonly PersonView[] }>(harness, {
        queryName: 'people.search',
        term: 'احمد',
      });

      expect(found.ok && found.value.items).toHaveLength(1);
    });
  });

  it('holds no unit, position, manager or salary for anybody (AD-002, AD-003, AD-004)', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);
      const profile = await ask<PersonProfileView>(harness, {
        queryName: 'people.read-profile',
        personId,
      });

      const serialized = JSON.stringify(profile.ok ? profile.value : {});

      for (const forbidden of [
        'unitId',
        'positionId',
        'managerId',
        'costCenter',
        'salary',
        'employmentId',
        'attendance',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
    });
  });

  it('survives an archive and a return years later as the same person (AD-006)', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);
      const activate = await send<{ readonly personId: string }>(harness, {
        commandName: 'people.change-person-status',
        personId,
        status: 'active',
        expectedVersion: 1,
      });

      expect(activate.ok).toBe(true);

      const archive = await send(harness, {
        commandName: 'people.change-person-status',
        personId,
        status: 'archived',
        expectedVersion: 2,
      });

      expect(archive.ok).toBe(true);

      const rehire = await send(harness, {
        commandName: 'people.change-person-status',
        personId,
        status: 'active',
        expectedVersion: 3,
      });

      expect(rehire.ok).toBe(true);

      const read = await ask<PersonView>(harness, {
        queryName: 'people.read-person',
        personId,
      });

      // Same identifier, same number. Nothing about the person was recreated.
      expect(read.ok && read.value.personId).toBe(personId);
      expect(read.ok && read.value.personNumber).toBe('P-0001');
    });
  });

  it('refuses a stale write rather than letting two administrators overwrite each other', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);

      await send(harness, {
        commandName: 'people.change-person-status',
        personId,
        status: 'active',
        expectedVersion: 1,
      });

      await expect(
        send(harness, {
          commandName: 'people.change-person-status',
          personId,
          status: 'archived',
          expectedVersion: 1,
        }),
      ).rejects.toThrow(/version/i);
    });
  });

  it('redirects a merged record rather than deleting it, so every reference still resolves', async () => {
    await asTenant(TENANT_A, async () => {
      const survivor = await aPerson(harness, 'P-0001', SARA);
      const duplicate = await aPerson(harness, 'P-0002', { en: 'S Al-Amri', ar: 'س العامري' });

      const merged = await send(harness, {
        commandName: 'people.merge-people',
        personId: duplicate,
        survivorPersonId: survivor,
        expectedVersion: 1,
      });

      expect(merged.ok).toBe(true);

      const read = await ask<PersonView>(harness, {
        queryName: 'people.read-person',
        personId: duplicate,
      });

      expect(read.ok && read.value.status).toBe('merged');
      expect(read.ok && read.value.mergedIntoPersonId).toBe(survivor);
    });
  });

  it('refuses a change to a merged record, which would land where nothing reads it', async () => {
    await asTenant(TENANT_A, async () => {
      const survivor = await aPerson(harness, 'P-0001', SARA);
      const duplicate = await aPerson(harness, 'P-0002', { en: 'S Al-Amri', ar: 'س العامري' });

      await send(harness, {
        commandName: 'people.merge-people',
        personId: duplicate,
        survivorPersonId: survivor,
        expectedVersion: 1,
      });

      const change = await send(harness, {
        commandName: 'people.record-address',
        personId: duplicate,
        kind: 'residential',
        lines: [{ en: 'King Fahd Road', ar: 'طريق الملك فهد' }],
        city: { en: 'Riyadh', ar: 'الرياض' },
        countryCode: 'SA',
        effectiveFrom: MARCH,
      });

      expect(change.ok).toBe(false);
      expect(!change.ok && change.error).toMatchObject({ kind: 'rejected' });
    });
  });
});

describe('a legal name, which has a history', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  const nameOn = async (personId: string, asOf: Date): Promise<string> => {
    const read = await ask<PersonView>(harness, {
      queryName: 'people.read-person',
      personId,
      asOf,
    });

    if (!read.ok) throw new Error(`could not read: ${read.error.kind}`);
    return read.value.legalName.ar;
  };

  it('keeps the old answer and gains a new one, rather than rewriting the contract that was signed', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA, { effectiveFrom: JANUARY });

      const renamed = await send(harness, {
        commandName: 'people.record-person-name',
        personId,
        legalName: SARA_MARRIED,
        effectiveFrom: JUNE,
      });

      expect(renamed.ok).toBe(true);
      expect(await nameOn(personId, MARCH)).toBe('سارة العامري');
      expect(await nameOn(personId, SEPTEMBER)).toBe('سارة الغامدي');
    });
  });

  it('leaves exactly one answer at the instant of the change itself', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA, { effectiveFrom: JANUARY });

      await send(harness, {
        commandName: 'people.record-person-name',
        personId,
        legalName: SARA_MARRIED,
        effectiveFrom: JUNE,
      });

      expect(await nameOn(personId, JUNE)).toBe('سارة الغامدي');
    });
  });

  it('records both periods, so the history is readable rather than merely implied', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA, { effectiveFrom: JANUARY });

      await send(harness, {
        commandName: 'people.record-person-name',
        personId,
        legalName: SARA_MARRIED,
        effectiveFrom: JUNE,
      });

      const profile = await ask<PersonProfileView>(harness, {
        queryName: 'people.read-profile',
        personId,
      });

      expect(profile.ok && profile.value.names).toHaveLength(2);
      const closed = profile.ok
        ? profile.value.names.find((name) => name.effectiveTo !== undefined)
        : undefined;

      expect(closed?.legalName.ar).toBe('سارة العامري');
    });
  });

  it('splits the history at a back-dated correction instead of discarding the later change', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA, { effectiveFrom: JANUARY });

      await send(harness, {
        commandName: 'people.record-person-name',
        personId,
        legalName: SARA_MARRIED,
        effectiveFrom: SEPTEMBER,
      });

      // The certificate arrives late and names an earlier date, in front of a change already
      // recorded. This is the case Phase 3 found the expensive way for placements.
      const corrected = await send(harness, {
        commandName: 'people.record-person-name',
        personId,
        legalName: { en: 'Sara A. Al-Amri', ar: 'سارة أ. العامري' },
        effectiveFrom: JUNE,
      });

      expect(corrected.ok).toBe(true);
      expect(await nameOn(personId, MARCH)).toBe('سارة العامري');
      expect(await nameOn(personId, new Date('2026-07-01T00:00:00Z'))).toBe('سارة أ. العامري');
      // The September change survives the correction placed in front of it.
      expect(await nameOn(personId, new Date('2026-10-01T00:00:00Z'))).toBe('سارة الغامدي');
    });
  });

  it('answers with the earliest recorded name for a date before the record began', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA, { effectiveFrom: JUNE });

      // A migration dated every name from the day it ran; a question about March predates it.
      expect(await nameOn(personId, MARCH)).toBe('سارة العامري');
    });
  });
});
