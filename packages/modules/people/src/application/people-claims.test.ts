import { beforeEach, describe, expect, it } from 'vitest';

import type { PersonProfileView } from '../contracts/views.js';

import {
  ALL,
  JANUARY,
  JUNE,
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
 * The claims a person makes about themselves, and the preferences they state.
 *
 * Apart from `people-profile.test.ts` — which covers the versioned children — because these are a
 * different shape with a different rule: a claim is withdrawn rather than superseded, and there is
 * no timeline because a skill is not a value that had a different value last March.
 *
 * The exception is a *preference*, which is on a timeline for one reason: consent. "Did this
 * person agree to their photograph being published when that brochure went to print" is a question
 * about a date, and consent that could be overwritten could not be evidenced.
 */

const SARA = { en: 'Sara Al-Amri', ar: 'سارة العامري' };

const profileOf = async (harness: Harness, personId: string): Promise<PersonProfileView> => {
  const read = await ask<PersonProfileView>(harness, {
    queryName: 'people.read-profile',
    personId,
  });

  if (!read.ok) throw new Error(`could not read: ${read.error.kind}`);
  return read.value;
};

describe('nationalities, capabilities and history', () => {
  let harness: Harness;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  it('records more than one citizenship, because dual nationality is ordinary', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'JO',
        isPrimary: true,
      });
      await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'CA',
      });

      const profile = await profileOf(harness, personId);

      expect(profile.nationalities).toHaveLength(2);
      expect(profile.nationalities?.filter((n) => n.isPrimary)).toHaveLength(1);
    });
  });

  it('moves the primary flag rather than holding two, when a second is made primary', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'JO',
        isPrimary: true,
      });
      await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'CA',
        isPrimary: true,
      });

      const profile = await profileOf(harness, personId);

      expect(profile.nationalities?.filter((n) => n.isPrimary)).toHaveLength(1);
      expect(profile.nationalities?.find((n) => n.isPrimary)?.countryCode).toBe('CA');
    });
  });

  it('refuses the same citizenship twice', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'SA',
      });

      const again = await send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'SA',
      });

      expect(again.ok).toBe(false);
    });
  });

  it('withdraws a skill rather than deleting it, so the claim stays answerable (AD-009)', async () => {
    await asTenant(TENANT_A, async () => {
      const recorded = await send<{ readonly capabilityId: string }>(harness, {
        commandName: 'people.record-capability',
        personId,
        kind: 'skill',
        capabilityCode: 'welding',
        title: { en: 'Welding', ar: 'اللحام' },
        level: 'expert',
      });

      if (!recorded.ok) throw new Error('unreachable');

      await send(harness, {
        commandName: 'people.withdraw-capability',
        capabilityId: recorded.value.capabilityId,
        expectedVersion: 1,
      });

      const profile = await profileOf(harness, personId);

      expect(profile.capabilities).toHaveLength(1);
      expect(profile.capabilities?.[0]?.withdrawn).toBe(true);
    });
  });

  it('records a certification that expires, and a degree that cannot', async () => {
    await asTenant(TENANT_A, async () => {
      const certification = await send(harness, {
        commandName: 'people.record-history',
        personId,
        kind: 'certification',
        organizationName: { en: 'PMI', ar: 'معهد إدارة المشاريع' },
        title: { en: 'PMP', ar: 'محترف إدارة مشاريع' },
        fromDate: '2022-01-01',
        expiresOn: '2025-01-01',
      });
      const degree = await send(harness, {
        commandName: 'people.record-history',
        personId,
        kind: 'education',
        organizationName: { en: 'KFUPM', ar: 'جامعة الملك فهد' },
        title: { en: 'BSc', ar: 'بكالوريوس' },
        fromDate: '2010-09-01',
        expiresOn: '2030-01-01',
      });

      expect(certification.ok).toBe(true);
      expect(degree.ok).toBe(false);
    });
  });
});

describe('preferences', () => {
  let harness: Harness;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  it('evidences what somebody consented to on a date, rather than only what they consent to now', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, {
        commandName: 'people.record-preference',
        personId,
        preferenceKey: 'directory-photograph',
        value: 'yes',
        effectiveFrom: JANUARY,
      });
      await send(harness, {
        commandName: 'people.record-preference',
        personId,
        preferenceKey: 'directory-photograph',
        value: 'no',
        effectiveFrom: SEPTEMBER,
      });

      const profile = await profileOf(harness, personId);
      const consented = profile.preferences?.find((p) => p.value === 'yes');

      expect(profile.preferences).toHaveLength(2);
      expect(consented?.effectiveTo).toBe(SEPTEMBER.toISOString());
    });
  });

  it('keeps one key from closing another', async () => {
    await asTenant(TENANT_A, async () => {
      await send(harness, {
        commandName: 'people.record-preference',
        personId,
        preferenceKey: 'dietary',
        value: 'vegetarian',
        effectiveFrom: JANUARY,
      });
      await send(harness, {
        commandName: 'people.record-preference',
        personId,
        preferenceKey: 'shirt-size',
        value: 'L',
        effectiveFrom: JUNE,
      });

      const profile = await profileOf(harness, personId);

      expect(profile.preferences?.every((p) => p.effectiveTo === undefined)).toBe(true);
    });
  });
});
