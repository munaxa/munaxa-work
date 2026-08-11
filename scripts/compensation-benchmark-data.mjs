/**
 * The dataset Phase 10's performance section names, seeded once and reused.
 *
 * 100,000 employments; 60,000 of them with compensation; eight components each and six changes
 * each over three years — about 2.9 million recurring rows; 500,000 one-time items; 3 million
 * history rows; 400 components and 200 grades with 600 steps.
 *
 * Seeded with `generate_series` rather than through the API, deliberately. Three million rows
 * through the HTTP edge would take hours and would measure the edge; what is being measured here is
 * the *read* paths against realistic volumes, and the rows a real write produces are the same rows.
 *
 * Two properties of the seed matter, and the second is the Phase 9 lesson:
 *
 * - **Effective periods are half-open and never overlap.** A seed that violated the exclusion
 *   constraint would not load at all, so the data is necessarily the shape the product produces.
 * - **`recorded_at` and `effective_from` vary per row.** Phase 9's first benchmark gave every row
 *   one timestamp, which made a `order by ... desc` degenerate and produced a number that looked
 *   like a missing index. A benchmark whose seed makes a query degenerate is a benchmark to fix.
 */

export const TENANT = '01930000-0000-7000-8000-00000000bbbb';
export const ROLE = 'compensation_perf';
export const PLAN_ID = '01930000-0000-7000-8000-0000000c1a11';

/** The scale the phase names. Lowered only by `SCALE`, and the report says when it was. */
export const EMPLOYMENTS = Number(process.env.COMPENSATION_EMPLOYMENTS ?? 100_000);
export const PAID = Number(process.env.COMPENSATION_PAID ?? 60_000);
export const COMPONENTS = Number(process.env.COMPENSATION_COMPONENTS ?? 400);
export const ASSIGNED_COMPONENTS = 8;
export const CHANGES_EACH = 6;
export const GRADES = 200;
export const STEPS = 600;
export const ONE_TIME = Number(process.env.COMPENSATION_ONE_TIME ?? 500_000);

export const PERIOD_START = '2026-06-01';
export const PERIOD_END = '2026-06-30';
export const AS_OF_PAST = '2024-07-01';

const AUDIT = `now(), 'perf', now(), 'perf', 1`;

/** Counts, so a re-run can reuse a dataset rather than seeding three million rows again. */
export const tally = async (client) => {
  const counted = await client.query(
    `select
       (select count(*) from employment where tenant_id = $1)::bigint as employments,
       (select count(*) from compensation_recurring where tenant_id = $1)::bigint as recurring,
       (select count(*) from compensation_one_time where tenant_id = $1)::bigint as one_time,
       (select count(*) from compensation_change where tenant_id = $1)::bigint as changes,
       (select count(*) from compensation_component where tenant_id = $1)::bigint as components`,
    [TENANT],
  );
  const row = counted.rows[0];

  return {
    employments: Number(row.employments),
    recurring: Number(row.recurring),
    oneTime: Number(row.one_time),
    changes: Number(row.changes),
    components: Number(row.components),
  };
};

export const purge = async (client) => {
  for (const table of [
    'compensation_change',
    'compensation_approval_decision',
    'compensation_adjustment',
    'compensation_one_time',
    'compensation_recurring',
    'compensation_import_batch',
    'compensation_plan_component',
    'compensation_plan_assignment',
    'compensation_salary_step',
    'compensation_pay_scale',
    'compensation_pay_grade',
    'compensation_salary_structure',
    'compensation_component',
    'compensation_plan',
  ]) {
    await client.query(`delete from ${table} where tenant_id = $1`, [TENANT]);
  }
  await client.query(`delete from employment where tenant_id = $1`, [TENANT]);
  await client.query(`delete from person where tenant_id = $1`, [TENANT]);
};

const seedPeople = async (client) => {
  await client.query(
    `insert into person (id, tenant_id, person_number, status, metadata,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'PERF-' || n, 'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, $2) as n`,
    [TENANT, EMPLOYMENTS],
  );
  await client.query(
    `insert into employment (id, tenant_id, person_id, employment_number, status,
       employment_type_code, original_hire_date, start_date, metadata,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, 'PERF-' || row_number() over (order by p.id), 'active',
            'permanent', date '2020-01-01', date '2020-01-01', '{}'::jsonb, ${AUDIT}
       from person p where p.tenant_id = $1`,
    [TENANT],
  );
};

const seedCatalogue = async (client) => {
  await client.query(
    `insert into compensation_plan (id, tenant_id, code, name, version_number, status,
       default_currency_code, default_currency_exponent, approval_required, approvals_required,
       self_approval_permitted, metadata, created_at, created_by, updated_at, updated_by, version)
     values ($2, $1, 'perf', '{"en":"Perf","ar":"أداء"}'::jsonb, 1, 'published',
             'JOD', 3, false, 0, false, '{}'::jsonb, ${AUDIT})`,
    [TENANT, PLAN_ID],
  );
  await client.query(
    `insert into compensation_plan_assignment (id, tenant_id, compensation_plan_id, scope,
       effective_from, created_at, created_by, updated_at, updated_by, version)
     values (app_uuid_v7(), $1, $2, 'tenant', date '2020-01-01', ${AUDIT})`,
    [TENANT, PLAN_ID],
  );
  await client.query(
    `insert into compensation_component (id, tenant_id, code, name, kind, calculation_basis,
       rounding_mode, recurrence, payroll_treatment_code, proratable, status, version_number,
       metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'perf-' || n, ('{"en":"C' || n || '","ar":"C' || n || '"}')::jsonb,
            case when n % 8 = 0 then 'one_time' else 'allowance' end, 'fixed_amount',
            'half-up', case when n % 8 = 0 then 'one_time' else 'recurring' end,
            'ordinary', true, 'published', 1, '{}'::jsonb, ${AUDIT}
       from generate_series(1, $2) as n`,
    [TENANT, COMPONENTS],
  );
  await client.query(
    `insert into compensation_pay_grade (id, tenant_id, code, name, minimum_minor, midpoint_minor,
       maximum_minor, currency_code, currency_exponent, status, effective_from, metadata,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'g-' || n, ('{"en":"G' || n || '","ar":"G' || n || '"}')::jsonb,
            500000, 750000, 1000000, 'JOD', 3, 'published', date '2020-01-01', '{}'::jsonb, ${AUDIT}
       from generate_series(1, $2) as n`,
    [TENANT, GRADES],
  );
  await client.query(
    `insert into compensation_salary_step (id, tenant_id, pay_grade_id, step_number, amount_minor,
       currency_code, currency_exponent, effective_from, metadata,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, g.id, s.n, 500000 + s.n * 50000, 'JOD', 3, date '2020-01-01',
            '{}'::jsonb, ${AUDIT}
       from (select id, row_number() over (order by id) as r
               from compensation_pay_grade where tenant_id = $1) g
       cross join generate_series(1, 3) as s(n)
      where g.r <= $2`,
    [TENANT, Math.ceil(STEPS / 3)],
  );
};

/**
 * The recurring rows: eight components per paid employment, six periods each.
 *
 * The periods are consecutive half-year windows so they never overlap — which is not a convenience,
 * it is the only shape the exclusion constraint permits, so the seed cannot produce data the
 * product could not.
 */
const seedRecurring = async (client) => {
  await client.query(
    `insert into compensation_recurring (id, tenant_id, employment_id, component_id,
       compensation_plan_id, amount_minor, currency_code, currency_exponent,
       effective_from, effective_to, recorded_at, recorded_by, source, approval_state,
       metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, c.id, $2,
            500000 + (e.r * 37 + c.r * 11 + p.n) % 500000,
            'JOD', 3,
            date '2023-01-01' + (p.n - 1) * interval '6 months',
            case when p.n = $5 then null
                 else date '2023-01-01' + p.n * interval '6 months' end,
            -- Varied per row: a single timestamp made Phase 9's ordered read degenerate.
            timestamptz '2023-01-01 00:00:00Z' + ((e.r * 7 + p.n) % 900) * interval '1 day',
            'perf', 'manual', 'not_required', '{}'::jsonb, ${AUDIT}
       from (select id, row_number() over (order by id) as r
               from employment where tenant_id = $1) e
       cross join (select id, row_number() over (order by id) as r
                     from compensation_component
                    where tenant_id = $1 and recurrence = 'recurring' limit $4) c
       cross join generate_series(1, $5) as p(n)
      where e.r <= $3`,
    [TENANT, PLAN_ID, PAID, ASSIGNED_COMPONENTS, CHANGES_EACH],
  );
};

const seedOneTime = async (client) => {
  await client.query(
    `insert into compensation_one_time (id, tenant_id, employment_id, component_id,
       compensation_plan_id, amount_minor, currency_code, currency_exponent, payable_on,
       reason_code, source, recorded_at, recorded_by, approval_state, metadata,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, c.id, $2, 100000 + (e.r * 13) % 400000, 'JOD', 3,
            date '2026-01-01' + ((e.r * 5 + c.r) % 365) * interval '1 day',
            'annual-bonus', 'manual',
            timestamptz '2026-01-01 00:00:00Z' + (e.r % 300) * interval '1 day',
            'perf', 'not_required', '{}'::jsonb, ${AUDIT}
       from (select id, row_number() over (order by id) as r
               from employment where tenant_id = $1) e
       cross join (select id, row_number() over (order by id) as r
                     from compensation_component
                    where tenant_id = $1 and recurrence = 'one_time' limit $4) c
      where e.r <= $3`,
    // Five one-time components across every employment: 100,000 x 5 reaches the 500,000 the phase
    // names. Bounding by employment alone would have capped at the number of employments, which is
    // the mistake the first run of this benchmark made.
    [TENANT, PLAN_ID, EMPLOYMENTS, Math.ceil(ONE_TIME / EMPLOYMENTS)],
  );
};

/** The history rows. One per recurring period, which is what the product actually writes. */
const seedHistory = async (client) => {
  await client.query(
    `insert into compensation_change (id, tenant_id, employment_id, component_id, subject_kind,
       subject_id, change_kind, effective_from, recorded_at, actor, source,
       created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, r.employment_id, r.component_id, 'recurring', r.id,
            case when r.effective_to is null then 'assigned' else 'amended' end,
            r.effective_from, r.recorded_at, 'perf', 'manual', ${AUDIT}
       from compensation_recurring r where r.tenant_id = $1`,
    [TENANT],
  );
};

export const seed = async (client) => {
  console.log('Seeding people and employments…');
  await seedPeople(client);
  console.log('Seeding the catalogue…');
  await seedCatalogue(client);
  console.log('Seeding recurring compensation (this is the large one)…');
  await seedRecurring(client);
  console.log('Seeding one-time compensation…');
  await seedOneTime(client);
  console.log('Seeding history…');
  await seedHistory(client);
  console.log('Analysing…');
  await client.query('analyze compensation_recurring, compensation_one_time, compensation_change');
};
