import { beforeEach, describe, expect, it } from 'vitest';

import type { PersonProfileView } from '../contracts/views.js';

import {
  ALL,
  JANUARY,
  JUNE,
  MARCH,
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
 * The versioned children: contacts, addresses and emergency contacts.
 *
 * The tests worth reading are the **slot** tests. Getting a slot wrong — which timeline a new
 * record supersedes — is the characteristic bug of the Versioned Child Entity pattern, and it is
 * silent: the record that was closed by mistake simply stops being returned, and nobody notices
 * until somebody cannot be reached.
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

describe('contact points', () => {
  let harness: Harness;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  const record = (over: Record<string, unknown>): Promise<{ readonly ok: boolean }> =>
    send(harness, {
      commandName: 'people.record-contact',
      personId,
      channel: 'mobile',
      purpose: 'personal',
      value: '+966501234567',
      effectiveFrom: JANUARY,
      ...over,
    });

  it('supersedes the same channel and purpose, keeping the old number answerable', async () => {
    await asTenant(TENANT_A, async () => {
      await record({});
      await record({ value: '+966559998887', effectiveFrom: JUNE });

      const profile = await profileOf(harness, personId);
      const closed = profile.contacts?.find((contact) => contact.effectiveTo !== undefined);

      expect(profile.contacts).toHaveLength(2);
      expect(closed?.value).toBe('+966501234567');
      expect(closed?.effectiveTo).toBe(JUNE.toISOString());
    });
  });

  it('does not close a personal mobile when a work email is recorded', async () => {
    await asTenant(TENANT_A, async () => {
      await record({});
      await record({
        channel: 'email',
        purpose: 'work',
        value: 'sara@work.example',
        effectiveFrom: JUNE,
      });

      const profile = await profileOf(harness, personId);
      const mobile = profile.contacts?.find((contact) => contact.channel === 'mobile');

      expect(mobile?.effectiveTo).toBeUndefined();
    });
  });

  it('normalizes a number entered with spaces, so one number is not two', async () => {
    await asTenant(TENANT_A, async () => {
      await record({ value: '+966 50 123 4567' });
      const again = await record({ value: '+966501234567', effectiveFrom: JUNE });

      // The second record supersedes the first rather than being flagged as a different number.
      expect(again.ok).toBe(true);

      const profile = await profileOf(harness, personId);

      // The display value is what the customer typed.
      expect(profile.contacts?.some((contact) => contact.value === '+966 50 123 4567')).toBe(true);
    });
  });

  it('refuses an email that is not one, and a telephone number that is not one', async () => {
    await asTenant(TENANT_A, async () => {
      const email = await record({ channel: 'email', value: 'not-an-address' });
      const telephone = await record({ channel: 'mobile', value: '0501234567' });

      expect(email.ok).toBe(false);
      expect(telephone.ok).toBe(false);
    });
  });

  it('ends a contact without replacing it, because “no number” is a fact too', async () => {
    await asTenant(TENANT_A, async () => {
      await record({});

      const profile = await profileOf(harness, personId);
      const contact = profile.contacts?.[0];

      if (contact === undefined) throw new Error('unreachable');

      const closed = await send(harness, {
        commandName: 'people.close-contact',
        contactId: contact.contactId,
        effectiveTo: JUNE,
        expectedVersion: contact.version,
      });

      expect(closed.ok).toBe(true);
    });
  });

  it('refuses a close before the period opened', async () => {
    await asTenant(TENANT_A, async () => {
      await record({ effectiveFrom: JUNE });

      const contact = (await profileOf(harness, personId)).contacts?.[0];

      if (contact === undefined) throw new Error('unreachable');

      const closed = await send(harness, {
        commandName: 'people.close-contact',
        contactId: contact.contactId,
        effectiveTo: MARCH,
        expectedVersion: contact.version,
      });

      expect(closed.ok).toBe(false);
    });
  });
});

describe('addresses', () => {
  let harness: Harness;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  const record = (over: Record<string, unknown> = {}): Promise<{ readonly ok: boolean }> =>
    send(harness, {
      commandName: 'people.record-address',
      personId,
      kind: 'residential',
      lines: [{ en: 'King Fahd Road', ar: 'طريق الملك فهد' }],
      city: { en: 'Riyadh', ar: 'الرياض' },
      countryCode: 'SA',
      effectiveFrom: JANUARY,
      ...over,
    });

  it('requires both languages on every line, so an Arabic envelope is deliverable', async () => {
    await asTenant(TENANT_A, async () => {
      const half = await record({ lines: [{ en: 'King Fahd Road' }] });

      expect(half.ok).toBe(false);
    });
  });

  it('assumes no country’s address format — no state, no county, no postal pattern', async () => {
    await asTenant(TENANT_A, async () => {
      const jordan = await record({
        countryCode: 'JO',
        lines: [{ en: 'Zahran Street', ar: 'شارع زهران' }],
        city: { en: 'Amman', ar: 'عمّان' },
        postalCode: '11181',
      });

      expect(jordan.ok).toBe(true);
    });
  });

  it('refuses a country code that is not one', async () => {
    await asTenant(TENANT_A, async () => {
      expect((await record({ countryCode: 'SAU' })).ok).toBe(false);
    });
  });

  it('does not close a mailing address when a residential one changes', async () => {
    await asTenant(TENANT_A, async () => {
      await record({});
      await record({ kind: 'mailing', effectiveFrom: JANUARY });
      await record({ effectiveFrom: JUNE, city: { en: 'Jeddah', ar: 'جدة' } });

      const profile = await profileOf(harness, personId);
      const mailing = profile.addresses?.filter((address) => address.kind === 'mailing') ?? [];

      expect(mailing).toHaveLength(1);
      expect(mailing[0]?.effectiveTo).toBeUndefined();
    });
  });
});

describe('emergency contacts', () => {
  let harness: Harness;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  const record = (over: Record<string, unknown> = {}): Promise<{ readonly ok: boolean }> =>
    send(harness, {
      commandName: 'people.record-emergency-contact',
      personId,
      name: { en: 'Noura Al-Amri', ar: 'نورة العامري' },
      relationshipCode: 'sister',
      telephone: '+966501234567',
      effectiveFrom: JANUARY,
      ...over,
    });

  it('keeps a second contact open when a first is recorded, because the slot is the priority', async () => {
    await asTenant(TENANT_A, async () => {
      await record({ priority: 1 });
      await record({ priority: 2, name: { en: 'Faisal Al-Amri', ar: 'فيصل العامري' } });

      const profile = await profileOf(harness, personId);

      expect(profile.emergencyContacts).toHaveLength(2);
      expect(profile.emergencyContacts?.every((c) => c.effectiveTo === undefined)).toBe(true);
    });
  });

  it('supersedes the same priority, so who to call first has one answer per date', async () => {
    await asTenant(TENANT_A, async () => {
      await record({ priority: 1 });
      await record({
        priority: 1,
        effectiveFrom: JUNE,
        name: { en: 'Faisal Al-Amri', ar: 'فيصل العامري' },
      });

      const profile = await profileOf(harness, personId);
      const open = profile.emergencyContacts?.filter((c) => c.effectiveTo === undefined) ?? [];

      expect(open).toHaveLength(1);
      expect(open[0]?.name.ar).toBe('فيصل العامري');
    });
  });

  it('refuses a telephone number that would not dial', async () => {
    await asTenant(TENANT_A, async () => {
      expect((await record({ telephone: '050 123 4567' })).ok).toBe(false);
    });
  });
});
