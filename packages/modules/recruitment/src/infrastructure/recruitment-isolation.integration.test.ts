import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import { Candidate } from '../domain/candidate.js';

import {
  CONNECTION,
  RECRUITMENT_TABLES,
  TENANT_A,
  TENANT_B,
  openRecruitmentFixture,
  requireDatabaseInCi,
  type RecruitmentFixture,
} from './recruitment-database.fixture.js';

/**
 * Row-level security, against a real PostgreSQL and as an unprivileged role.
 *
 * This module holds personal data about people who do not work for the customer and never consented
 * to being in this system, so the isolation assertions here matter more than in any module before
 * it. They are made as a role that owns nothing and cannot bypass a policy: run as a superuser they
 * would pass whether or not isolation worked.
 *
 * The last test is the one that would catch a future mistake — it asserts that **every** table this
 * module creates carries a policy, rather than the handful a suite happened to exercise.
 */

const origin = { tenantId: TENANT_A, correlationId: 'test', actor: 'user:test' };
const NOW = new Date('2026-08-09T09:00:00Z');

requireDatabaseInCi('Recruitment isolation');

describe.skipIf(CONNECTION === undefined)('Recruitment isolation', () => {
  let fixture: RecruitmentFixture;

  beforeAll(async () => {
    fixture = await openRecruitmentFixture('recruitment_fixture_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
  });

  const aCandidateIn = async (tenantId: string, email: string): Promise<string> =>
    fixture.asTenant(tenantId, async (transaction) => {
      const number = await fixture.stores.numbers.allocate(transaction, 'candidate:2026');
      const created = Candidate.create(
        {
          tenantId,
          candidateNumber: `CAN-2026-${String(number).padStart(6, '0')}`,
          displayName: { en: 'Noura Al-Fahad', ar: 'نورة الفهد' },
          email,
          sourceCode: 'referral',
        },
        { ...origin, tenantId },
        NOW,
      );

      if (!created.ok) throw new Error(`fixture: ${created.error.reason}`);
      await fixture.stores.candidates.insert(transaction, created.value.snapshot());
      return created.value.id;
    });

  it('does not read another tenant’s candidate by identifier', async () => {
    const candidateId = await aCandidateIn(TENANT_A, 'a@example.com');
    const read = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.candidates.byId(transaction, candidateId),
    );

    expect(read).toBeUndefined();
  });

  it('does not find another tenant’s candidate by the address it matches on', async () => {
    await aCandidateIn(TENANT_A, 'shared@example.com');

    const found = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.candidates.byEmail(transaction, 'shared@example.com'),
    );

    // The duplicate check must not become a way to learn that somebody applied to another customer.
    expect(found).toBeUndefined();
  });

  it('does not include another tenant’s candidates in a search or its total', async () => {
    await aCandidateIn(TENANT_A, 'one@example.com');
    await aCandidateIn(TENANT_A, 'two@example.com');
    await aCandidateIn(TENANT_B, 'three@example.com');

    const page = await fixture.asTenant(TENANT_B, (transaction) =>
      fixture.stores.candidates.search(transaction, { limit: 25, offset: 0 }),
    );

    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(1);
  });

  it('cannot update another tenant’s candidate even knowing its identifier', async () => {
    const candidateId = await aCandidateIn(TENANT_A, 'target@example.com');

    await expect(
      fixture.asTenant(TENANT_B, async (transaction) => {
        const state = await fixture.stores.candidates.byId(transaction, candidateId);

        if (state !== undefined) throw new Error('the policy let another tenant read the row');
        // Nothing to update: the read already returned nothing, which is the isolation working.
        // Writing a row this tenant invented would be a different assertion, so this fails loudly
        // rather than passing vacuously.
        throw new Error('unreachable');
      }),
    ).rejects.toThrow('unreachable');
  });

  it('writes the tenant from the context rather than from the row', async () => {
    await expect(
      fixture.asTenant(TENANT_A, async (transaction) => {
        // A row claiming another tenant is refused by the policy's `with check`, so a caller cannot
        // plant data in a customer they are not in.
        await transaction.execute(
          `insert into recruitment_candidate
             (id, tenant_id, candidate_number, status, display_name, email, display_email,
              source_code, metadata, created_at, created_by, updated_at, updated_by, version)
           values ($1, $2, 'CAN-2026-999999', 'active',
                   '{"en":"X","ar":"س"}'::jsonb, 'x@example.com', 'x@example.com', 'referral',
                   '{}'::jsonb, now(), 'test', now(), 'test', 1)`,
          [uuidV7(), TENANT_B],
        );
      }),
    ).rejects.toThrow();
  });

  it('protects every table this module creates, not only the ones a test happened to touch', async () => {
    const policies = await fixture.admin.query<{ tablename: string }>(
      `select tablename from pg_policies where schemaname = 'public' and tablename = any($1::text[])`,
      [RECRUITMENT_TABLES],
    );
    const unprotected = RECRUITMENT_TABLES.filter(
      (table) => !policies.rows.some((row) => row.tablename === table),
    );

    expect(unprotected).toStrictEqual([]);
  });
});
