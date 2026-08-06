import { uuidV7 } from '@work/kernel';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PersonIdentifier } from '../domain/person-identifier.js';
import { PersonName } from '../domain/person-name.js';

import { HmacIdentifierDigest } from './identifier-digest.js';
import {
  CONNECTION,
  TENANT_A,
  TENANT_B,
  openPeopleFixture,
  requireDatabaseInCi,
  type PeopleFixture,
} from './people-database.fixture.js';

/**
 * What the database enforces rather than the application.
 *
 * A rule the application checks is a rule one code path can miss. A rule the database checks is
 * one the product cannot violate — including from a migration, a support script or a future
 * module that has not read this one. Everything asserted here is a constraint, an index or a
 * policy, verified against a real PostgreSQL by causing it to fire.
 */

requireDatabaseInCi('People persistence tests');

const describeWithDatabase = CONNECTION === undefined ? describe.skip : describe;

const origin = { tenantId: TENANT_A, correlationId: uuidV7(), actor: 'user:test' };
const now = new Date('2026-08-06T09:00:00Z');
const january = new Date('2026-01-01T00:00:00Z');
const june = new Date('2026-06-01T00:00:00Z');
const digest = new HmacIdentifierDigest('a-test-key-long-enough-to-be-a-key-000000');

const constraintName = async (act: () => Promise<unknown>): Promise<string> => {
  try {
    await act();
  } catch (error) {
    const named = error as { constraint?: string; message?: string };
    return named.constraint ?? named.message ?? 'unknown';
  }
  throw new Error('the database accepted a row it should have refused');
};

describeWithDatabase('what the database refuses', () => {
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

  it('refuses a legal name missing a first-class language', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const constraint = await constraintName(() =>
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into person_name
             (id, tenant_id, person_id, legal_name, effective_from,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, '{"en":"Sara"}'::jsonb, now(), now(), 't', now(), 't', 1)`,
          [uuidV7(), TENANT_A, personId],
        ),
      ),
    );

    expect(constraint).toContain('bilingual');
  });

  it('refuses two open name periods for one person, which would be two answers', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.seedName(TENANT_A, personId, 'Sara Al-Amri', 'سارة العامري');

    const constraint = await constraintName(() =>
      fixture.asTenant(TENANT_A, async (transaction) => {
        const name = PersonName.record(
          {
            tenantId: TENANT_A,
            personId,
            legalName: { en: 'Sara Al-Ghamdi', ar: 'سارة الغامدي' },
            effectiveFrom: june,
          },
          origin,
          now,
        );

        if (!name.ok) throw new Error('unreachable');
        await fixture.stores.names.insert(transaction, name.value.snapshot());
      }),
    );

    expect(constraint).toContain('person_name_open_key');
  });

  it('refuses a period that ends before it begins', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const constraint = await constraintName(() =>
      fixture.asTenant(TENANT_A, (transaction) =>
        transaction.execute(
          `insert into person_name
             (id, tenant_id, person_id, legal_name, effective_from, effective_to,
              created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, $3, '{"en":"A","ar":"ا"}'::jsonb, $4, $5, now(), 't', now(), 't', 1)`,
          [uuidV7(), TENANT_A, personId, june, january],
        ),
      ),
    );

    expect(constraint).toContain('period');
  });

  it('refuses the same person number twice in a tenant, case-insensitively', async () => {
    await fixture.seedPerson(TENANT_A, 'E-1001');

    const constraint = await constraintName(() => fixture.seedPerson(TENANT_A, 'e-1001'));

    expect(constraint).toContain('person_number_key');
  });

  it('permits the same person number in a different tenant, because it is the customer’s own', async () => {
    await fixture.seedPerson(TENANT_A, 'E-1001');

    await expect(fixture.seedPerson(TENANT_B, 'E-1001')).resolves.toBeTypeOf('string');
  });

  it('refuses two live holders of one identifier digest — the constraint AD-001 rests on', async () => {
    const first = await fixture.seedPerson(TENANT_A, 'P-0001');
    const second = await fixture.seedPerson(TENANT_A, 'P-0002');

    const record = (personId: string): Promise<unknown> =>
      fixture.asTenant(TENANT_A, async (transaction) => {
        const identifier = PersonIdentifier.record(
          { tenantId: TENANT_A, personId, identifierType: 'national-id', value: '1234567890' },
          digest,
          origin,
          now,
        );

        if (!identifier.ok) throw new Error('unreachable');
        await fixture.stores.identifiers.insert(transaction, identifier.value.snapshot());
      });

    await record(first);

    expect(await constraintName(() => record(second))).toContain('person_identifier_live_key');
  });

  it('permits the same identifier in a different tenant, because two customers may employ one person', async () => {
    const inA = await fixture.seedPerson(TENANT_A, 'P-0001');
    const inB = await fixture.seedPerson(TENANT_B, 'P-0001');

    const record = (tenantId: string, personId: string): Promise<unknown> =>
      fixture.asTenant(tenantId, async (transaction) => {
        const identifier = PersonIdentifier.record(
          { tenantId, personId, identifierType: 'national-id', value: '1234567890' },
          digest,
          origin,
          now,
        );

        if (!identifier.ok) throw new Error('unreachable');
        await fixture.stores.identifiers.insert(transaction, identifier.value.snapshot());
      });

    await record(TENANT_A, inA);
    await expect(record(TENANT_B, inB)).resolves.toBeUndefined();
  });

  it('refuses a date of birth in the future, at the database as well as in the domain', async () => {
    const constraint = await constraintName(() =>
      fixture.seedPerson(TENANT_A, 'P-0001', '2099-01-01'),
    );

    expect(constraint).toContain('person_birth_plausible_check');
  });

  it('refuses a merged status with nothing to redirect to', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const constraint = await constraintName(() =>
      fixture.admin.query(`update person set status = 'merged' where id = $1`, [personId]),
    );

    expect(constraint).toContain('person_merge_target_check');
  });

  it('refuses a duplicate candidate whose pair is the wrong way round', async () => {
    const first = await fixture.seedPerson(TENANT_A, 'P-0001');
    const second = await fixture.seedPerson(TENANT_A, 'P-0002');
    const [low, high] = first < second ? [first, second] : [second, first];
    const constraint = await constraintName(() =>
      fixture.admin.query(
        `insert into person_duplicate_candidate
           (id, tenant_id, person_id, duplicate_of_person_id, reason, confidence, status,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, 'contact-value', 70, 'pending', now(), 't', now(), 't', 1)`,
        [uuidV7(), TENANT_A, high, low],
      ),
    );

    expect(constraint).toContain('ordered');
  });

  it('refuses a decided candidate with nobody named as the reviewer', async () => {
    const first = await fixture.seedPerson(TENANT_A, 'P-0001');
    const second = await fixture.seedPerson(TENANT_A, 'P-0002');
    const [low, high] = first < second ? [first, second] : [second, first];
    const constraint = await constraintName(() =>
      fixture.admin.query(
        `insert into person_duplicate_candidate
           (id, tenant_id, person_id, duplicate_of_person_id, reason, confidence, status,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, $4, 'contact-value', 70, 'confirmed', now(), 't', now(), 't', 1)`,
        [uuidV7(), TENANT_A, low, high],
      ),
    );

    expect(constraint).toContain('review');
  });

  it('refuses an expiry on a degree, because only a certification lapses', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const constraint = await constraintName(() =>
      fixture.admin.query(
        `insert into person_history
           (id, tenant_id, person_id, kind, organization_name, title, from_date, expires_on,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'education', '{"en":"U","ar":"ج"}'::jsonb,
                 '{"en":"BSc","ar":"بكالوريوس"}'::jsonb, '2010-09-01', '2030-01-01',
                 now(), 't', now(), 't', 1)`,
        [uuidV7(), TENANT_A, personId],
      ),
    );

    expect(constraint).toContain('person_history_expiry_check');
  });

  it('refuses a language capability carrying a name, and a skill without one', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');
    const named = await constraintName(() =>
      fixture.admin.query(
        `insert into person_capability
           (id, tenant_id, person_id, kind, capability_code, title, level,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'language', 'ar', '{"en":"Arabic","ar":"العربية"}'::jsonb, 'native',
                 now(), 't', now(), 't', 1)`,
        [uuidV7(), TENANT_A, personId],
      ),
    );
    const unnamed = await constraintName(() =>
      fixture.admin.query(
        `insert into person_capability
           (id, tenant_id, person_id, kind, capability_code, level,
            created_at, created_by, updated_at, updated_by, version)
         values ($1, $2, $3, 'skill', 'welding', 'expert', now(), 't', now(), 't', 1)`,
        [uuidV7(), TENANT_A, personId],
      ),
    );

    expect(named).toContain('person_capability_title_check');
    expect(unnamed).toContain('person_capability_title_check');
  });

  it('refuses a stale write, so two administrators cannot silently overwrite each other', async () => {
    const personId = await fixture.seedPerson(TENANT_A, 'P-0001');

    await fixture.asTenant(TENANT_A, async (transaction) => {
      const state = await fixture.stores.people.byId(transaction, personId);

      if (state === undefined) throw new Error('unreachable');
      await fixture.stores.people.update(transaction, { ...state, status: 'archived' }, 1);
    });

    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        const state = await fixture.stores.people.byId(transaction, personId);

        if (state === undefined) throw new Error('unreachable');
        await fixture.stores.people.update(transaction, { ...state, status: 'draft' }, 1);
      }),
    ).rejects.toThrow(/version/i);
  });
});
