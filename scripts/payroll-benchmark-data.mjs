/**
 * The dataset the payroll benchmark measures against, and the role it measures as.
 *
 * Three sizes, because the interesting question is not "is it fast" but "does it stay linear". A
 * payroll that is fine at 500 and quadratic at 100,000 looks identical in a single measurement.
 *
 * Seeding is bulk `insert ... select generate_series`, not a loop of statements — a hundred
 * thousand people and their employments is 200,000 rows, and inserting them one at a time would
 * make the fixture slower than everything it exists to measure.
 *
 * The role is unprivileged and owns nothing. A superuser sees every row without consulting a
 * policy, so a benchmark run as one measures a query the product never issues and hides exactly the
 * cost row-level security adds.
 */

export const TENANT = '01930000-0000-7000-8000-0000000b1111';
export const ROLE = 'payroll_perf';
export const LEGAL_ENTITY = '01930000-0000-7000-8000-0000000b2222';

export const PERIOD_START = '2026-06-01';
export const PERIOD_END = '2026-06-30';
export const PAYMENT_DATE = '2026-07-05';

/** The three datasets §14 names. */
export const DATASETS = [
  { name: 'A', employees: 500 },
  { name: 'B', employees: 10_000 },
  { name: 'C', employees: 100_000 },
];

/** Payroll's own tables, most dependent first. */
export const PAYROLL_TABLES = [
  'payroll_payment_instruction',
  'payroll_accounting_line',
  'payroll_reconciliation',
  'payroll_approval_decision',
  'payroll_adjustment',
  'payroll_exception',
  'payroll_deduction_line',
  'payroll_earning_line',
  'payroll_result',
  'payroll_input_snapshot',
  'payroll_run',
  'payroll_period',
  'payroll_deduction_definition',
  'payroll_group',
];

const AUDIT = `now(), 'benchmark', now(), 'benchmark', 1`;

export const ensureRole = async (admin) => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'perf';
       end if;
     end $$`,
  );
  await admin.query(
    `grant select, insert, update, delete on ${[...PAYROLL_TABLES, 'person', 'employment'].join(', ')} to ${ROLE}`,
  );
};

export const applicationUrl = (connection) => {
  const url = new URL(connection);

  url.username = ROLE;
  url.password = 'perf';
  return url.toString();
};

/**
 * Resets Payroll's own tables between datasets.
 *
 * `truncate` rather than `delete`, for a reason worth stating: the finalized-immutability trigger
 * refuses a `delete` of any row a finalized run owns (ADR-0066), which is precisely what it is for
 * — the first attempt at this teardown failed with `payroll_finalized_immutable`, and that failure
 * is the guarantee working. `truncate` is a table-level operation that row triggers do not see, so
 * it resets the fixture **without disabling anything**. Nothing here weakens the production rule,
 * and no code path in the product truncates a payroll table.
 *
 * This requires a database dedicated to benchmarking, which is what `work_perf` is.
 */
export const resetPayroll = async (admin) => {
  await admin.query(`truncate ${PAYROLL_TABLES.join(', ')} cascade`);
};

/**
 * Removes the people this benchmark created. **Slow, and only on `--purge`.**
 *
 * `employment` is referenced by every module that has run a benchmark against this database, and
 * PostgreSQL checks each of those foreign keys per deleted row. Doing it between datasets took over
 * twelve minutes for ten thousand rows and produced no measurement — which is why the datasets now
 * share one seeded population instead.
 */
export const purge = async (admin) => {
  await resetPayroll(admin);
  await admin.query(`delete from employment where tenant_id = $1`, [TENANT]);
  await admin.query(`delete from person where tenant_id = $1`, [TENANT]);
};

/**
 * Seeds up to `employees` people and employments, **once**, and reuses them.
 *
 * The three datasets slice the same population rather than each reseeding their own. Reseeding
 * meant deleting the previous one, and deleting employment rows is dominated by other modules'
 * foreign-key checks rather than by anything Payroll does — twelve minutes of teardown around
 * twenty seconds of measurement.
 *
 * `app_uuid_v7()` is the same generator the schema defaults to, so the identifiers sort the way the
 * cursor expects — a benchmark seeded with random v4 identifiers would page in an order production
 * never sees, and would hide whether the cursor's index is being used.
 */
export const seed = async (admin, employees) => {
  const held = (await tally(admin)).employments;

  if (held >= employees) return held;

  const missing = employees - held;

  await admin.query(
    `insert into person
       (id, tenant_id, person_number, status, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'PERF-' || lpad((n + $3)::text, 8, '0'), 'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, $2) as n`,
    [TENANT, missing, held],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, 'PERF-' || p.person_number, 'active', 'permanent',
            date '2020-01-01', date '2020-01-01', '{}'::jsonb, ${AUDIT}
       from person p
      where p.tenant_id = $1
        and not exists (select 1 from employment e where e.person_id = p.id)`,
    [TENANT],
  );
  return (await tally(admin)).employments;
};

export const tally = async (admin) => {
  const counted = await admin.query(
    `select (select count(*) from employment where tenant_id = $1) as employments,
            (select count(*) from payroll_result where tenant_id = $1) as results`,
    [TENANT],
  );

  return {
    employments: Number(counted.rows[0].employments),
    results: Number(counted.rows[0].results),
  };
};

/** Every employment this tenant owns, sorted the way the cursor pages them. */
export const employmentIds = async (admin) => {
  const rows = await admin.query(
    `select id from employment where tenant_id = $1 and deleted_at is null order by id`,
    [TENANT],
  );

  return rows.rows.map((row) => row.id);
};
