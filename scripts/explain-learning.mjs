#!/usr/bin/env node
/**
 * Query plans for Learning's critical reads.
 *
 * Not a benchmark — those are a later checkpoint. This answers a narrower question that has to be
 * answered before any benchmark is meaningful: does each query carry a tenant predicate, does it use
 * an index rather than scanning the table, and is it bounded?
 *
 * It seeds a modest but non-trivial dataset, because PostgreSQL will sequentially scan a table of
 * fifty rows whatever indexes exist, and a plan taken at that size would prove nothing either way.
 *
 * Usage: DATABASE_URL=... node scripts/explain-learning.mjs
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const CONNECTION = process.env.DATABASE_URL ?? process.env.TEST_DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set DATABASE_URL (or TEST_DATABASE_URL) to a migrated database.');
  process.exit(1);
}

/**
 * A fresh tenant every run.
 *
 * The alternative — deleting the previous run's rows — cannot work, and the reason is a feature: a
 * course version is insert-only, so its trigger refuses the delete and the foreign key then refuses
 * to remove the course. Seeding a new tenant instead leaves the earlier rows in place, which makes
 * the tables *larger* and the plans more realistic: a tenant predicate selecting a small slice of a
 * big table is exactly the shape production has.
 */
const TENANT = randomUUID();
const EMPLOYMENTS = 2000;
const COURSES = 40;

const pool = new pg.Pool({ connectionString: CONNECTION, statement_timeout: 120_000 });

const AUDIT = `'{}'::jsonb, now(), 'seed', now(), 'seed', 1`;
const AUDIT_COLUMNS = 'metadata, created_at, created_by, updated_at, updated_by, version';

const seed = async () => {
  const courses = [];
  const versions = [];

  for (let index = 0; index < COURSES; index += 1) {
    courses.push(randomUUID());
    versions.push(randomUUID());
  }

  await pool.query(
    `insert into learning_course (id, tenant_id, code, name, delivery, status,
                                  current_version_id, ${AUDIT_COLUMNS})
     select c.id, $1, 'course-' || c.ord, '{"en":"C","ar":"C"}'::jsonb, 'self_paced', 'published',
            v.id, ${AUDIT}
       from unnest($2::uuid[]) with ordinality as c(id, ord)
       join unnest($3::uuid[]) with ordinality as v(id, ord) on v.ord = c.ord`,
    [TENANT, courses, versions],
  );
  await pool.query(
    `insert into learning_course_version (id, tenant_id, course_id, version_number, title,
                                          requires_assessment, published_at, published_by,
                                          ${AUDIT_COLUMNS})
     select v.id, $1, c.id, 1, '{"en":"V","ar":"V"}'::jsonb, false, now(), 'seed', ${AUDIT}
       from unnest($2::uuid[]) with ordinality as c(id, ord)
       join unnest($3::uuid[]) with ordinality as v(id, ord) on v.ord = c.ord`,
    [TENANT, courses, versions],
  );

  const employments = Array.from({ length: EMPLOYMENTS }, () => randomUUID());
  const ruleId = randomUUID();

  await pool.query(
    `insert into learning_mandatory_rule (id, tenant_id, course_id, name, kind, audience,
                                          effective_from, recurrence_months, due_within_days,
                                          active, ${AUDIT_COLUMNS})
     values ($1, $2, $3, '{"en":"R","ar":"R"}'::jsonb, 'safety', 'everybody', date '2024-01-01',
             12, 30, true, ${AUDIT})`,
    [ruleId, TENANT, courses[0]],
  );

  // One assignment, one enrolment and one certification per employment, spread across the courses.
  await pool.query(
    `insert into learning_assignment (id, tenant_id, employment_id, course_id, source,
                                      mandatory_rule_id, occurrence_key, status, due_on,
                                      assigned_at, assigned_by, ${AUDIT_COLUMNS})
     select gen_random_uuid(), $1, e.id, $3, 'mandatory_rule', $4, date '2024-01-01', 'assigned',
            date '2024-01-31' + ((e.ord % 400)::int), now(), 'seed', ${AUDIT}
       from unnest($2::uuid[]) with ordinality as e(id, ord)`,
    [TENANT, employments, courses[0], ruleId],
  );
  await pool.query(
    `insert into learning_enrolment (id, tenant_id, employment_id, course_id, course_version_id,
                                     status, enrolled_at, enrolled_by, completed_at, completed_by,
                                     completed_on, ${AUDIT_COLUMNS})
     select gen_random_uuid(), $1, e.id, c.id, v.id, 'completed', now(), 'seed', now(), 'seed',
            date '2024-01-01' + ((e.ord % 700)::int), ${AUDIT}
       from unnest($2::uuid[]) with ordinality as e(id, ord)
       join unnest($3::uuid[]) with ordinality as c(id, ord) on c.ord = 1 + (e.ord % ${COURSES})
       join unnest($4::uuid[]) with ordinality as v(id, ord) on v.ord = c.ord`,
    [TENANT, employments, courses, versions],
  );
  await pool.query(
    `insert into learning_certification (id, tenant_id, employment_id, course_id, title, source,
                                         status, issued_on, valid_until, issued_by, ${AUDIT_COLUMNS})
     select gen_random_uuid(), $1, e.id, c.id, 'Licence', 'external', 'active',
            date '2025-01-01', date '2026-01-01' + ((e.ord % 900)::int), 'seed', ${AUDIT}
       from unnest($2::uuid[]) with ordinality as e(id, ord)
       join unnest($3::uuid[]) with ordinality as c(id, ord) on c.ord = 1 + (e.ord % ${COURSES})`,
    [TENANT, employments, courses],
  );

  await pool.query('analyze learning_assignment, learning_enrolment, learning_certification');
  return { courses, employments, ruleId };
};

const QUERIES = (world) => [
  {
    name: 'course catalogue listing',
    sql: `select c.id from learning_course c
            where c.tenant_id = $1 and c.deleted_at is null and c.status = $2
            order by c.code limit 50 offset 0`,
    parameters: [TENANT, 'published'],
  },
  {
    name: 'course version lookup',
    sql: `select id from learning_course_version
            where course_id = $1 and tenant_id = $2 and deleted_at is null
            order by version_number desc`,
    parameters: [world.courses[0], TENANT],
  },
  {
    name: 'learning path listing',
    sql: `select p.id from learning_path p
            where p.tenant_id = $1 and p.deleted_at is null order by p.code limit 50`,
    parameters: [TENANT],
  },
  {
    name: 'assignment listing for one employment',
    sql: `select a.id from learning_assignment a
            where a.tenant_id = $1 and a.deleted_at is null and a.employment_id = $2
            order by a.due_on nulls last, a.id limit 50`,
    parameters: [TENANT, world.employments[7]],
  },
  {
    name: 'overdue assignment queue',
    sql: `select a.id from learning_assignment a
            where a.tenant_id = $1 and a.deleted_at is null and a.status = 'assigned'
              and a.due_on <= $2
            order by a.due_on nulls last, a.id limit 50`,
    parameters: [TENANT, '2024-06-01'],
  },
  {
    name: 'enrolment listing for one employment',
    sql: `select e.id from learning_enrolment e
            where e.tenant_id = $1 and e.deleted_at is null and e.employment_id = $2
            order by e.enrolled_at desc, e.id desc limit 50`,
    parameters: [TENANT, world.employments[11]],
  },
  {
    name: 'last completions for a page of employments',
    sql: `select distinct on (employment_id) employment_id, completed_on
            from learning_enrolment
           where tenant_id = $1 and course_id = $2 and status = 'completed'
             and deleted_at is null and employment_id = any($3::uuid[])
           order by employment_id, completed_on desc`,
    parameters: [TENANT, world.courses[0], world.employments.slice(0, 200)],
  },
  {
    name: 'certification expiry queue',
    sql: `select c.id from learning_certification c
            where c.tenant_id = $1 and c.deleted_at is null and c.status = 'active'
              and c.valid_until <= $2
            order by c.valid_until nulls last, c.id limit 50`,
    parameters: [TENANT, '2026-06-01'],
  },
  {
    name: 'certifications for one employment',
    sql: `select c.id from learning_certification c
            where c.tenant_id = $1 and c.employment_id = $2 and c.deleted_at is null
            order by c.issued_on desc, c.id desc`,
    parameters: [TENANT, world.employments[3]],
  },
  {
    name: 'learning history — the manager-bounded read',
    sql: `select a.id from learning_assignment a
            where a.tenant_id = $1 and a.deleted_at is null
              and a.employment_id = any($2::uuid[])
            order by a.due_on nulls last, a.id limit 100`,
    parameters: [TENANT, world.employments.slice(0, 12)],
  },
];

const run = async () => {
  const world = await seed();
  const findings = [];

  for (const query of QUERIES(world)) {
    const explained = await pool.query(
      `explain (analyze, buffers, format json) ${query.sql}`,
      query.parameters,
    );
    const plan = explained.rows[0]['QUERY PLAN'][0];
    const text = JSON.stringify(plan.Plan);
    const scans = [
      ...text.matchAll(
        /"Node Type":"Seq Scan","Parallel Aware":\w+,"Relation Name":"(learning_[a-z_]+)"/g,
      ),
    ];

    findings.push({
      name: query.name,
      ms: Number(plan['Execution Time'].toFixed(1)),
      rows: plan.Plan['Actual Rows'],
      indexed:
        text.includes('Index Scan') || text.includes('Index Only Scan') || text.includes('Bitmap'),
      sequentialScans: scans.map((match) => match[1]),
      tenantPredicate: text.includes('tenant_id'),
    });
  }

  console.log('\nLearning query plans');
  console.log(`  scale: ${String(EMPLOYMENTS)} employments, ${String(COURSES)} courses\n`);
  for (const finding of findings) {
    const scan =
      finding.sequentialScans.length > 0 ? ` seq:${finding.sequentialScans.join(',')}` : '';
    const flag = finding.indexed && finding.tenantPredicate && finding.sequentialScans.length === 0;

    console.log(
      `  ${flag ? 'OK  ' : 'LOOK'} ${finding.name.padEnd(46)} ${String(finding.ms).padStart(7)} ms  ` +
        `rows=${String(finding.rows).padStart(4)}  index=${String(finding.indexed)}  ` +
        `tenant=${String(finding.tenantPredicate)}${scan}`,
    );
  }
  console.log('');
  await pool.end();
};

run().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
