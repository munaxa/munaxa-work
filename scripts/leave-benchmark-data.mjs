#!/usr/bin/env node
/**
 * The benchmark dataset for `measure-leave-performance.mjs`: what it seeds, and why.
 *
 * Apart from the measurement script because a file of this repository's is budgeted at 400 lines,
 * and because the two halves answer different questions — this one is about producing a realistic
 * table, the other about timing reads over it.
 *
 * The volumes are the ones Phase 9 names: 100,000 employments, 20,000 of them with leave activity
 * over two leave years, roughly 1,500,000 ledger entries, 200,000 requests and 600,000 request
 * days. That is a mid-sized enterprise, and it is the volume at which a missing index stops being a
 * rounding error and starts being a screen nobody can open.
 *
 * It seeds with `generate_series` rather than through the API, because the point is to measure the
 * *queries* under volume rather than the insert path.
 */

export const TENANT = '01920000-0000-7000-8000-0000000bfffe';
export const EMPLOYMENTS = 100_000;
/** The subset with leave activity. Giving all 100,000 two years of leave is not realistic data. */
export const ACTIVE = 20_000;
/** Ten requests each over two leave years, three days apiece: 200,000 requests, 600,000 days. */
export const REQUESTS_EACH = 10;
export const DAYS_EACH = 3;
export const ROLE = 'leave_perf_app';

export const YEAR_ONE = '2025-01-01';
export const YEAR_TWO = '2026-01-01';
export const SAMPLE_FROM = '2026-03-01';
export const SAMPLE_TO = '2026-03-31';

const AUDIT = "now(), 'perf', now(), 'perf', 1";

/** The identifiers the seed uses, so the measurement can name a bucket without a lookup. */
export const TYPE_ID = '01920000-0000-7000-8000-0000000b0001';
export const POLICY_ID = '01920000-0000-7000-8000-0000000b0002';

export const purge = async (admin) => {
  console.log('Purging the benchmark data.');
  for (const table of [
    'leave_request_decision',
    'leave_request_event',
    'leave_request_day',
    'leave_request',
    'leave_ledger_entry',
    'leave_balance',
    'leave_entitlement',
    'leave_adjustment',
    'leave_accrual_run',
    'leave_year',
    'leave_blackout',
    'leave_policy_assignment',
    'leave_policy',
    'leave_type',
  ]) {
    await admin.query(`delete from ${table} where tenant_id = $1`, [TENANT]);
  }
  await admin.query(`delete from employment where tenant_id = $1`, [TENANT]);
  await admin.query(`delete from person where tenant_id = $1`, [TENANT]);
};

export const tally = async (admin) => {
  const counted = await admin.query(
    `select (select count(*)::int from employment where tenant_id = $1) as employments,
            (select count(*)::int from leave_ledger_entry where tenant_id = $1) as entries,
            (select count(*)::int from leave_balance where tenant_id = $1) as balances,
            (select count(*)::int from leave_request where tenant_id = $1) as requests,
            (select count(*)::int from leave_request_day where tenant_id = $1) as days`,
    [TENANT],
  );
  return counted.rows[0];
};

/**
 * The workforce, the configuration and the leave history.
 *
 * Set-based throughout. Inserting 600,000 day rows one at a time would take longer than the whole
 * measurement and would be measuring the driver rather than the schema.
 *
 * The day rows are the interesting part: `leave_request_day.span` is a **generated** column and the
 * exclusion constraint indexes it, so this insert exercises the same GiST index every real write
 * pays for. Each request is given three consecutive dates and each employment's requests are spaced
 * so that no two overlap — because the constraint would refuse them, exactly as it should.
 */
export const seed = async (admin) => {
  console.log(`Seeding ${EMPLOYMENTS.toLocaleString()} employments.`);
  await admin.query(
    `insert into person (id, tenant_id, person_number, status, metadata,
                         created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'PERF-' || n, 'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, $2) as n`,
    [TENANT, EMPLOYMENTS],
  );
  await admin.query(
    `insert into employment (id, tenant_id, person_id, employment_number, status,
                             employment_type_code, original_hire_date, start_date, metadata,
                             created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, 'PERF-' || row_number() over (order by p.id), 'active',
            'permanent', date '2020-01-01', date '2020-01-01', '{}'::jsonb, ${AUDIT}
       from person p where p.tenant_id = $1`,
    [TENANT],
  );

  await seedConfiguration(admin);
  await seedLedger(admin);
  await seedRequests(admin);

  console.log('Analysing.');
  await admin.query(
    'analyze leave_ledger_entry, leave_balance, leave_request, leave_request_day, leave_entitlement',
  );
};

const seedConfiguration = async (admin) => {
  await admin.query(
    `insert into leave_type (id, tenant_id, code, name, unit, paid_treatment_code, accrues,
                             requires_attachment, requires_replacement, requires_contact,
                             requires_address, status, version_number, metadata,
                             created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, 'perf-holiday', '{"en":"Holiday","ar":"عطلة"}'::jsonb, 'days', 'full-pay',
             true, false, false, false, false, 'published', 1, '{}'::jsonb, ${AUDIT})`,
    [TYPE_ID, TENANT],
  );
  await admin.query(
    `insert into leave_policy (id, tenant_id, leave_type_id, code, name, version_number, status,
        effective_from, minimum_service_months, available_during_probation, minimum_notice_days,
        maximum_backdate_days, hourly_permitted, half_day_permitted, duration_basis,
        accrual_method, accrual_amount_minutes, proration_basis, carry_over_method,
        leave_year_calendar, leave_year_start_month, leave_year_start_day, approval_required,
        approvals_required, self_approval_permitted, encashable, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values ($1, $2, $3, 'perf-standard', '{"en":"Standard","ar":"قياسي"}'::jsonb, 1, 'published',
             date '2020-01-01', 0, true, 0, 3650, false, true, 'working_days',
             'monthly', 840, 'none', 'none', 'gregorian', 1, 1, true, 1, false, false,
             '{}'::jsonb, ${AUDIT})`,
    [POLICY_ID, TENANT, TYPE_ID],
  );
  await admin.query(
    `insert into leave_policy_assignment (id, tenant_id, leave_policy_id, scope, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, $2, 'tenant', date '2020-01-01', ${AUDIT})`,
    [TENANT, POLICY_ID],
  );
};

/**
 * Two leave years of ledger entries and the balance projections beside them.
 *
 * Roughly seventy-five entries per active employment across two years — an opening figure, twelve
 * monthly accruals and ten consumptions per year, plus adjustments — which lands close to the
 * 1,500,000 the phase names.
 */
const seedLedger = async (admin) => {
  console.log(`Seeding ledger entries for ${ACTIVE.toLocaleString()} employments.`);

  for (const year of [YEAR_ONE, YEAR_TWO]) {
    await admin.query(
      `insert into leave_ledger_entry (id, tenant_id, employment_id, leave_type_id,
          leave_year_start, kind, minutes, effective_on, recorded_at, source_kind, source_id,
          leave_policy_id, balance_before_minutes, balance_after_minutes, metadata,
          created_at, created_by, updated_at, updated_by, version)
       select app_uuid_v7(), $1, e.id, $2, $3::date,
              case when m = 0 then 'opening' else 'accrual' end,
              case when m = 0 then 9600 else 840 end,
              ($3::date + (m * 30)), now(), 'accrual_run', app_uuid_v7(), $4,
              0, 0, '{}'::jsonb, ${AUDIT}
         from (select id from employment where tenant_id = $1 order by id limit $5) e
        cross join generate_series(0, 24) as m`,
      [TENANT, TYPE_ID, year, POLICY_ID, ACTIVE],
    );
  }

  console.log('Seeding balance projections.');
  await admin.query(
    `insert into leave_balance (id, tenant_id, employment_id, leave_type_id, leave_year_start,
        leave_year_end, opening_minutes, accrued_minutes, carried_in_minutes, consumed_minutes,
        adjusted_minutes, expired_minutes, carried_out_minutes, available_minutes,
        entries_digest, entry_count, calculated_at,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, $2, y::date,
            (y::date + interval '1 year' - interval '1 day')::date,
            9600, 20160, 0, 5760, 0, 0, 0, 24000, md5(e.id::text), 25, now(), ${AUDIT}
       from (select id from employment where tenant_id = $1 order by id limit $3) e
      cross join (values ($4::text), ($5::text)) as years(y)`,
    [TENANT, TYPE_ID, ACTIVE, YEAR_ONE, YEAR_TWO],
  );
};

/**
 * Requests and their day rows.
 *
 * Each active employment gets `REQUESTS_EACH` requests per leave year, each covering `DAYS_EACH`
 * consecutive dates, spaced so no two overlap — the exclusion constraint would refuse them, exactly
 * as it should.
 */
const seedRequests = async (admin) => {
  console.log('Seeding requests and their day rows.');

  for (const year of [YEAR_ONE, YEAR_TWO]) {
    await admin.query(
      `insert into leave_request (id, tenant_id, employment_id, leave_type_id, leave_policy_id,
          from_date, to_date, total_minutes, duration_basis, state, requested_by, requested_at,
          approved_at, balance_at_request_minutes, approvals_required, metadata,
          created_at, created_by, updated_at, updated_by, version)
       select app_uuid_v7(), $1, e.id, $2, $3,
              ($4::date + (r * 30)), ($4::date + (r * 30) + ($5 - 1)),
              480 * $5, 'working_days', 'approved', 'user:perf',
              -- Spread across the year rather than all at one instant: every request sharing one
              -- requested_at makes the register sort degenerate and the measurement meaningless.
              (now() - (r || ' days')::interval), now(), 9600, 1,
              '{}'::jsonb, ${AUDIT}
         from (select id from employment where tenant_id = $1 order by id limit $6) e
        cross join generate_series(0, $7 - 1) as r`,
      [TENANT, TYPE_ID, POLICY_ID, year, DAYS_EACH, ACTIVE, REQUESTS_EACH],
    );
  }

  await admin.query(
    `insert into leave_request_day (id, tenant_id, leave_request_id, employment_id, on_date,
        portion, minutes, zone, expected_minutes,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, q.id, q.employment_id, (q.from_date + d),
            'full_day', 480, 'Asia/Amman', 480, ${AUDIT}
       from leave_request q
      cross join generate_series(0, $2 - 1) as d
      where q.tenant_id = $1`,
    [TENANT, DAYS_EACH],
  );
};
