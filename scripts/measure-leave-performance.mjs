#!/usr/bin/env node
/**
 * Measures Leave's read paths at the volumes Phase 9 names: 100,000 employments, 20,000 with leave
 * activity over two leave years, about 1,000,000 ledger entries, 400,000 requests and 1,200,000
 * request days.
 *
 * Every measurement runs **as the unprivileged application role**, under the same row-level
 * security a request runs under. Measuring as a superuser would measure a query nobody executes.
 *
 * Two of these matter for reasons beyond a screen. **`leave.approved-leave-for` is on the path of
 * every attendance recalculation**, so its cost is multiplied by every day of every run — it is the
 * one read in this module that another module pays for. And the **reconciliation read** is the one
 * that reveals a failure, so it has to stay cheap enough to sit on a dashboard that is always open.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-leave-performance.mjs [--keep|--purge]
 */

import { Client } from 'pg';

import {
  ACTIVE,
  ROLE,
  SAMPLE_FROM,
  SAMPLE_TO,
  TENANT,
  TYPE_ID,
  YEAR_TWO,
  purge,
  seed,
  tally,
} from './leave-benchmark-data.mjs';

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
 * query the product never issues — and hides exactly the cost row-level security adds.
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
    `grant select on person, employment, leave_type, leave_policy, leave_policy_assignment,
       leave_entitlement, leave_ledger_entry, leave_balance, leave_request, leave_request_day,
       leave_request_decision, leave_adjustment, leave_accrual_run, leave_year, leave_blackout
       to ${ROLE}`,
  );
};

const seeded = async () => {
  const counted = await tally(admin);

  if (counted.days > 0) {
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
    `${counts.entries.toLocaleString()} ledger entries, ` +
    `${counts.balances.toLocaleString()} balances, ` +
    `${counts.requests.toLocaleString()} requests, ` +
    `${counts.days.toLocaleString()} request days.\n`,
);

const application = new Client({ connectionString: applicationUrl() });

await application.connect();

/** One employment with leave activity, chosen from the seeded set rather than invented. */
const sample = await admin.query(
  `select id from employment where tenant_id = $1 order by id limit 1`,
  [TENANT],
);
const employmentId = sample.rows[0].id;

/**
 * Times a query the way a request runs it: inside a transaction with `app.tenant_id` set.
 *
 * The median of eleven runs rather than the best of them. A best-of figure is the number a warm
 * cache produced once, and quoting it is how a benchmark comes to disagree with production.
 */
const measure = async (label, sql, parameters) => {
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

  console.log(`${label.padEnd(52)} ${median.toFixed(1).padStart(7)} ms`);
  return median;
};

console.log('Read'.padEnd(52) + '  median');
console.log('-'.repeat(62));

await measure(
  'Balance for one employment and type',
  `select * from leave_balance
    where tenant_id = $1 and employment_id = $2 and leave_type_id = $3
      and leave_year_start = $4::date and deleted_at is null`,
  [TENANT, employmentId, TYPE_ID, YEAR_TWO],
);

await measure(
  'approved-leave-for (Attendance calls this per day)',
  `select d.*, q.state, q.leave_type_id from leave_request_day d
     join leave_request q on q.id = d.leave_request_id and q.tenant_id = d.tenant_id
    where d.tenant_id = $1 and d.employment_id = $2
      and d.on_date between $3::date and $4::date
      and d.deleted_at is null and q.deleted_at is null
      and q.state = any(array['approved','taken','closed'])`,
  [TENANT, employmentId, SAMPLE_FROM, SAMPLE_TO],
);

await measure(
  'Balance as of a past date (ledger sum)',
  `select sum(minutes)::int as total, count(*)::int as entries from leave_ledger_entry
    where tenant_id = $1 and employment_id = $2 and leave_type_id = $3
      and leave_year_start = $4::date and effective_on <= $5::date and deleted_at is null`,
  [TENANT, employmentId, TYPE_ID, YEAR_TWO, SAMPLE_TO],
);

await measure(
  'Balances awaiting recalculation (partial index)',
  `select * from leave_balance
    where tenant_id = $1 and inputs_changed_at is not null and deleted_at is null
    order by inputs_changed_at, id limit 200`,
  [TENANT],
);

await measure(
  'Approval queue, paged',
  `select * from leave_request
    where tenant_id = $1 and state = 'pending_approval' and deleted_at is null
    order by requested_at desc, id limit 25 offset 0`,
  [TENANT],
);

await measure(
  'Request register, paged and filtered',
  `select * from leave_request
    where tenant_id = $1 and deleted_at is null
      and to_date >= $2::date and from_date <= $3::date
    order by requested_at desc, id limit 25 offset 0`,
  [TENANT, SAMPLE_FROM, SAMPLE_TO],
);

await measure(
  'Calendar: who is away, over a month',
  `select d.* from leave_request_day d
     join leave_request q on q.id = d.leave_request_id and q.tenant_id = d.tenant_id
    where d.tenant_id = $1 and d.on_date between $2::date and $3::date
      and d.deleted_at is null and q.state = 'approved'
    limit 200`,
  [TENANT, SAMPLE_FROM, SAMPLE_TO],
);

await measure(
  'Conflict detection for one request (one date)',
  `select 1 from leave_request_day
    where tenant_id = $1 and employment_id = $2 and on_date = $3::date and deleted_at is null`,
  [TENANT, employmentId, SAMPLE_FROM],
);

await measure(
  'Ledger for one employment, paged',
  `select * from leave_ledger_entry
    where tenant_id = $1 and employment_id = $2 and deleted_at is null
    order by effective_on desc, id desc limit 25 offset 0`,
  [TENANT, employmentId],
);

await measure(
  `Accrual run's employment page (${ACTIVE.toLocaleString()} active)`,
  `select id from employment where tenant_id = $1 and status = 'active'
    order by id limit 200`,
  [TENANT],
);

await application.end();

if (process.argv.includes('--purge')) await purge(admin);

await admin.end();
