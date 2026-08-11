#!/usr/bin/env node
/**
 * Measures Attendance's read paths at the volumes Phase 8 names: 100,000 employments, about
 * 1,440,000 time events and 360,000 calculated days across a ninety-day window.
 *
 * It seeds with `generate_series` rather than through the API — the point is to measure the queries
 * under volume, not the insert path — and it runs every measurement **as the unprivileged
 * application role**, under the same row-level security a request runs under. Measuring as a
 * superuser would measure a query nobody executes.
 *
 * Three of the measurements matter for this phase rather than for a screen. The **deduplication
 * read** is made before every single punch, so its cost is paid on every retry from every turnstile
 * in the building. The **reconciliation read** is the one that reveals a failure, and it has to stay
 * cheap enough to sit on a dashboard. And **one day's events** is what a recalculation reads per
 * day, so it is multiplied by every day a run touches.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-attendance-performance.mjs [--keep|--purge]
 */

import { Client } from 'pg';

import {
  FIRST_DATE,
  LAST_DATE,
  MID_DATE,
  ROLE,
  TENANT,
  purge,
  seed,
} from './attendance-benchmark-data.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL to the database to measure against.');
  process.exit(1);
}

const admin = new Client({ connectionString: CONNECTION });

await admin.connect();

const applicationUrl = () => {
  const url = new URL(CONNECTION);

  url.username = ROLE;
  url.password = 'fixture';
  return url.toString();
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
  console.log(`${label.padEnd(56)} ${timings[2].toFixed(1).padStart(8)} ms`);
  return timings[2];
};

const asTenant = async (client, work) => {
  await client.query('begin');
  await client.query("select set_config('app.tenant_id', $1, true)", [TENANT]);
  const result = await work();

  await client.query('commit');
  return result;
};

await seed(admin);

const application = new Client({ connectionString: applicationUrl() });

await application.connect();

const counts = await admin.query(
  `select (select count(*) from employment where tenant_id = $1) as employments,
          (select count(*) from attendance_time_event where tenant_id = $1) as events,
          (select count(*) from attendance_day where tenant_id = $1) as days,
          (select count(*) from attendance_day where tenant_id = $1
             and inputs_changed_at is not null) as stale,
          (select count(*) from attendance_day_exception where tenant_id = $1
             and state = 'open') as open_exceptions`,
  [TENANT],
);

console.log('\nSeeded:', counts.rows[0]);
console.log('\nMeasured as the unprivileged application role, under row-level security:\n');

const anEmployment = await admin.query(
  `select id from employment where tenant_id = $1 and employment_number = 'ATT-ATT-0000500'`,
  [TENANT],
);
const employmentId = anEmployment.rows[0].id;

await asTenant(application, async () => {
  await measure(
    application,
    'deduplication read (made before every punch)',
    `select * from attendance_time_event e
      where e.tenant_id = $1 and e.event_key = $2 and e.deleted_at is null`,
    [TENANT, `k:${employmentId}:${MID_DATE}:clock_in`],
  );
  await measure(
    application,
    'one day for one employment (the ingestion touch)',
    `select * from attendance_day d
      where d.tenant_id = $1 and d.employment_id = $2 and d.attendance_date = $3::date
        and d.deleted_at is null`,
    [TENANT, employmentId, MID_DATE],
  );
  await measure(
    application,
    "one day's events (read per day by every recalculation)",
    `select * from attendance_time_event e
      where e.tenant_id = $1 and e.employment_id = $2 and e.attendance_date = $3::date
        and e.deleted_at is null order by e.occurred_at, e.id`,
    [TENANT, employmentId, MID_DATE],
  );
  await measure(
    application,
    'the reconciliation read (partial index, bounded)',
    `select * from attendance_day d
      where d.tenant_id = $1 and d.inputs_changed_at is not null and d.deleted_at is null
      order by d.inputs_changed_at, d.id limit 200`,
    [TENANT],
  );
  await measure(
    application,
    "one employment's month of days",
    `select * from attendance_day d
      where d.tenant_id = $1 and d.employment_id = $2
        and d.attendance_date between $3::date and $4::date and d.deleted_at is null
      order by d.attendance_date`,
    [TENANT, employmentId, FIRST_DATE, LAST_DATE],
  );
  await measure(
    application,
    'the daily attendance screen (one date, paged)',
    `select * from attendance_day d
      where d.tenant_id = $1 and d.attendance_date = $2::date and d.deleted_at is null
      order by d.attendance_date desc, d.id limit 25 offset 0`,
    [TENANT, MID_DATE],
  );
  await measure(
    application,
    'the open exception queue (indexed, paged)',
    `select * from attendance_day_exception x
      where x.tenant_id = $1 and x.state = 'open' and x.deleted_at is null
      order by x.attendance_date desc, x.severity desc, x.id limit 25`,
    [TENANT],
  );
  await measure(
    application,
    'blocking exceptions for one employment and month (counted)',
    `select count(*)::text from attendance_day_exception x
      where x.tenant_id = $1 and x.employment_id = $2
        and x.attendance_date between $3::date and $4::date
        and x.severity = 'blocking' and x.state = 'open' and x.deleted_at is null`,
    [TENANT, employmentId, FIRST_DATE, LAST_DATE],
  );
  await measure(
    application,
    'schedule assignment lookup (as at a date)',
    `select * from attendance_schedule_assignment a
      where a.tenant_id = $1 and a.employment_id = $2 and a.deleted_at is null
      order by a.effective_from`,
    [TENANT, employmentId],
  );
  await measure(
    application,
    'roster window for one employment',
    `select * from attendance_roster_entry r
      where r.tenant_id = $1 and r.on_date between $2::date and $3::date and r.deleted_at is null
        and ($4::uuid is null or r.employment_id = $4::uuid)
      order by r.on_date, r.employment_id`,
    [TENANT, FIRST_DATE, LAST_DATE, employmentId],
  );
  await measure(
    application,
    'the dashboard counts for one date (aggregate)',
    `select count(*) filter (where expected_minutes > 0) as expected,
            count(*) filter (where worked_minutes > 0) as present,
            count(*) filter (where inputs_changed_at is not null) as awaiting
       from attendance_day
      where tenant_id = $1 and attendance_date = $2::date and deleted_at is null`,
    [TENANT, MID_DATE],
  );
  await measure(
    application,
    "one employment's punches, paged (the raw register)",
    `select * from attendance_time_event e
      where e.tenant_id = $1 and e.employment_id = $2 and e.deleted_at is null
      order by e.occurred_at desc, e.id limit 25 offset 0`,
    [TENANT, employmentId],
  );

  const plan = await application.query(
    `explain (analyze, buffers) select * from attendance_day d
      where d.tenant_id = $1 and d.inputs_changed_at is not null and d.deleted_at is null
      order by d.inputs_changed_at, d.id limit 200`,
    [TENANT],
  );

  console.log('\nPlan for the reconciliation read — the partial index, not a sequential scan:\n');
  for (const row of plan.rows) console.log(`  ${row['QUERY PLAN']}`);
});

await application.end();

// The benchmark data is **kept by default**, and that is the deliberate choice rather than the lazy
// one: rebuilding two million rows on every run costs more than it is worth, and removing them costs
// more still for the reason documented above `clean()`. `--purge` removes everything for somebody
// who wants the tenant gone and is willing to wait.
if (process.argv.includes('--purge')) {
  await purge(admin);
  console.log('\nEverything removed, including the seeded workforce.');
} else {
  console.log(`\nBenchmark data left in place under tenant ${TENANT}. Pass --purge to remove it.`);
}
await admin.end();
