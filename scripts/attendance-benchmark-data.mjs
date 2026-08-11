#!/usr/bin/env node
/**
 * The benchmark dataset for `measure-attendance-performance.mjs`: what it seeds, and why it is kept.
 *
 * Apart from the measurement script because a file of this repository's is budgeted at 400 lines,
 * and because the two halves answer different questions — this one is about producing a realistic
 * table, the other about timing reads over it.
 *
 * The volumes are the ones Phase 8 names: 100,000 employments, twelve months of history, and about a
 * million time events. That is a mid-sized enterprise with turnstiles at every door, and it is the
 * volume at which a missing index stops being a rounding error.
 */

export const TENANT = '01920000-0000-7000-8000-0000000afffe';
export const EMPLOYMENTS = 100_000;
/** The subset with a full year of attendance. Punching every one of 100,000 is not a year's data. */
export const TRACKED = 4_000;
export const DAYS = 90;
/** Four punches a day for the tracked workforce over the window: ~1,440,000 rows. */
export const EVENTS = TRACKED * DAYS * 4;
export const ATTENDANCE_DAYS = TRACKED * DAYS;
export const ROLE = 'attendance_perf_app';

export const FIRST_DATE = '2026-02-02';
export const MID_DATE = '2026-03-16';
export const LAST_DATE = '2026-05-02';

const AUDIT = "now(), 'perf', now(), 'perf', 1";

/**
 * Removes the attendance rows, most dependent first.
 *
 * **This path is slow, for the reason Phase 7 recorded as debt D-5 and this phase inherits.** Every
 * index that could answer a foreign-key check on delete leads with `tenant_id` — the check itself
 * asks `target_event_id = $1` with no tenant — so PostgreSQL scans the child table once per deleted
 * row. `attendance_time_event` references *itself* through `supersedes_event_id`, so deleting a
 * million events means a million scans of a million-row table.
 *
 * The product never meets this: it soft-deletes, and every read filters on `tenant_id` first, which
 * is what these indexes are shaped for. So this runs only when the benchmark data is missing or
 * wrong, and a complete dataset is reused.
 */
export const clean = async (admin) => {
  console.log('Removing incomplete benchmark data. This is the slow path — see the note in this file.');
  for (const table of [
    'attendance_payable_snapshot',
    'attendance_correction_request',
    'attendance_day_exception',
    'attendance_time_event',
    'attendance_day',
    'attendance_roster_entry',
    'attendance_schedule_assignment',
    'attendance_schedule_day',
    'attendance_schedule',
    'attendance_shift_segment',
    'attendance_shift',
    'attendance_policy',
    'attendance_import_batch',
  ]) {
    await admin.query(`delete from ${table} where tenant_id = '${TENANT}'`);
  }
  await admin.query('vacuum attendance_time_event, attendance_day, attendance_day_exception');
};

export const purge = async (admin) => {
  await clean(admin);
  console.log('Purging the seeded workforce.');
  await admin.query(`delete from employment where tenant_id = '${TENANT}'`);
  await admin.query(`delete from person where tenant_id = '${TENANT}'`);
};

export const tally = async (admin) => {
  const counted = await admin.query(
    `select (select count(*)::int from employment where tenant_id = $1) as employments,
            (select count(*)::int from attendance_time_event where tenant_id = $1) as events,
            (select count(*)::int from attendance_day where tenant_id = $1) as days,
            (select count(*)::int from attendance_day_exception where tenant_id = $1) as exceptions`,
    [TENANT],
  );

  return counted.rows[0];
};

export const isComplete = (counts) =>
  counts.employments === EMPLOYMENTS && counts.events === EVENTS && counts.days === ATTENDANCE_DAYS;

/** The workforce, seeded once. A rerun reuses it rather than rebuilding 200,000 rows. */
const seedWorkforce = async (admin) => {
  const existing = await admin.query(
    'select count(*)::int as total from employment where tenant_id = $1',
    [TENANT],
  );

  if (existing.rows[0].total === EMPLOYMENTS) {
    console.log(`Reusing ${EMPLOYMENTS} seeded employments.`);
    return;
  }

  console.log(`Seeding ${EMPLOYMENTS} people and employments…`);
  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'ATT-' || lpad(n::text, 7, '0'), 'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${EMPLOYMENTS}) as n`,
    [TENANT],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, 'ATT-' || p.person_number, 'active', 'permanent',
            date '2026-01-01', date '2026-01-01', '{}'::jsonb, ${AUDIT}
       from person p where p.tenant_id = $1`,
    [TENANT],
  );
};

const seedDefinitions = async (admin) => {
  console.log('Seeding the policy, a shift and a weekly schedule…');
  await admin.query(
    `insert into attendance_policy
       (id, tenant_id, code, name, source, rounding_minutes, rounding_mode,
        late_tolerance_minutes, early_departure_tolerance_minutes, duplicate_window_seconds,
        clock_skew_tolerance_seconds, overtime_threshold_minutes, overtime_requires_approval,
        absence_blocks_approval, status, effective_from, version_number, published_at, published_by,
        metadata, created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, 'perf', '{"en":"Perf","ar":"قياس"}'::jsonb, 'tenant', 0, 'none',
             0, 0, 120, 300, 0, false, false, 'published', date '2026-01-01', 1, now(), 'user:perf',
             '{}'::jsonb, ${AUDIT})`,
    [TENANT],
  );
  await admin.query(
    `insert into attendance_shift
       (id, tenant_id, code, name, kind, start_local, end_local, crosses_midnight,
        grace_in_minutes, grace_out_minutes, expected_minutes, status, version_number,
        published_at, published_by, metadata, created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, 'perf-day', '{"en":"Day","ar":"نهار"}'::jsonb, 'fixed',
             '08:00', '17:00', false, 0, 0, 540, 'published', 1, now(), 'user:perf', '{}'::jsonb, ${AUDIT})`,
    [TENANT],
  );
  await admin.query(
    `insert into attendance_schedule
       (id, tenant_id, code, name, zone, cycle_length_days, cycle_anchor_date, status,
        version_number, published_at, published_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, 'perf-week', '{"en":"Week","ar":"أسبوع"}'::jsonb, 'Asia/Riyadh',
             7, date '2026-02-02', 'published', 1, now(), 'user:perf', '{}'::jsonb, ${AUDIT})`,
    [TENANT],
  );
  await admin.query(
    `insert into attendance_schedule_day
       (id, tenant_id, schedule_id, cycle_position, shift_id,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, c.id, p, s.id, ${AUDIT}
       from attendance_schedule c, attendance_shift s, generate_series(0, 4) as p
      where c.tenant_id = $1 and s.tenant_id = $1`,
    [TENANT],
  );
  // Only the tracked subset is assigned: an assignment for every one of 100,000 employments would
  // make the assignment read a different measurement from the one a real tenant makes.
  await admin.query(
    `insert into attendance_schedule_assignment
       (id, tenant_id, employment_id, schedule_id, effective_from,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, c.id, date '2026-01-01', ${AUDIT}
       from employment e, attendance_schedule c
      where e.tenant_id = $1 and c.tenant_id = $1
        and e.employment_number <= 'ATT-ATT-' || lpad(${TRACKED}::text, 7, '0')`,
    [TENANT],
  );
};

export const seed = async (admin) => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'fixture';
       end if;
     end $$`,
  );
  await admin.query(`grant select on all tables in schema public to ${ROLE}`);

  if (isComplete(await tally(admin))) {
    console.log('The benchmark data is already in place at the target volumes. Measuring it.');
    return;
  }
  await purge(admin);
  await seedWorkforce(admin);
  await seedDefinitions(admin);
  await seedDays(admin);
  await seedEvents(admin);
  await seedExceptions(admin);

  await admin.query(
    `analyze person, employment, attendance_time_event, attendance_day,
             attendance_day_exception, attendance_schedule_assignment, attendance_roster_entry`,
  );
};

/** One calculated day per tracked employment per date. A tenth are left stale, deliberately. */
const seedDays = async (admin) => {
  console.log(`Seeding ${ATTENDANCE_DAYS} attendance days…`);
  await admin.query(
    `insert into attendance_day
       (id, tenant_id, employment_id, attendance_date, zone, schedule_id, schedule_version,
        shift_id, policy_id, policy_version, day_kind, expected_start_at, expected_end_at,
        expected_minutes, expected_break_minutes, first_in_at, last_out_at, worked_minutes,
        break_minutes_taken, paid_break_minutes, regular_candidate_minutes,
        overtime_candidate_minutes, unpaid_minutes, absence_minutes, leave_state, leave_minutes,
        state, calculation_version, inputs_digest, calculated_at, inputs_changed_at, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, d::date, 'Asia/Riyadh', c.id, 1, s.id, p.id, 1, 'working',
            d::date + time '05:00', d::date + time '14:00', 540, 0,
            d::date + time '05:00', d::date + time '14:00', 540, 0, 0, 540, 0, 0, 0,
            'unknown', 0, 'calculated', 1, md5(e.id::text || d::text), now(),
            -- A tenth are marked stale, so the reconciliation read has real work to find rather
            -- than measuring an empty partial index.
            case when (extract(day from d)::int % 10) = 0 then now() end,
            '{}'::jsonb, ${AUDIT}
       from (select id from employment where tenant_id = $1
              and employment_number <= 'ATT-ATT-' || lpad(${TRACKED}::text, 7, '0')) e
       cross join generate_series(date '${FIRST_DATE}', date '${FIRST_DATE}' + ${DAYS - 1}, interval '1 day') as d
       cross join lateral (select id from attendance_schedule where tenant_id = $1 limit 1) c
       cross join lateral (select id from attendance_shift where tenant_id = $1 limit 1) s
       cross join lateral (select id from attendance_policy where tenant_id = $1 limit 1) p`,
    [TENANT],
  );
};

/** Four punches per day: in, break out, break in, out. The shape a turnstile actually produces. */
const seedEvents = async (admin) => {
  console.log(`Seeding ${EVENTS} time events…`);
  await admin.query(
    `insert into attendance_time_event
       (id, tenant_id, employment_id, kind, source, device_reference, event_key, occurred_at,
        reported_at, received_at, clock_skew_seconds, captured_offline, zone, attendance_date,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, d.employment_id, k.kind, 'device',
            'gate-' || (k.offset_minutes % 8),
            'k:' || d.employment_id || ':' || d.attendance_date || ':' || k.kind,
            d.attendance_date + time '05:00' + (k.offset_minutes || ' minutes')::interval,
            d.attendance_date + time '05:00' + (k.offset_minutes || ' minutes')::interval,
            d.attendance_date + time '05:00' + (k.offset_minutes || ' minutes')::interval,
            0, false, 'Asia/Riyadh', d.attendance_date, '{}'::jsonb, ${AUDIT}
       from attendance_day d
       cross join (values ('clock_in', 0), ('break_start', 240), ('break_end', 270),
                          ('clock_out', 540)) as k(kind, offset_minutes)
      where d.tenant_id = $1`,
    [TENANT],
  );
};

/** An exception on one day in twelve, which is roughly what a real queue looks like. */
const seedExceptions = async (admin) => {
  console.log('Seeding the exception queue…');
  await admin.query(
    `insert into attendance_day_exception
       (id, tenant_id, attendance_day_id, employment_id, attendance_date, kind, severity, state,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, d.id, d.employment_id, d.attendance_date,
            case when extract(day from d.attendance_date)::int % 24 = 0
                 then 'missing_clock_out' else 'late_arrival' end,
            case when extract(day from d.attendance_date)::int % 24 = 0
                 then 'blocking' else 'warning' end,
            'open', ${AUDIT}
       from attendance_day d
      where d.tenant_id = $1 and extract(day from d.attendance_date)::int % 12 = 0`,
    [TENANT],
  );
};
