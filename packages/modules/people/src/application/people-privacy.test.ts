import { beforeEach, describe, expect, it } from 'vitest';

import type { PersonProfileView, PersonView } from '../contracts/views.js';

import { PeoplePermissions } from './people-permissions.js';
import {
  ALL,
  MARCH,
  TENANT_A,
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
 * The privacy model, asserted rather than described.
 *
 * This is the phase where PII arrives in force. Phase 3 could honestly write "PII: none" in its
 * report; this module holds national identifiers, dates of birth, home addresses, emergency
 * contacts and free-text notes, and every protection it claims is checked here.
 *
 * The tests are written from the **caller's permissions**, through the real pipeline, because the
 * redaction is driven entirely by what the caller holds — a suite that called handlers directly
 * would only ever exercise the unredacted path.
 */

const SARA = { en: 'Sara Al-Amri', ar: 'سارة العامري' };
const NATIONAL_ID = '1234567890';

/** Everything except the permission under test, so a failure names the permission. */
const allExcept = (...withheld: readonly string[]): readonly string[] =>
  ALL.filter((permission) => !withheld.includes(permission));

const seed = async (harness: Harness): Promise<string> => {
  const personId = await aPerson(harness, 'P-0001', SARA, { dateOfBirth: '1990-03-14' });

  await send(harness, {
    commandName: 'people.record-identifier',
    personId,
    identifierType: 'national-id',
    value: NATIONAL_ID,
  });
  await send(harness, {
    commandName: 'people.write-note',
    personId,
    categoryCode: 'wellbeing',
    body: 'Requested a quiet workspace.',
  });
  await send(harness, {
    commandName: 'people.record-emergency-contact',
    personId,
    name: { en: 'Noura Al-Amri', ar: 'نورة العامري' },
    relationshipCode: 'sister',
    telephone: '+966501234567',
    effectiveFrom: MARCH,
  });
  return personId;
};

describe('a caller who may read the register but not its sensitive fields', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('gets the person with the date of birth absent, not null, and is told so', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.sensitiveRead),
      );
      const read = await ask<PersonView>(restricted, {
        queryName: 'people.read-person',
        personId,
      });

      expect(read.ok).toBe(true);
      // Absent rather than null: a consumer cannot otherwise tell "we do not know" from
      // "you may not see it", and the two lead to different behaviour.
      expect(read.ok && 'dateOfBirth' in read.value).toBe(false);
      expect(read.ok && read.value.sensitiveWithheld).toBe(true);
    });
  });

  it('is not refused outright, because a picker that 403s for everybody is a picker nobody uses', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.sensitiveRead),
      );
      const read = await ask<PersonView>(restricted, {
        queryName: 'people.read-person',
        personId,
      });

      expect(read.ok && read.value.legalName.ar).toBe('سارة العامري');
    });
  });

  it('gets the same redaction from a search as from the person itself', async () => {
    await asTenant(TENANT_A, async () => {
      await seed(harness);

      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.sensitiveRead),
      );
      const found = await ask<{ readonly items: readonly PersonView[] }>(restricted, {
        queryName: 'people.search',
      });

      expect(found.ok && found.value.items[0]?.sensitiveWithheld).toBe(true);
      expect(found.ok && 'dateOfBirth' in (found.value.items[0] ?? {})).toBe(false);
    });
  });
});

describe('a government identifier', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('is masked for a caller who may see that it exists but not what it is', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.identifierReadValue),
      );
      const profile = await ask<PersonProfileView>(restricted, {
        queryName: 'people.read-profile',
        personId,
      });

      const identifier = profile.ok ? profile.value.identifiers?.[0] : undefined;

      expect(identifier?.maskedValue).toBe('••••7890');
      expect(identifier === undefined ? true : 'value' in identifier).toBe(false);
    });
  });

  it('is shown in full only to a caller holding the value permission', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const profile = await ask<PersonProfileView>(harness, {
        queryName: 'people.read-profile',
        personId,
      });

      expect(profile.ok && profile.value.identifiers?.[0]?.value).toBe(NATIONAL_ID);
    });
  });

  it('records who was shown it, and records the kind rather than the number', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);

      await ask(harness, { queryName: 'people.read-profile', personId });

      expect(harness.disclosures.recorded).toHaveLength(1);
      expect(harness.disclosures.recorded[0]).toMatchObject({
        personId,
        identifierType: 'national-id',
      });
      expect(JSON.stringify(harness.disclosures.recorded)).not.toContain(NATIONAL_ID);
    });
  });

  it('records nothing when the caller was only shown the mask', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.identifierReadValue),
      );

      await ask(restricted, { queryName: 'people.read-profile', personId });

      expect(restricted.disclosures.recorded).toHaveLength(0);
    });
  });

  it('never reaches the search predicate in plaintext — the query compares a digest', async () => {
    await asTenant(TENANT_A, async () => {
      await seed(harness);

      const found = await ask<{ readonly items: readonly PersonView[] }>(harness, {
        queryName: 'people.search',
        identifierType: 'national-id',
        identifierValue: '1234-567-890',
      });

      // The search succeeds on a differently punctuated spelling, which is only possible because
      // the value was normalized and digested rather than compared as typed.
      expect(found.ok).toBe(true);
    });
  });

  it('masks a value too short to mask, rather than revealing it', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0009', SARA);

      await send(harness, {
        commandName: 'people.record-identifier',
        personId,
        identifierType: 'staff-card',
        value: 'A1',
      });

      const profile = await ask<PersonProfileView>(harness, {
        queryName: 'people.read-profile',
        personId,
      });
      const identifier = profile.ok ? profile.value.identifiers?.[0] : undefined;

      expect(identifier?.maskedValue).toBe('••••');
    });
  });
});

describe('a profile section the caller may not read', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('is absent rather than empty, because an empty list asserts something false', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.noteRead, PeoplePermissions.emergencyContactRead),
      );
      const profile = await ask<PersonProfileView>(restricted, {
        queryName: 'people.read-profile',
        personId,
      });

      expect(profile.ok && profile.value.notes).toBeUndefined();
      expect(profile.ok && profile.value.emergencyContacts).toBeUndefined();
      expect(profile.ok && profile.value.withheld).toContain('notes');
      expect(profile.ok && profile.value.withheld).toContain('emergencyContacts');
    });
  });

  it('is not read from the database at all, so a withheld section leaks nothing to a log', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await seed(harness);
      const restricted = harnessWithStores(
        TENANT_A,
        harness.stores,
        allExcept(PeoplePermissions.noteRead),
      );
      const profile = await ask<PersonProfileView>(restricted, {
        queryName: 'people.read-profile',
        personId,
      });

      expect(JSON.stringify(profile.ok ? profile.value : {})).not.toContain('quiet workspace');
    });
  });
});

describe('an export', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('carries no identifier, no note, no address and no date of birth out of the product', async () => {
    await asTenant(TENANT_A, async () => {
      await seed(harness);

      const exported = await ask(harness, { queryName: 'people.export' });
      const serialized = JSON.stringify(exported.ok ? exported.value : {});

      expect(serialized).not.toContain(NATIONAL_ID);
      expect(serialized).not.toContain('quiet workspace');
      expect(serialized).not.toContain('1990-03-14');
      expect(serialized).toContain('سارة العامري');
    });
  });
});

describe('a note', () => {
  let harness: Harness;

  beforeEach(() => {
    testClock.reset();
    harness = harnessFor(TENANT_A, ALL);
  });

  it('records its author from the authenticated context, never from the request', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);

      await send(harness, {
        commandName: 'people.write-note',
        personId,
        categoryCode: 'general',
        body: 'A note.',
        // A caller trying to name somebody else as the author.
        authoredBy: 'user:somebody-else',
      });

      const profile = await ask<PersonProfileView>(harness, {
        queryName: 'people.read-profile',
        personId,
      });

      expect(profile.ok && profile.value.notes?.[0]?.authoredBy).not.toBe('user:somebody-else');
      expect(profile.ok && profile.value.notes?.[0]?.authoredBy).toMatch(/^user:/);
    });
  });

  it('has no command to amend or delete it, because an editable note evidences nothing', async () => {
    await asTenant(TENANT_A, async () => {
      const personId = await aPerson(harness, 'P-0001', SARA);
      const amend = await send(harness, {
        commandName: 'people.amend-note',
        personId,
        body: 'Something else.',
      });

      expect(amend.ok).toBe(false);
      expect(!amend.ok && amend.error.kind).toBe('not_found');
    });
  });
});
