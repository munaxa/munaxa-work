#!/usr/bin/env node
/**
 * Measures Recruitment's read paths at the volumes Phase 6 names: 100,000 candidates, 250,000
 * applications and 10,000 vacancies in one tenant.
 *
 * It seeds with `generate_series` rather than through the API — the point is to measure the queries
 * under volume, not to measure the insert path — and it runs every measurement **as the
 * unprivileged application role**, under the same row-level security a request runs under. Measuring
 * as a superuser would measure a query nobody executes: the policy is applied before the filter, and
 * that is exactly what makes the candidate name search a sequential scan (A-9).
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-recruitment-performance.mjs [--keep]
 */

import { Client } from 'pg';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL to the database to measure against.');
  process.exit(1);
}

const TENANT = '01920000-0000-7000-8000-0000000cffff';
const CANDIDATES = 100_000;
const APPLICATIONS = 250_000;
const VACANCIES = 10_000;
const ROLE = 'recruitment_perf_app';
const AUDIT = "now(), 'perf', now(), 'perf', 1";

const admin = new Client({ connectionString: CONNECTION });
await admin.connect();

const applicationUrl = () => {
  const url = new URL(CONNECTION);

  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
};

const seed = async () => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(`grant select on all tables in schema public to ${ROLE}`);
  await admin.query(
    `delete from recruitment_application where tenant_id = $1;
     delete from recruitment_candidate where tenant_id = $1;
     delete from recruitment_vacancy where tenant_id = $1;
     delete from recruitment_requisition where tenant_id = $1;`.replaceAll('$1', `'${TENANT}'`),
  );

  console.log(`Seeding ${VACANCIES} vacancies…`);
  await admin.query(
    `insert into recruitment_requisition
       (id, tenant_id, requisition_number, status, position_id, unit_id, headcount_requested,
        reason_code, requested_by_employment_id, metadata, created_at, created_by, updated_at,
        updated_by, version)
     select app_uuid_v7(), $1, 'REQ-2026-' || lpad(n::text, 6, '0'), 'open',
            app_uuid_v7(), app_uuid_v7(), 1, 'growth', app_uuid_v7(), '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${VACANCIES}) as n`,
    [TENANT],
  );
  await admin.query(
    `insert into recruitment_vacancy
       (id, tenant_id, requisition_id, title, status, channels, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, r.id,
            jsonb_build_object('en', 'Role ' || r.requisition_number, 'ar', 'وظيفة'),
            'published', '{}', '{}'::jsonb, ${AUDIT}
       from recruitment_requisition r where r.tenant_id = $1`,
    [TENANT],
  );

  console.log(`Seeding ${CANDIDATES} candidates…`);
  await admin.query(
    `insert into recruitment_candidate
       (id, tenant_id, candidate_number, status, display_name, email, phone, display_email,
        source_code, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'CAN-2026-' || lpad(n::text, 6, '0'), 'active',
            jsonb_build_object('en', 'Candidate ' || n, 'ar', 'مرشح ' || n),
            'candidate' || n || '@example.com',
            '+9665' || lpad(n::text, 8, '0'),
            'Candidate' || n || '@example.com',
            'careers-site', '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${CANDIDATES}) as n`,
    [TENANT],
  );

  console.log(`Seeding ${APPLICATIONS} applications…`);
  // Two and a half applications per candidate, spread across the vacancies, which is what makes the
  // pipeline counts and the candidate joins meaningful rather than uniform.
  //
  // The vacancy shifts with each pass over the candidate list, so the 150,000 rows past the first
  // pass are *distinct* candidate-and-vacancy pairs rather than duplicates the unique index would
  // silently drop — which is how the first run of this script quietly seeded 100,000 instead of
  // 250,000 and reported a smaller table as though it were the target volume.
  await admin.query(
    `insert into recruitment_application
       (id, tenant_id, application_number, candidate_id, vacancy_id, status, source_code,
        applied_on, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'APP-2026-' || lpad(n::text, 7, '0'),
            c.id, v.id,
            (array['received','screening','shortlisted','interviewing','evaluated','offered'])[1 + (n % 6)],
            'careers-site', date '2026-01-01' + (n % 240), '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${APPLICATIONS}) as n
       join lateral (select id from recruitment_candidate
                      where tenant_id = $1 and candidate_number = 'CAN-2026-' || lpad((1 + (n % ${CANDIDATES}))::text, 6, '0')) c on true
       join lateral (select v.id from recruitment_vacancy v
                      join recruitment_requisition r on r.id = v.requisition_id
                     where v.tenant_id = $1
                       and r.requisition_number = 'REQ-2026-' ||
                           lpad((1 + ((n + (n / ${CANDIDATES})) % ${VACANCIES}))::text, 6, '0')) v on true`,
    [TENANT],
  );

  await admin.query('analyze recruitment_candidate, recruitment_application, recruitment_vacancy');
};

/** Runs a query five times and reports the median, which is less noisy than a single run. */
const measure = async (client, label, sql, parameters) => {
  const timings = [];

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const started = process.hrtime.bigint();

    await client.query(sql, parameters);
    timings.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  timings.sort((left, right) => left - right);
  console.log(`${label.padEnd(52)} ${timings[2].toFixed(1).padStart(8)} ms`);
  return timings[2];
};

const asTenant = async (client, work) => {
  await client.query('begin');
  await client.query("select set_config('app.tenant_id', $1, true)", [TENANT]);
  const result = await work();

  await client.query('commit');
  return result;
};

await seed();

const application = new Client({ connectionString: applicationUrl() });

await application.connect();

const counts = await admin.query(
  `select (select count(*) from recruitment_candidate where tenant_id = $1) as candidates,
          (select count(*) from recruitment_application where tenant_id = $1) as applications,
          (select count(*) from recruitment_vacancy where tenant_id = $1) as vacancies`,
  [TENANT],
);

console.log('\nSeeded:', counts.rows[0]);
console.log('\nMeasured as the unprivileged application role, under row-level security:\n');

await asTenant(application, async () => {
  await measure(
    application,
    'candidate by email (indexed)',
    `select * from recruitment_candidate c
      where c.tenant_id = $1 and c.email = $2 and c.deleted_at is null`,
    [TENANT, 'candidate50000@example.com'],
  );
  await measure(
    application,
    'candidate by telephone (indexed)',
    `select * from recruitment_candidate c
      where c.tenant_id = $1 and c.phone = $2 and c.deleted_at is null`,
    [TENANT, '+966500050000'],
  );
  await measure(
    application,
    'candidate page by number (indexed, ordered)',
    `select * from recruitment_candidate c
      where c.tenant_id = $1 and c.deleted_at is null
      order by c.candidate_number limit 25 offset 0`,
    [TENANT],
  );
  await measure(
    application,
    'candidate name search (ilike, sequential — A-9)',
    `select * from recruitment_candidate c
      where c.tenant_id = $1 and c.deleted_at is null
        and (c.candidate_number ilike $2 or c.display_name->>'en' ilike $2)
      order by c.candidate_number limit 25 offset 0`,
    [TENANT, '%Candidate 4242%'],
  );
  await measure(
    application,
    'pipeline board for one vacancy (aggregate)',
    `select a.status, count(*)::text from recruitment_application a
      where a.tenant_id = $1 and a.deleted_at is null
        and a.vacancy_id = (select id from recruitment_vacancy where tenant_id = $1 limit 1)
      group by a.status`,
    [TENANT],
  );
  await measure(
    application,
    'applications for one candidate (indexed)',
    `select * from recruitment_application a
      where a.tenant_id = $1 and a.deleted_at is null
        and a.candidate_id = (select id from recruitment_candidate
                               where tenant_id = $1 and candidate_number = 'CAN-2026-050000')
      order by a.applied_on desc`,
    [TENANT],
  );
  await measure(
    application,
    'unfinished hires (partial index)',
    `select * from recruitment_application a
      where a.tenant_id = $1 and a.deleted_at is null and a.hire_state is not null
        and a.hire_state <> 'completed' and a.status <> 'hired' limit 25`,
    [TENANT],
  );
  await measure(
    application,
    'application page by status (indexed)',
    `select * from recruitment_application a
      where a.tenant_id = $1 and a.deleted_at is null and a.status = 'offered'
      order by a.applied_on desc limit 25 offset 0`,
    [TENANT],
  );

  const plan = await application.query(
    `explain (analyze, buffers) select * from recruitment_candidate c
      where c.tenant_id = $1 and c.deleted_at is null
        and (c.candidate_number ilike $2 or c.display_name->>'en' ilike $2)
      order by c.candidate_number limit 25`,
    [TENANT, '%Candidate 4242%'],
  );

  console.log('\nPlan for the name search — the documented sequential scan:\n');
  for (const row of plan.rows) console.log(`  ${row['QUERY PLAN']}`);
});

await application.end();

if (!process.argv.includes('--keep')) {
  await admin.query(
    `delete from recruitment_application where tenant_id = $1;
     delete from recruitment_candidate where tenant_id = $1;
     delete from recruitment_vacancy where tenant_id = $1;
     delete from recruitment_requisition where tenant_id = $1;`.replaceAll('$1', `'${TENANT}'`),
  );
  console.log('\nSeed data removed. Pass --keep to leave it in place.');
}
await admin.end();
