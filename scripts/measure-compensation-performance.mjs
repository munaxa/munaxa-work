#!/usr/bin/env node
/**
 * Measures Compensation's read paths at the volumes Phase 10 names: 100,000 employments, 60,000 of
 * them paid, ~2.9 million recurring rows, 500,000 one-time items and ~2.9 million history rows.
 *
 * Every measurement runs **as the unprivileged application role**, under the same row-level
 * security a request runs under. Measuring as a superuser would measure a query nobody executes and
 * would hide exactly the cost row-level security adds.
 *
 * **The payroll-period query is the one that matters.** Decision D-7 declined a compensation
 * projection on the argument that the authoritative rows answer it fast enough set-based; this
 * script is the evidence for or against that, and its number is reported whatever it says.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-compensation-performance.mjs [--purge]
 */

import { Client } from 'pg';

import {
  AS_OF_PAST,
  PERIOD_END,
  PERIOD_START,
  ROLE,
  TENANT,
  purge,
  seed,
  tally,
} from './compensation-benchmark-data.mjs';

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
  url.password = 'perf';
  return url.toString();
};

/**
 * The role the measurements run as: it owns nothing and cannot bypass row-level security.
 *
 * A superuser sees every row without consulting a policy, so a benchmark run as one measures a
 * query the product never issues.
 */
const ensureRole = async () => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'perf';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select on person, employment, compensation_plan, compensation_plan_assignment,
       compensation_plan_component, compensation_salary_structure, compensation_pay_grade,
       compensation_pay_scale, compensation_salary_step, compensation_component,
       compensation_recurring, compensation_one_time, compensation_adjustment,
       compensation_approval_decision, compensation_change, compensation_import_batch
       to ${ROLE}`,
  );
};

if (process.argv.includes('--purge')) {
  await purge(admin);
  console.log('Purged.');
  await admin.end();
  process.exit(0);
}

const seeded = async () => {
  const counted = await tally(admin);

  if (counted.recurring > 0) {
    console.log('Reusing the seeded dataset.');
    return counted;
  }
  await purge(admin);
  await seed(admin);
  return tally(admin);
};

await ensureRole();

const counts = await seeded();

console.log(
  `\nDataset: ${counts.employments.toLocaleString()} employments, ` +
    `${counts.recurring.toLocaleString()} recurring rows, ` +
    `${counts.oneTime.toLocaleString()} one-time items, ` +
    `${counts.changes.toLocaleString()} history rows, ` +
    `${counts.components.toLocaleString()} components.\n`,
);

const application = new Client({ connectionString: applicationUrl() });

await application.connect();

/** Employments chosen from the seeded set rather than invented, so every one has compensation. */
const sample = await admin.query(
  `select employment_id from compensation_recurring
    where tenant_id = $1 group by employment_id limit 500`,
  [TENANT],
);
const employmentId = sample.rows[0].employment_id;
const page = sample.rows.map((row) => row.employment_id);

/**
 * Times a query the way a request runs it: inside a transaction with `app.tenant_id` set.
 *
 * The median of eleven runs rather than the best of them. A best-of figure is the number a warm
 * cache produced once, and quoting it is how a benchmark comes to disagree with production.
 */
const measure = async (label, budget, sql, parameters) => {
  const timings = [];

  for (let run = 0; run < 11; run += 1) {
    await application.query('begin');
    await application.query(`select set_config('app.tenant_id', $1, true)`, [TENANT]);

    const started = process.hrtime.bigint();

    await application.query(sql, parameters);
    timings.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    await application.query('commit');
  }
  timings.sort((one, other) => one - other);

  const median = timings[Math.floor(timings.length / 2)];
  const verdict = median <= budget ? 'ok' : 'OVER';

  console.log(
    `${label.padEnd(50)} ${median.toFixed(1).padStart(8)} ms  ` +
      `${String(budget).padStart(4)} ms  ${verdict}`,
  );
  return median;
};

console.log('Read'.padEnd(50) + '    median  budget');
console.log('-'.repeat(76));

await measure(
  'Current compensation for one employment',
  50,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.employment_id = $2 and r.deleted_at is null
      and r.effective_from <= current_date
      and (r.effective_to is null or r.effective_to > current_date)`,
  [TENANT, employmentId],
);

await measure(
  'Compensation as of a past date',
  50,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.employment_id = $2 and r.deleted_at is null
      and r.effective_from <= $3::date
      and (r.effective_to is null or r.effective_to > $3::date)`,
  [TENANT, employmentId, AS_OF_PAST],
);

/** **The read decision D-7 rests on.** A page of 500 employments, resolved in one statement. */
await measure(
  'Payroll period — 500 employments, set-based',
  500,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.employment_id = any($2::uuid[]) and r.deleted_at is null
      and r.effective_from <= $4::date
      and (r.effective_to is null or r.effective_to > $3::date)
    order by r.employment_id, r.component_id, r.effective_from`,
  [TENANT, page, PERIOD_START, PERIOD_END],
);

await measure(
  'Payroll period — one-time items for the same page',
  500,
  `select * from compensation_one_time o
    where o.tenant_id = $1 and o.employment_id = any($2::uuid[]) and o.deleted_at is null
      and o.payable_on between $3::date and $4::date`,
  [TENANT, page, PERIOD_START, PERIOD_END],
);

await measure(
  'Component catalogue',
  50,
  `select * from compensation_component c
    where c.tenant_id = $1 and c.deleted_at is null order by c.code, c.version_number`,
  [TENANT],
);

await measure(
  'Adjustment history for one employment',
  50,
  `select * from compensation_adjustment a
    where a.tenant_id = $1 and a.employment_id = $2 and a.deleted_at is null
    order by a.recorded_at desc, a.id desc limit 25`,
  [TENANT, employmentId],
);

await measure(
  'Future changes for one employment',
  50,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.employment_id = $2 and r.deleted_at is null
      and r.effective_from > current_date
    order by r.effective_from`,
  [TENANT, employmentId],
);

await measure(
  'changed-since over a month',
  200,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.deleted_at is null and r.recorded_at > $2
      and r.effective_from <= $4::date
      and (r.effective_to is null or r.effective_to > $3::date)
    order by r.recorded_at desc, r.id desc limit 500`,
  [TENANT, new Date('2025-06-01T00:00:00Z'), PERIOD_START, PERIOD_END],
);

await measure(
  'Register, paged and filtered',
  50,
  `select * from compensation_recurring r
    where r.tenant_id = $1 and r.deleted_at is null
    order by r.effective_from desc, r.id desc limit 25 offset 0`,
  [TENANT],
);

await measure(
  'Compensation history for one employment, paged',
  50,
  `select * from compensation_change h
    where h.tenant_id = $1 and h.employment_id = $2 and h.deleted_at is null
    order by h.recorded_at desc, h.id desc limit 25`,
  [TENANT, employmentId],
);

console.log(
  '\nBudgets are the ones in the approved Phase 10 plan. Medians of eleven runs, as the ' +
    'unprivileged role under row-level security.',
);

await application.end();
await admin.end();
