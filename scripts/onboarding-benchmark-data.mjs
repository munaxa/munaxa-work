#!/usr/bin/env node
/**
 * The benchmark dataset for `measure-onboarding-performance.mjs`: what it seeds, and why it is kept.
 *
 * Apart from the measurement script because a file of this repository's is budgeted at 400 lines, and
 * because the two halves answer different questions — this one is about producing a realistic table,
 * the other about timing reads over it.
 */

export const TENANT = '01920000-0000-7000-8000-0000000dffff';
export const EMPLOYMENTS = 100_000;
export const PLANS = 250;
export const VERSIONS = 1_000;
export const INSTANCES = 20_000;
export const LIVE = 2_000;
export const TASKS = 400_000;
export const ROLE = 'onboarding_perf_app';

const AUDIT = "now(), 'perf', now(), 'perf', 1";

export const clean = async (admin) => {
  // One statement per table, most dependent first, and a vacuum after each of the two big ones.
  //
  // **This path is slow, and the reason is worth reading before anybody makes it the default.** Every
  // index that could support a foreign key into these tables leads with `tenant_id` —
  // `onboarding_task_event_task_idx` is `(tenant_id, task_id, occurred_at)`, and
  // `onboarding_task_instance_idx` is `(tenant_id, onboarding_id, sequence)` — so PostgreSQL cannot
  // use one to answer the FK check a *delete* triggers, which asks `task_id = $1` with no tenant. It
  // scans the child table once per deleted row, and `onboarding_task` references itself through
  // `depends_on_task_id`, so deleting 400,000 tasks means 400,000 scans of a 400,000-row table.
  //
  // The product never meets this: it soft-deletes, and every read filters on `tenant_id` first, which
  // is what these indexes are shaped for. It is recorded as debt because a future hard-delete path —
  // a tenant offboarding, a retention sweep — would.
  //
  // So this runs only when the benchmark data is missing or wrong, and a complete dataset is reused.
  console.log('Removing incomplete benchmark data. This is the slow path — see the note in this file.');
  for (const table of ['onboarding_task_event', 'onboarding_task']) {
    await admin.query(`delete from ${table} where tenant_id = '${TENANT}'`);
    await admin.query(`vacuum ${table}`);
  }
  for (const table of [
    'onboarding_instance',
    'onboarding_task_template',
    'onboarding_plan_version',
    'onboarding_plan',
  ]) {
    await admin.query(`delete from ${table} where tenant_id = '${TENANT}'`);
  }
  await admin.query('vacuum onboarding_instance');
};

export const purge = async (admin) => {
  await clean(admin);
  console.log('Purging the seeded workforce.');
  await admin.query(`delete from employment where tenant_id = '${TENANT}'`);
  await admin.query(`delete from person where tenant_id = '${TENANT}'`);
};

/** What is already here, so a rerun measures rather than rebuilds. */
export const tally = async (admin) => {
  const counted = await admin.query(
    `select (select count(*)::int from employment where tenant_id = $1) as employments,
            (select count(*)::int from onboarding_plan_version where tenant_id = $1) as versions,
            (select count(*)::int from onboarding_instance where tenant_id = $1) as instances,
            (select count(*)::int from onboarding_task where tenant_id = $1) as tasks`,
    [TENANT],
  );

  return counted.rows[0];
};

export const isComplete = (counts) =>
  counts.employments === EMPLOYMENTS &&
  counts.versions === VERSIONS &&
  counts.instances === INSTANCES &&
  counts.tasks === TASKS;

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
     select app_uuid_v7(), $1, 'PRF-' || lpad(n::text, 7, '0'), 'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${EMPLOYMENTS}) as n`,
    [TENANT],
  );
  await admin.query(
    `insert into employment
       (id, tenant_id, person_id, employment_number, status, employment_type_code,
        original_hire_date, start_date, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, 'PRF-' || p.person_number, 'active', 'permanent',
            date '2026-01-01' + ((row_number() over (order by p.person_number) % 240)::int),
            date '2026-01-01' + ((row_number() over (order by p.person_number) % 240)::int),
            '{}'::jsonb, ${AUDIT}
       from person p where p.tenant_id = $1`,
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

  console.log(`Seeding ${PLANS} plans and ${VERSIONS} versions…`);
  await admin.query(
    `insert into onboarding_plan
       (id, tenant_id, code, name, status, metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, 'plan-' || lpad(n::text, 4, '0'),
            jsonb_build_object('en', 'Plan ' || n, 'ar', 'خطة ' || n),
            'active', '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${PLANS}) as n`,
    [TENANT],
  );
  // Four versions per plan: the newest published, the rest superseded — the shape a customer that
  // has been revising a checklist for a year actually has.
  await admin.query(
    `insert into onboarding_plan_version
       (id, tenant_id, plan_id, version_number, status, published_at, published_by,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, p.id, v,
            case when v = ${VERSIONS / PLANS} then 'published' else 'superseded' end,
            now(), 'user:perf', ${AUDIT}
       from onboarding_plan p
       cross join generate_series(1, ${VERSIONS / PLANS}) as v
      where p.tenant_id = $1`,
    [TENANT],
  );

  console.log(`Seeding ${INSTANCES} onboardings (${LIVE} live)…`);
  await admin.query(
    `insert into onboarding_instance
       (id, tenant_id, employment_id, person_id, plan_id, plan_version_id, state,
        planned_start_on, employment_start_on, completed_on, completed_at, completed_by,
        metadata, created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, e.id, e.person_id, v.plan_id, v.id,
            case when n <= ${LIVE} then 'in_progress' else 'completed' end,
            e.start_date, e.start_date,
            case when n <= ${LIVE} then null else e.start_date end,
            case when n <= ${LIVE} then null else now() end,
            case when n <= ${LIVE} then null else 'user:perf' end,
            '{}'::jsonb, ${AUDIT}
       from generate_series(1, ${INSTANCES}) as n
       join lateral (select id, person_id, start_date from employment
                      where tenant_id = $1 and employment_number = 'PRF-PRF-' || lpad(n::text, 7, '0')) e on true
       join lateral (select id, plan_id from onboarding_plan_version
                      where tenant_id = $1 and status = 'published'
                      order by id limit 1 offset (n % ${PLANS})) v on true`,
    [TENANT],
  );

  console.log(`Seeding ${TASKS} tasks…`);
  // Twenty tasks per onboarding. Half required, a fifth owned by a role queue, and a spread of due
  // dates around today so the overdue predicate has real work to do rather than matching everything
  // or nothing.
  await admin.query(
    `insert into onboarding_task
       (id, tenant_id, onboarding_id, template_code, sequence, title, kind, owner_kind, owner_ref,
        owner_role, required, status, due_on, completed_at, completed_by, metadata,
        created_at, created_by, updated_at, updated_by, version)
     select app_uuid_v7(), $1, planned.onboarding_id, 'task-' || planned.s, planned.s,
            jsonb_build_object('en', 'Task ' || planned.s, 'ar', 'مهمة ' || planned.s),
            'checklist', planned.owner_kind, planned.owner_ref, planned.owner_role,
            planned.s % 2 = 0, planned.status, planned.due_on,
            -- A done task names its completer, because the check constraint says so. Set in the
            -- same statement rather than patched afterwards: a benchmark that had to disable a
            -- constraint would be measuring a table the product cannot produce.
            case when planned.status = 'done' then now() end,
            case when planned.status = 'done' then 'user:perf' end,
            '{}'::jsonb, ${AUDIT}
       from (select o.id as onboarding_id, s,
                    case when s % 5 = 0 then 'role' else 'employment' end as owner_kind,
                    case when s % 5 = 0 then null else o.employment_id end as owner_ref,
                    case when s % 5 = 0 then 'it' else null end as owner_role,
                    case when o.state = 'completed' or s % 3 = 0 then 'done' else 'pending' end as status,
                    o.planned_start_on + (s - 10) as due_on
               from onboarding_instance o
               cross join generate_series(1, ${TASKS / INSTANCES}) as s
              where o.tenant_id = $1) as planned`,
    [TENANT],
  );

  await admin.query(
    'analyze person, employment, onboarding_plan, onboarding_plan_version, onboarding_instance, onboarding_task',
  );
};

