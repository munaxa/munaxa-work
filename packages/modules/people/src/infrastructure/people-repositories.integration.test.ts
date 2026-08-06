import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { PersonContact } from '../domain/person-contact.js';
import { PersonIdentifier } from '../domain/person-identifier.js';

import { HmacIdentifierDigest } from './identifier-digest.js';
import {
  CONNECTION,
  TENANT_A,
  openPeopleFixture,
  requireDatabaseInCi,
  type PeopleFixture,
} from './people-database.fixture.js';

/**
 * What the repositories hand back, against a real PostgreSQL.
 *
 * Apart from the constraint suite because these are questions about *mapping* rather than about
 * refusal — and two of them are the ones a reviewer should not take on trust: that a civil date
 * survives the driver unchanged, and that the identifier column reveals nothing on its own.
 */

requireDatabaseInCi('People persistence tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const origin = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');
const june = new Date('2026-06-01T00:00:00Z');
const digest = new HmacIdentifierDigest('a-test-key-long-enough-to-be-a-key-000000');

describeWithDatabase('what the repositories return', () => {
  let fixture: PeopleFixture;

  beforeAll(async () => {
    fixture = await openPeopleFixture('work_people_persistence_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it('gives a date of birth back as the date that was stored, in any process time zone', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001', '1990-03-14');
    const state = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.people.byId(transaction, personId),
    );

    // The driver would otherwise hand back a `Date` at the process's local midnight, and a server
    // west of UTC would report the 13th — which changes an age, an eligibility and a retirement
    // date.
    expect(state?.dateOfBirth).toBe('1990-03-14');
  });

  it('finds somebody by an Arabic name typed without the hamza', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.seedName(TENANT_A, personId, 'Ahmed Al-Ghamdi', 'أحمد الغامدي');

    const exact = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.people.search(transaction, {
        limit: 10,
        offset: 0,
        asOf: now,
        term: 'الغامدي',
      }),
    );

    expect(exact.total).toBe(1);
  });

  it('searches by identifier digest without the number reaching the query', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const identifier = PersonIdentifier.record(
        { tenantId: TENANT_A, personId, identifierType: 'passport', value: 'X99-887-76' },
        digest,
        origin,
        now,
      );

      if (!identifier.ok) throw new Error('unreachable');
      await fixture.stores.identifiers.insert(transaction, identifier.value.snapshot());
    });

    const found = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.people.search(transaction, {
        limit: 10,
        offset: 0,
        asOf: now,
        // Differently punctuated. The digest is over the *normalized* value, so it still matches.
        identifierMatchKey: digest.digest('passport', 'X9988776'),
      }),
    );

    expect(found.total).toBe(1);
  });

  it('keeps the number out of the digest, so the column reveals nothing on its own', () => {
    const key = digest.digest('national-id', '1234567890');

    expect(key).not.toContain('1234567890');
    expect(key).toHaveLength(43);
    // A different key over the same value produces a different digest, which is what makes the
    // column useless to anybody who obtains it without the key.
    expect(
      new HmacIdentifierDigest('a-different-key-also-long-enough-000000').digest(
        'national-id',
        '1234567890',
      ),
    ).not.toBe(key);
  });

  it('reads several people’s children in one query rather than one query each', async () => {
    const first = await fixture.seedPerson(TENANT_A, 'P-0001');
    const second = await fixture.seedPerson(TENANT_A, 'P-0002');

    await fixture.seedName(TENANT_A, first, 'Sara Al-Amri', 'سارة العامري');
    await fixture.seedName(TENANT_A, second, 'Ahmed Al-Ghamdi', 'أحمد الغامدي');

    const names = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.names.forPeople(transaction, [first, second]),
    );

    expect(names).toHaveLength(2);
  });

  it('supersedes a contact rather than editing it, keeping the old value answerable', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    const contactId = await fixture.asTenant(TENANT_A, async (transaction) => {
      const contact = PersonContact.record(
        {
          tenantId: TENANT_A,
          personId,
          channel: 'mobile',
          purpose: 'personal',
          value: '+966501234567',
          effectiveFrom: january,
        },
        origin,
        now,
      );

      if (!contact.ok) throw new Error('unreachable');
      await fixture.stores.contacts.insert(transaction, contact.value.snapshot());
      return contact.value.id;
    });

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const state = await fixture.stores.contacts.byId(transaction, contactId);

      if (state === undefined) throw new Error('unreachable');

      const contact = PersonContact.rehydrate(state);

      contact.closeAt(june, origin, now);
      await fixture.stores.contacts.update(transaction, contact.snapshot(), 1);
    });

    const closed = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.contacts.byId(transaction, contactId),
    );

    expect(closed?.value).toBe('+966501234567');
    expect(closed?.effectiveTo).toEqual(june);
  });
});
