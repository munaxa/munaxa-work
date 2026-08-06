import { beforeEach, describe, expect, it } from 'vitest';

import type { PersonProfileView, PersonView } from '../contracts/views.js';

import { ALL_PEOPLE_PERMISSIONS, PeoplePermissions } from './people-permissions.js';
import { inMemoryPeopleStores } from './in-memory-stores.js';
import {
  ALL,
  MARCH,
  TENANT_A,
  TENANT_B,
  aPerson,
  asTenant,
  ask,
  harnessFor,
  harnessWithStores,
  send,
  testClock,
  type Harness,
} from './people-test-harness.js';

/**
 * Authorization and tenant isolation, per operation and per entity.
 *
 * The permission tests are written as **granted and denied for the same call**, because a suite
 * that only asserted the granted case would pass for a handler declaring no permission at all.
 */

const SARA = { en: 'Sara Al-Amri', ar: 'سارة العامري' };

/** Every command and query, with the permission it must be refused without. */
const OPERATIONS: readonly {
  readonly name: string;
  readonly permission: string;
  readonly send: (harness: Harness, personId: string) => Promise<{ readonly ok: boolean }>;
}[] = [
  {
    name: 'create a person',
    permission: PeoplePermissions.personManage,
    send: (harness) =>
      send(harness, {
        commandName: 'people.create-person',
        personNumber: 'P-9999',
        legalName: SARA,
      }),
  },
  {
    name: 'record an identifier',
    permission: PeoplePermissions.identifierManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-identifier',
        personId,
        identifierType: 'national-id',
        value: '9998887776',
      }),
  },
  {
    name: 'record a nationality',
    permission: PeoplePermissions.nationalityManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-nationality',
        personId,
        countryCode: 'SA',
      }),
  },
  {
    name: 'record a contact',
    permission: PeoplePermissions.contactManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-contact',
        personId,
        channel: 'email',
        purpose: 'personal',
        value: 'sara@example.com',
        effectiveFrom: MARCH,
      }),
  },
  {
    name: 'record an address',
    permission: PeoplePermissions.addressManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-address',
        personId,
        kind: 'residential',
        lines: [{ en: 'King Fahd Road', ar: 'طريق الملك فهد' }],
        city: { en: 'Riyadh', ar: 'الرياض' },
        countryCode: 'SA',
        effectiveFrom: MARCH,
      }),
  },
  {
    name: 'record an emergency contact',
    permission: PeoplePermissions.emergencyContactManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-emergency-contact',
        personId,
        name: { en: 'Noura', ar: 'نورة' },
        relationshipCode: 'sister',
        telephone: '+966501234567',
        effectiveFrom: MARCH,
      }),
  },
  {
    name: 'record a capability',
    permission: PeoplePermissions.capabilityManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-capability',
        personId,
        kind: 'language',
        capabilityCode: 'ar',
        level: 'native',
      }),
  },
  {
    name: 'record history',
    permission: PeoplePermissions.historyManage,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.record-history',
        personId,
        kind: 'education',
        organizationName: { en: 'KFUPM', ar: 'جامعة الملك فهد' },
        title: { en: 'BSc', ar: 'بكالوريوس' },
        fromDate: '2010-09-01',
      }),
  },
  {
    name: 'write a note',
    permission: PeoplePermissions.noteWrite,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.write-note',
        personId,
        categoryCode: 'general',
        body: 'A note.',
      }),
  },
  {
    name: 'merge two people',
    permission: PeoplePermissions.personMerge,
    send: (harness, personId) =>
      send(harness, {
        commandName: 'people.merge-people',
        personId,
        survivorPersonId: personId,
        expectedVersion: 1,
      }),
  },
  {
    name: 'export the register',
    permission: PeoplePermissions.exportPeople,
    send: (harness) => ask(harness, { queryName: 'people.export' }),
  },
  {
    name: 'read the register',
    permission: PeoplePermissions.personRead,
    send: (harness) => ask(harness, { queryName: 'people.search' }),
  },
];

describe('every operation', () => {
  let seeded: ReturnType<typeof inMemoryPeopleStores>;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    seeded = inMemoryPeopleStores();

    const harness = harnessWithStores(TENANT_A, seeded, ALL);

    personId = await asTenant(TENANT_A, () => aPerson(harness, 'P-0001', SARA));
  });

  it.each(OPERATIONS)('permits $name for a caller holding $permission', async (operation) => {
    const harness = harnessWithStores(TENANT_A, seeded, [operation.permission, ...ALL]);
    const outcome = await asTenant(TENANT_A, () => operation.send(harness, personId));

    // Granted callers may still be refused on business grounds; what must never happen is a
    // *forbidden*.
    expect(outcome).not.toMatchObject({ error: { kind: 'forbidden' } });
  });

  it.each(OPERATIONS)('refuses $name for a caller without $permission', async (operation) => {
    const granted = ALL_PEOPLE_PERMISSIONS.filter(
      (permission) => permission !== operation.permission,
    );
    const harness = harnessWithStores(TENANT_A, seeded, granted);
    const outcome = await asTenant(TENANT_A, () => operation.send(harness, personId));

    expect(outcome).toMatchObject({
      ok: false,
      error: { kind: 'forbidden', permission: operation.permission },
    });
  });
});

describe('another tenant', () => {
  let shared: ReturnType<typeof inMemoryPeopleStores>;
  let personId: string;

  beforeEach(async () => {
    testClock.reset();
    shared = inMemoryPeopleStores();

    const harness = harnessWithStores(TENANT_A, shared, ALL);

    personId = await asTenant(TENANT_A, async () => {
      const created = await aPerson(harness, 'P-0001', SARA, { dateOfBirth: '1990-03-14' });

      await send(harness, {
        commandName: 'people.record-identifier',
        personId: created,
        identifierType: 'national-id',
        value: '1234567890',
      });
      return created;
    });
  });

  it('cannot read a person by exact identifier — the answer is not found, not forbidden', async () => {
    const intruder = harnessWithStores(TENANT_B, shared, ALL);
    const read = await asTenant(TENANT_B, () =>
      ask<PersonView>(intruder, { queryName: 'people.read-person', personId }),
    );

    expect(read.ok).toBe(false);
    expect(!read.ok && read.error.kind).toBe('not_found');
  });

  it('cannot read the profile, so no identifier, note or address crosses the boundary', async () => {
    const intruder = harnessWithStores(TENANT_B, shared, ALL);
    const profile = await asTenant(TENANT_B, () =>
      ask<PersonProfileView>(intruder, { queryName: 'people.read-profile', personId }),
    );

    expect(profile.ok).toBe(false);
  });

  it('sees an empty register rather than somebody else’s', async () => {
    const intruder = harnessWithStores(TENANT_B, shared, ALL);
    const found = await asTenant(TENANT_B, () =>
      ask<{ readonly items: readonly PersonView[]; readonly total: number }>(intruder, {
        queryName: 'people.search',
      }),
    );

    expect(found.ok && found.value.total).toBe(0);
  });

  it('does not have another tenant’s identifier considered a duplicate of its own', async () => {
    const other = harnessWithStores(TENANT_B, shared, ALL);
    const created = await asTenant(TENANT_B, async () => {
      const id = await aPerson(other, 'P-0001', SARA);

      // The same national identifier, in a different customer. It must not clash: two customers
      // may legitimately employ the same human being.
      return send(other, {
        commandName: 'people.record-identifier',
        personId: id,
        identifierType: 'national-id',
        value: '1234567890',
      });
    });

    expect(created.ok).toBe(true);
  });

  it('cannot export another tenant’s register', async () => {
    const intruder = harnessWithStores(TENANT_B, shared, ALL);
    const exported = await asTenant(TENANT_B, () =>
      ask<{ readonly people: readonly PersonView[] }>(intruder, { queryName: 'people.export' }),
    );

    expect(exported.ok && exported.value.people).toHaveLength(0);
  });
});

describe('an untenanted caller', () => {
  it('reaches no handler at all, because a business operation runs inside a tenant', async () => {
    const harness = harnessFor(TENANT_A, ALL);

    await expect(ask(harness, { queryName: 'people.search' })).rejects.toThrow(/tenant/i);
  });
});
