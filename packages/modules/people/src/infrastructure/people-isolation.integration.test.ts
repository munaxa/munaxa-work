import { uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PersonAddress } from '../domain/person-address.js';
import { PersonCapability } from '../domain/person-capability.js';
import { PersonContact } from '../domain/person-contact.js';
import { PersonEmergencyContact } from '../domain/person-emergency-contact.js';
import { PersonHistory } from '../domain/person-history.js';
import { PersonIdentifier } from '../domain/person-identifier.js';
import { PersonNationality } from '../domain/person-nationality.js';
import { PersonNote, PersonTag } from '../domain/person-annotation.js';
import { PersonPreference } from '../domain/person-preference.js';

import type { PeopleResult } from '../domain/people-rejection.js';

import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openPeopleFixture,
  requireDatabaseInCi,
  type PeopleFixture,
} from './people-database.fixture.js';

/**
 * Tenant isolation, per entity, against a real PostgreSQL (ADR-0030).
 *
 * The strongest form of the property, not the weakest: not "a list comes back filtered", but "a
 * caller who already knows the primary key still cannot read the row". That is the shape the
 * failure would take — a bug that leaks an identifier, followed by a fetch — and it is the one
 * row-level security has to survive.
 *
 * It matters more here than in any previous module. Phase 3's tables held an org chart; a policy
 * missing from one of these thirteen would hand another customer their employees' national
 * identifiers, home addresses and wellbeing notes, and a cross-tenant disclosure of that cannot be
 * walked back.
 *
 * The suite connects as an unprivileged role that cannot bypass row-level security. Run as a
 * superuser it would pass whether or not isolation worked, which is the trap this fixture exists
 * to avoid.
 */

requireDatabaseInCi('People isolation tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const origin = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');
const bilingual = { en: 'Name', ar: 'اسم' };
const digest = { digest: (type: string, value: string) => `${type}:${value}` };

/**
 * Unwraps a domain result, or fails the test naming what was refused.
 *
 * The fixture builds ten aggregates. A chain of `if (!a.ok || !b.ok || …)` reads as one expression
 * that no longer says *which* record the domain refused, and it is the kind of thing a reader
 * skips. This names it, and keeps the fixture within its complexity budget.
 */
const built = <TValue>(result: PeopleResult<TValue>, what: string): TValue => {
  if (!result.ok) throw new Error(`the fixture's ${what} was refused by its own domain`);
  return result.value;
};

describeWithDatabase('People tenant isolation', () => {
  let fixture: PeopleFixture;

  beforeAll(async () => {
    fixture = await openPeopleFixture('work_people_isolation_test');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  it("hides another tenant's person, by their exact identifier", async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001', '1990-03-14');

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.people.byId(transaction, personId),
    );

    expect(found).toBeUndefined();
  });

  it("hides another tenant's person by their number, which a caller might guess", async () => {
    await fixture.seedPerson(TENANT_A, 'P-0001');

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.people.byNumber(transaction, 'P-0001'),
    );

    expect(found).toBeUndefined();
  });

  it('hides every child record, by exact identifier, for all twelve child tables', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const nameId = await fixture.seedName(TENANT_A, personId, 'Sara Al-Amri', 'سارة العامري');

    const written = await fixture.asTenant(TENANT_A, async (transaction) => {
      const identifier = built(
        PersonIdentifier.record(
          {
            tenantId: TENANT_A,
            personId,
            identifierType: 'national-id',
            value: '1234567890',
          },
          digest,
          origin,
          now,
        ),
        'identifier',
      );
      const nationality = built(
        PersonNationality.record({ tenantId: TENANT_A, personId, countryCode: 'SA' }, origin, now),
        'nationality',
      );
      const contact = built(
        PersonContact.record(
          {
            tenantId: TENANT_A,
            personId,
            channel: 'email',
            purpose: 'personal',
            value: 'sara@example.com',
            effectiveFrom: january,
          },
          origin,
          now,
        ),
        'contact',
      );
      const address = built(
        PersonAddress.record(
          {
            tenantId: TENANT_A,
            personId,
            kind: 'residential',
            lines: [bilingual],
            city: bilingual,
            countryCode: 'SA',
            effectiveFrom: january,
          },
          origin,
          now,
        ),
        'address',
      );
      const emergency = built(
        PersonEmergencyContact.record(
          {
            tenantId: TENANT_A,
            personId,
            name: bilingual,
            relationshipCode: 'sister',
            telephone: '+966501234567',
            effectiveFrom: january,
          },
          origin,
          now,
        ),
        'emergency contact',
      );
      const preference = built(
        PersonPreference.record(
          {
            tenantId: TENANT_A,
            personId,
            preferenceKey: 'dietary',
            value: 'vegetarian',
            effectiveFrom: january,
          },
          origin,
          now,
        ),
        'preference',
      );
      const capability = built(
        PersonCapability.record(
          { tenantId: TENANT_A, personId, kind: 'language', capabilityCode: 'ar', level: 'native' },
          origin,
          now,
        ),
        'capability',
      );
      const history = built(
        PersonHistory.record(
          {
            tenantId: TENANT_A,
            personId,
            kind: 'education',
            organizationName: bilingual,
            title: bilingual,
            fromDate: '2010-09-01',
          },
          origin,
          now,
        ),
        'history record',
      );
      const tag = built(
        PersonTag.record({ tenantId: TENANT_A, personId, tagCode: 'graduate-intake' }, origin, now),
        'tag',
      );
      const note = built(
        PersonNote.write(
          { tenantId: TENANT_A, personId, categoryCode: 'wellbeing', body: 'Confidential.' },
          origin,
          now,
        ),
        'note',
      );

      await fixture.stores.identifiers.insert(transaction, identifier.snapshot());
      await fixture.stores.nationalities.insert(transaction, nationality.snapshot());
      await fixture.stores.contacts.insert(transaction, contact.snapshot());
      await fixture.stores.addresses.insert(transaction, address.snapshot());
      await fixture.stores.emergencyContacts.insert(transaction, emergency.snapshot());
      await fixture.stores.preferences.insert(transaction, preference.snapshot());
      await fixture.stores.capabilities.insert(transaction, capability.snapshot());
      await fixture.stores.history.insert(transaction, history.snapshot());
      await fixture.stores.tags.insert(transaction, tag.snapshot());
      await fixture.stores.notes.insert(transaction, note.snapshot());

      return {
        identifier: identifier.id,
        nationality: nationality.id,
        contact: contact.id,
        address: address.id,
        emergency: emergency.id,
        preference: preference.id,
        capability: capability.id,
        history: history.id,
        tag: tag.id,
        note: note.id,
      };
    });

    const hidden = await fixture.asTenant(TENANT_B, async (transaction) => ({
      name: await fixture.stores.names.byId(transaction, nameId),
      identifier: await fixture.stores.identifiers.byId(transaction, written.identifier),
      nationality: await fixture.stores.nationalities.byId(transaction, written.nationality),
      contact: await fixture.stores.contacts.byId(transaction, written.contact),
      address: await fixture.stores.addresses.byId(transaction, written.address),
      emergency: await fixture.stores.emergencyContacts.byId(transaction, written.emergency),
      preference: await fixture.stores.preferences.byId(transaction, written.preference),
      capability: await fixture.stores.capabilities.byId(transaction, written.capability),
      history: await fixture.stores.history.byId(transaction, written.history),
      tag: await fixture.stores.tags.byId(transaction, written.tag),
      note: await fixture.stores.notes.byId(transaction, written.note),
    }));

    for (const [entity, found] of Object.entries(hidden)) {
      expect(found, `${entity} crossed the tenant boundary`).toBeUndefined();
    }
  });

  it('does not match another tenant’s identifier digest, which duplicate detection reads', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const identifier = PersonIdentifier.record(
        { tenantId: TENANT_A, personId, identifierType: 'national-id', value: '1234567890' },
        digest,
        origin,
        now,
      );

      if (!identifier.ok) throw new Error('unreachable');
      await fixture.stores.identifiers.insert(transaction, identifier.value.snapshot());
    });

    // The query duplicate detection runs. A policy missing from this table would tell one customer
    // that another employs a particular human being — from a number alone.
    const matched = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.identifiers.byMatchKeys(transaction, ['national-id:1234567890']),
    );

    expect(matched).toHaveLength(0);
  });

  it('does not match another tenant’s contact value', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.asTenant(TENANT_A, async (transaction) => {
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
    });

    const matched = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.contacts.byValues(transaction, ['+966501234567']),
    );

    expect(matched).toHaveLength(0);
  });

  it('sees an empty register rather than another tenant’s', async () => {
    await fixture.seedPerson(TENANT_A, 'P-0001');
    await fixture.seedPerson(TENANT_A, 'P-0002');

    const all = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.people.all(transaction),
    );
    const searched = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.people.search(transaction, { limit: 50, offset: 0, asOf: now }),
    );

    expect(all).toHaveLength(0);
    expect(searched.total).toBe(0);
  });

  it('refuses an insert into another tenant, so a leak cannot be written either', async () => {
    await expect(
      fixture.asTenant(TENANT_B, async (transaction) => {
        await transaction.execute(
          `insert into person
             (id, tenant_id, person_number, status, metadata,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'P-INTRUDER', 'active', '{}'::jsonb, now(), 't', now(), 't', 1)`,
          [uuidV7(), TENANT_A],
        );
      }),
    ).rejects.toThrow(/policy/i);
  });

  it('returns nothing at all when no tenant is set, which is failing closed', async () => {
    await fixture.seedPerson(TENANT_A, 'P-0001');

    const rows = await fixture.application.query('select id from person');

    expect(rows.rowCount).toBe(0);
  });
});
