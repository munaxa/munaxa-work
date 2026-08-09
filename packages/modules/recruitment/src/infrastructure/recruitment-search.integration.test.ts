import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidV7 } from '@work/kernel';

import {
  CONNECTION,
  TENANT_A,
  openRecruitmentFixture,
  requireDatabaseInCi,
  type RecruitmentFixture,
} from './recruitment-database.fixture.js';

/**
 * Candidate and application search, against the real queries.
 *
 * The `profileCode` filter is a **subquery against the profile table**, which is exactly the part of
 * search the in-memory store cannot honestly reproduce — so it is proved here, against PostgreSQL,
 * or not at all. The same is true of the `unfinishedHire` reconciliation filter, which reads the
 * partial index the hire saga depends on.
 *
 * The last test keeps §45 true as the module grows: the indexes a recruitment product's queries
 * depend on either exist or the plan quietly becomes a sequential scan, and a sequential scan over
 * a hundred thousand candidates is the performance failure that arrives without a stack trace.
 */

requireDatabaseInCi('Recruitment search');

const AUDIT = `now(), 'test', now(), 'test', 1`;

describe.skipIf(CONNECTION === undefined)('Recruitment search', () => {
  let fixture: RecruitmentFixture;
  let candidateId: string;

  beforeAll(async () => {
    fixture = await openRecruitmentFixture('recruitment_search_app');
  });

  afterAll(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    await fixture.truncate();
    candidateId = uuidV7();

    await fixture.admin.query(
      `insert into recruitment_candidate
         (id, tenant_id, candidate_number, status, display_name, email, phone, display_email,
          source_code, metadata, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'CAN-2026-000001', 'active',
               '{"en":"Noura Al-Fahad","ar":"نورة الفهد"}'::jsonb,
               'noura@example.com', '+966501234567', 'Noura@Example.com', 'referral',
               '{}'::jsonb, ${AUDIT})`,
      [candidateId, TENANT_A],
    );
    await fixture.admin.query(
      `insert into recruitment_candidate_profile_entry
         (id, tenant_id, candidate_id, kind, code, title,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, 'skill', 'welding-tig',
               '{"en":"TIG welding","ar":"لحام التنجستن"}'::jsonb, ${AUDIT})`,
      [uuidV7(), TENANT_A, candidateId],
    );
  });

  const search = (query: Record<string, unknown>) =>
    fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.candidates.search(transaction, { limit: 25, offset: 0, ...query }),
    );

  it('finds a candidate by the skill they claim', async () => {
    const found = await search({ profileCode: 'welding-tig' });

    expect(found.items.map((item) => item.id)).toStrictEqual([candidateId]);
    expect(found.total).toBe(1);
  });

  it('returns nobody for a skill nobody claimed', async () => {
    const found = await search({ profileCode: 'scaffolding' });

    expect(found.total).toBe(0);
  });

  it('normalizes an address before comparing it, as the create did before storing it', async () => {
    const found = await search({ email: '  NOURA@Example.com ' });

    expect(found.total).toBe(1);
  });

  it('matches the name in either language, and the candidate number', async () => {
    await expect(search({ term: 'fahad' }).then((page) => page.total)).resolves.toBe(1);
    await expect(search({ term: 'نورة' }).then((page) => page.total)).resolves.toBe(1);
    await expect(search({ term: 'CAN-2026' }).then((page) => page.total)).resolves.toBe(1);
    await expect(search({ term: 'nobody' }).then((page) => page.total)).resolves.toBe(0);
  });

  it('finds the hires that started and did not finish', async () => {
    const requisitionId = uuidV7();
    const vacancyId = uuidV7();
    const applicationId = uuidV7();

    await fixture.admin.query(
      `insert into recruitment_requisition
         (id, tenant_id, requisition_number, status, position_id, unit_id, headcount_requested,
          reason_code, requested_by_employment_id, metadata,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'REQ-2026-000001', 'open', $3, $4, 1, 'growth', $5, '{}'::jsonb, ${AUDIT})`,
      [requisitionId, TENANT_A, uuidV7(), uuidV7(), uuidV7()],
    );
    await fixture.admin.query(
      `insert into recruitment_vacancy
         (id, tenant_id, requisition_id, title, status, channels, metadata,
          created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, $3, '{"en":"Field engineer","ar":"مهندس ميداني"}'::jsonb,
               'published', '{}', '{}'::jsonb, ${AUDIT})`,
      [vacancyId, TENANT_A, requisitionId],
    );
    await fixture.admin.query(
      `insert into recruitment_application
         (id, tenant_id, application_number, candidate_id, vacancy_id, status, source_code,
          applied_on, hire_state, metadata, created_at, created_by, updated_at, updated_by, version)
       values ($1, $2, 'APP-2026-000001', $3, $4, 'offered', 'referral', '2026-09-04',
               'person_linked', '{}'::jsonb, ${AUDIT})`,
      [applicationId, TENANT_A, candidateId, vacancyId],
    );

    const unfinished = await fixture.asTenant(TENANT_A, (transaction) =>
      fixture.stores.applications.search(transaction, {
        limit: 25,
        offset: 0,
        unfinishedHire: true,
      }),
    );

    expect(unfinished.items.map((item) => item.id)).toStrictEqual([applicationId]);
  });

  it('keeps the indexes this module’s queries plan against', async () => {
    const indexes = await fixture.admin.query<{ indexname: string }>(
      `select indexname from pg_indexes
        where schemaname = 'public' and tablename like 'recruitment%'`,
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        'recruitment_candidate_email_idx',
        'recruitment_candidate_phone_idx',
        'recruitment_candidate_person_key',
        'recruitment_application_pipeline_idx',
        'recruitment_application_candidate_vacancy_key',
        'recruitment_application_employment_key',
        'recruitment_application_hire_state_idx',
        'recruitment_offer_one_live_key',
        'recruitment_feedback_interviewer_key',
      ]),
    );
  });
});
