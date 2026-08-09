#!/usr/bin/env node
/**
 * Measures Onboarding's read paths at the volumes Phase 7 names: 100,000 employments, 250 plans with
 * 1,000 published versions, 20,000 onboarding instances of which 2,000 are live, and 400,000 tasks.
 *
 * It seeds with `generate_series` rather than through the API — the point is to measure the queries
 * under volume, not to measure the insert path — and it runs every measurement **as the unprivileged
 * application role**, under the same row-level security a request runs under. Measuring as a
 * superuser would measure a query nobody executes.
 *
 * Two of the measurements below are the ones that matter for this phase rather than for a screen.
 * `live onboarding for one employment` is the read the idempotent start makes before every write, so
 * its cost is paid on every retry and on every reconciliation candidate. `employments awaiting
 * onboarding` is the anti-join reconciliation depends on, and it is the one query here whose cost
 * grows with the *workforce* rather than with the onboardings.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-onboarding-performance.mjs [--keep|--purge]
 */

import { Client } from 'pg';

import {
  EMPLOYMENTS,
  INSTANCES,
  LIVE,
  PLANS,
  ROLE,
  TASKS,
  TENANT,
  VERSIONS,
  purge,
  seed,
} from './onboarding-benchmark-data.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL to the database to measure against.');
  process.exit(1);
}

const TODAY = '2026-08-10';

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

await seed(admin);

const application = new Client({ connectionString: applicationUrl() });

await application.connect();

const counts = await admin.query(
  `select (select count(*) from employment where tenant_id = $1) as employments,
          (select count(*) from onboarding_plan_version where tenant_id = $1) as versions,
          (select count(*) from onboarding_instance where tenant_id = $1) as instances,
          (select count(*) from onboarding_instance where tenant_id = $1
             and state in ('draft','preboarding','in_progress')) as live,
          (select count(*) from onboarding_task where tenant_id = $1) as tasks`,
  [TENANT],
);

console.log('\nSeeded:', counts.rows[0]);
console.log('\nMeasured as the unprivileged application role, under row-level security:\n');

await asTenant(application, async () => {
  await measure(
    application,
    'live onboarding for one employment (the start read)',
    `select * from onboarding_instance o
      where o.tenant_id = $1 and o.employment_id = (select id from employment
                                                     where tenant_id = $1 and employment_number = 'PRF-PRF-0000500')
        and o.state in ('draft','preboarding','in_progress') and o.deleted_at is null`,
    [TENANT],
  );
  await measure(
    application,
    'HR task queue by role (indexed)',
    `select * from onboarding_task k
      where k.tenant_id = $1 and k.owner_role = 'it' and k.status = 'pending' and k.deleted_at is null
      order by k.due_on nulls last, k.sequence limit 25`,
    [TENANT],
  );
  await measure(
    application,
    'task queue for one employment (indexed)',
    `select * from onboarding_task k
      where k.tenant_id = $1 and k.owner_kind = 'employment'
        and k.owner_ref = (select id from employment
                            where tenant_id = $1 and employment_number = 'PRF-PRF-0000500')
        and k.status = 'pending' and k.deleted_at is null
      order by k.due_on nulls last limit 25`,
    [TENANT],
  );
  await measure(
    application,
    'overdue required tasks (computed, indexed)',
    `select * from onboarding_task k
      where k.tenant_id = $1 and k.deleted_at is null and k.required
        and k.status not in ('done','waived','cancelled')
        and k.due_on is not null and k.due_on < $2::date
      order by k.due_on limit 25`,
    [TENANT, TODAY],
  );
  await measure(
    application,
    'one onboarding with its tasks',
    `select * from onboarding_task k
      where k.tenant_id = $1 and k.deleted_at is null
        and k.onboarding_id = (select id from onboarding_instance
                                where tenant_id = $1 and state = 'in_progress' limit 1)
      order by k.sequence`,
    [TENANT],
  );
  await measure(
    application,
    'progress tally for one onboarding (aggregate)',
    `select count(*) filter (where required) as required_total,
            count(*) filter (where required and status in ('done','waived')) as required_satisfied,
            count(*) filter (where required and status not in ('done','waived','cancelled')
              and due_on is not null and due_on < $2::date) as required_overdue
       from onboarding_task
      where tenant_id = $1 and deleted_at is null
        and onboarding_id = (select id from onboarding_instance
                              where tenant_id = $1 and state = 'in_progress' limit 1)`,
    [TENANT, TODAY],
  );
  await measure(
    application,
    'onboarding search page (indexed, counted)',
    `select * from onboarding_instance o
      where o.tenant_id = $1 and o.deleted_at is null and o.state = 'in_progress'
      order by o.planned_start_on, o.id limit 25 offset 0`,
    [TENANT],
  );
  await measure(
    application,
    'onboardings with an overdue required task (exists)',
    `select * from onboarding_instance o
      where o.tenant_id = $1 and o.deleted_at is null and o.state = 'in_progress'
        and exists (select 1 from onboarding_task d
                     where d.tenant_id = o.tenant_id and d.onboarding_id = o.id
                       and d.deleted_at is null and d.required
                       and d.status not in ('done','waived','cancelled')
                       and d.due_on is not null and d.due_on < $2::date)
      order by o.planned_start_on limit 25`,
    [TENANT, TODAY],
  );
  await measure(
    application,
    'employments awaiting onboarding (the reconciliation read)',
    `select o.employment_id from onboarding_instance o
      where o.tenant_id = $1 and o.deleted_at is null
        and o.employment_id = any((select array_agg(id) from (
              select id from employment where tenant_id = $1 and status = 'active'
               order by start_date desc limit 200) e)::uuid[])`,
    [TENANT],
  );

  const plan = await application.query(
    `explain (analyze, buffers) select * from onboarding_task k
      where k.tenant_id = $1 and k.deleted_at is null and k.required
        and k.status not in ('done','waived','cancelled')
        and k.due_on is not null and k.due_on < $2::date
      order by k.due_on limit 25`,
    [TENANT, TODAY],
  );

  console.log('\nPlan for the overdue query — computed, never a stored flag:\n');
  for (const row of plan.rows) console.log(`  ${row['QUERY PLAN']}`);
});

await application.end();

// The benchmark data is **kept by default**, and that is the deliberate choice rather than the lazy
// one: rebuilding 520,000 rows on every run costs more than it is worth, and removing them costs more
// still for the reason documented above `clean()`. `--purge` removes everything for somebody who
// wants the tenant gone and is willing to wait.
if (process.argv.includes('--purge')) {
  await purge(admin);
  console.log('\nEverything removed, including the seeded workforce.');
} else {
  console.log(
    `\nBenchmark data left in place under tenant ${TENANT}. Pass --purge to remove it.`,
  );
}
await admin.end();
