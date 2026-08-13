#!/usr/bin/env node
/**
 * Measures the **production** Learning implementation at the volumes Phase 14A names: 500, 10,000
 * and 100,000 employments.
 *
 * Real PostgreSQL, the real repositories, the real row mappers. Every measurement runs as an
 * **unprivileged role** under the same row-level security a request runs under, because a superuser
 * sees every row without consulting a policy and would hide exactly the cost RLS adds.
 *
 * **A second tenant is seeded at every tier**, holding the same volume. A benchmark against a
 * database containing one tenant measures a policy that never has to exclude anything, which is the
 * easy case and not the one production runs. The same run then asserts that neither tenant can see
 * the other's rows *or* the other's totals — a count computed without the tenant predicate
 * discloses how many training records exist elsewhere even when no row comes back.
 *
 * The reads measured are the ones the plan's §22 names, because an aggregate says a page took a
 * second and does not say which query to index:
 *
 * 1. **The compliance queue** — the highest-traffic read, and the one whose bound is applied in SQL
 *    rather than after the rows leave the database.
 * 2. **The overdue queue and the expiring-certificate queue** — the two derived answers, each asked
 *    against a stated day rather than read from a column (ADR-0070, ADR-0071).
 * 3. **Assignments, enrolments and certificates by employment** — the three directions a person's
 *    record is asked for.
 * 4. **The catalogue reads** — courses, one course's versions, paths, one path's steps, rules,
 *    instructors, and one enrolment's assessment results, each on its own index.
 * 5. **Recurrence lookups** — the last completion of one course by one person, and by many at once.
 *    The second is what stops reconciliation being one query per employment.
 * 6. **Reconciliation** — deliberately the slowest. A command somebody runs, not a page load, and
 *    nothing in this product runs it on a schedule.
 *
 * The figures this prints are the figures the Phase 14A final report carries, **including any that
 * miss their budget**. A benchmark whose failures are not reported is not a benchmark.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-learning-performance.mjs [--only=A|B|C] [--purge] [--plans]
 */

import { Pool } from 'pg';

import { InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import { postgresLearningStores } from '../packages/modules/learning/dist/index.js';
import { seedTenant } from './learning-benchmark-data.mjs';
import {
  assertExactMarks,
  assertIsolation,
  assertRoleUnprivileged,
  assertRowLevelSecurityForced,
  explain,
} from './learning-benchmark-audit.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated database.');
  process.exit(1);
}

const TENANT = '01930000-0000-7000-8000-0000000cf001';
const OTHER = '01930000-0000-7000-8000-0000000cf002';
const ROLE = 'learning_benchmark_role';

/** The day every derived answer is computed against. Stated, never taken from the wall clock. */
const AS_OF = '2026-08-12';

/**
 * The three tiers, and the budgets each read is held to.
 *
 * Inherited from Phase 13 unchanged, because the question a person is waiting on is the same one: a
 * queue read is a screen somebody opens every morning, a detail read is a page they navigated to,
 * and reconciliation is a command they asked for and will wait on.
 *
 * They do not relax as the data grows, except where the work genuinely does: a queue is a bounded
 * page whatever the tenant's size, so its budget stays flat, while reconciliation examines a
 * workforce and is allowed to scale with it.
 */
const DATASETS = [
  { key: 'A', employments: 500, budgetMs: { queue: 100, detail: 150, reconcile: 2_000 } },
  { key: 'B', employments: 10_000, budgetMs: { queue: 100, detail: 150, reconcile: 10_000 } },
  { key: 'C', employments: 100_000, budgetMs: { queue: 100, detail: 150, reconcile: 60_000 } },
];

const only = process.argv
  .find((argument) => argument.startsWith('--only='))
  ?.slice('--only='.length);
const purge = process.argv.includes('--purge');
const plans = process.argv.includes('--plans');

const elapsed = async (work) => {
  const started = process.hrtime.bigint();
  const value = await work();

  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};

const admin = new Pool({ connectionString: CONNECTION, max: 4, statement_timeout: 900_000 });

/** Most dependent first: a truncate in the wrong order fails on a foreign key. */
const TABLES = [
  'learning_certification',
  'learning_assessment_result',
  'learning_enrolment',
  'learning_assignment',
  'learning_mandatory_rule',
  'learning_path_step',
  'learning_path',
  'learning_assessment',
  'learning_course_version',
  'learning_course',
  'learning_course_category',
  'learning_instructor',
];

/**
 * The unprivileged role, created if absent.
 *
 * It owns nothing and holds no `BYPASSRLS`. A benchmark run as a superuser would measure a different
 * query plan from the one production uses — the policy predicate is part of the cost, and excluding
 * a second tenant's hundred thousand rows is work somebody pays for on every read.
 */
const applicationUrl = async () => {
  await admin.query(
    `do $$ begin
       if not exists (select 1 from pg_roles where rolname = '${ROLE}') then
         create role ${ROLE} login nosuperuser password 'benchmark';
       end if;
     end $$`,
  );
  await admin.query(`grant select, insert, update, delete on ${TABLES.join(', ')} to ${ROLE}`);

  const url = new URL(CONNECTION);

  url.username = ROLE;
  url.password = 'benchmark';
  return url.toString();
};

const truncate = async () => {
  // `truncate` rather than `delete`: the immutability triggers refuse a delete of a course version
  // or an assessment result, and a table-level truncate is not something a row trigger sees. This
  // is the established safe reset, not a way around the protection.
  await admin.query(`truncate ${TABLES.join(', ')}`);
};

const PAGE = { limit: 50, offset: 0 };

const run = async () => {
  const application = new Pool({
    connectionString: await applicationUrl(),
    max: 4,
    statement_timeout: 900_000,
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresLearningStores();
  const asTenant = (tenantId, work) =>
    runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:benchmark' }, () =>
      unitOfWork.execute(work),
    );

  await assertRoleUnprivileged(admin, ROLE);
  await assertRowLevelSecurityForced(admin, TABLES);

  for (const dataset of DATASETS) {
    if (only !== undefined && only !== dataset.key) continue;

    await truncate();
    const seeded = await elapsed(async () => {
      const mine = await seedTenant(admin, TENANT, dataset.employments);

      // The neighbour, at the same volume. Every read below pays the cost of excluding it.
      await seedTenant(admin, OTHER, dataset.employments);
      // `vacuum analyze`, not `analyze`. A freshly bulk-loaded table has statistics but an empty
      // **visibility map**, and without one PostgreSQL cannot answer a count from an index at all —
      // it fell back to a sequential scan of 200,000 rows here, which is not the plan a production
      // table gets after autovacuum has run. Measuring that would have reported a bottleneck this
      // module does not have. See the Phase 14A report, "Defects found and fixed".
      await admin.query('vacuum analyze');
      return mine;
    });

    report(dataset, seeded, await measure(stores, asTenant, seeded.value), await counts());
    await assertIsolation(stores, asTenant, OTHER, seeded.value);
    await assertExactMarks(stores, asTenant, TENANT, seeded.value);
    if (plans) await explain(application, TENANT, AS_OF, seeded.value);
  }

  await application.end();
  if (purge) await truncate();
  await admin.end();
};

/** The rows each tier actually holds, per tenant. Reported rather than described. */
const counts = async () => {
  const { rows } = await admin.query(
    TABLES.map(
      (table) =>
        `select '${table}' as name, count(*)::int as rows from ${table} where tenant_id = $1`,
    ).join(' union all '),
    [TENANT],
  );

  return rows;
};

/** Every read the plan's §22 names, each measured on its own. */
const measure = async (stores, asTenant, seeded) => {
  const { courses, paths, rules, people, enrolments } = seeded;
  const course = courses[0];
  const person = people[0];
  const enrolment = enrolments[0];
  const at = (work) => elapsed(() => asTenant(TENANT, work));

  return {
    ...(await catalogueReads(stores, at, course, paths, rules)),
    ...(await learnerReads(stores, at, person, enrolment, people)),
    ...(await reconciliationReads(stores, at, rules, people)),
  };
};

/**
 * What one page of reconciliation actually costs, in its three parts.
 *
 * **The lookup** — the last completion of the rule's course by each employment in the page, in
 * **one query**. One query per employment is the N+1 this contract exists to prevent, and Phase
 * 13's first benchmark miss was exactly that shape.
 *
 * **The generation** — 200 assignments written with `insert ... on conflict do nothing`. This is
 * the write half, and it is the one that grows with the workforce.
 *
 * **The replay** — the same 200 again. Every one is refused by the partial unique index, which is
 * ADR-0071's idempotency guarantee measured rather than described: a retried run creates nothing,
 * and it costs a little less than the run that created something.
 */
const reconciliationReads = async (stores, at, rules, people) => {
  // The **first** rule deliberately. Its cohort is the one the fixture actually enrols and
  // completes, so the lookup measures a query that finds rows rather than one that misses every
  // index probe — a benchmark of an empty result is a benchmark of nothing.
  const rule = rules[0];
  const window = people.slice(0, 200);
  const generate = (occurrence) => async (tx) => {
    let created = 0;

    for (const person of window) {
      const written = await stores.assignments.insertIfAbsent(tx, {
        assignmentId: uuidV7(),
        employmentId: person.employmentId,
        courseId: rule.courseId,
        source: 'mandatory_rule',
        mandatoryRuleId: rule.mandatoryRuleId,
        occurrenceKey: occurrence,
        status: 'assigned',
        dueOn: '2027-01-31',
        assignedAt: new Date(),
        assignedBy: 'user:benchmark',
        version: 1,
      });

      if (written) created += 1;
    }
    return created;
  };

  return {
    reconcileLookup: await at((tx) =>
      stores.enrolments.lastCompletionsOf(
        tx,
        window.map((each) => each.employmentId),
        rule.courseId,
      ),
    ),
    reconcileGenerate: await at(generate('2027-01-01')),
    reconcileReplay: await at(generate('2027-01-01')),
  };
};

const catalogueReads = async (stores, at, course, paths, rules) => ({
  courseList: await at((tx) => stores.courses.search(tx, { status: 'published' }, PAGE)),
  courseRead: await at((tx) => stores.courses.byId(tx, course.courseId)),
  courseVersions: await at((tx) => stores.versions.forCourse(tx, course.courseId)),
  assessmentDefinitions: await at((tx) => stores.assessments.forVersion(tx, course.current)),
  pathList: await at((tx) => stores.paths.all(tx, PAGE)),
  pathSteps: await at((tx) => stores.paths.stepsFor(tx, paths[0])),
  ruleList: await at((tx) => stores.rules.all(tx, true, PAGE)),
  instructorList: await at((tx) => stores.instructors.all(tx, true, PAGE)),
});

const learnerReads = async (stores, at, person, enrolment, people) => ({
  assignmentQueue: await at((tx) => stores.assignments.search(tx, { status: 'assigned' }, PAGE)),
  overdueQueue: await at((tx) =>
    stores.assignments.search(tx, { status: 'assigned', dueOnOrBefore: AS_OF }, PAGE),
  ),
  assignmentsByEmployment: await at((tx) =>
    stores.assignments.search(tx, { employmentId: person.employmentId }, PAGE),
  ),
  assignmentsScoped: await at((tx) =>
    stores.assignments.search(
      tx,
      { employmentIdsIn: people.slice(0, 50).map((each) => each.employmentId) },
      PAGE,
    ),
  ),
  enrolmentList: await at((tx) => stores.enrolments.search(tx, { status: 'completed' }, PAGE)),
  enrolmentsByEmployment: await at((tx) =>
    stores.enrolments.search(tx, { employmentId: enrolment.employmentId }, PAGE),
  ),
  enrolmentRead: await at((tx) => stores.enrolments.byId(tx, enrolment.enrolmentId)),
  assessmentResults: await at((tx) => stores.results.forEnrolment(tx, enrolment.enrolmentId)),
  certificationList: await at((tx) => stores.certifications.search(tx, { status: 'active' }, PAGE)),
  expiringQueue: await at((tx) =>
    stores.certifications.search(
      tx,
      { status: 'active', validUntilOnOrBefore: '2026-09-30' },
      PAGE,
    ),
  ),
  certificationsForEmployment: await at((tx) =>
    stores.certifications.forEmployment(tx, enrolment.employmentId),
  ),
  certificationForEnrolment: await at((tx) =>
    stores.certifications.forEnrolment(tx, enrolment.enrolmentId),
  ),
  lastCompletion: await at((tx) =>
    stores.enrolments.lastCompletionOf(tx, enrolment.employmentId, enrolment.rule.courseId),
  ),
});

const verdict = (ms, budget) => (ms <= budget ? 'within budget' : `MISSED (budget ${budget}ms)`);

const sizeOf = (value) => {
  if (value === undefined) return 0;
  if (Array.isArray(value)) return value.length;
  if (value instanceof Map) return value.size;
  return value.total ?? 1;
};

const report = (dataset, seeded, measured, rowCounts) => {
  const line = (name, result, budget) =>
    console.log(
      `  ${name.padEnd(32)} ${result.ms.toFixed(1).padStart(9)} ms  ` +
        `${String(sizeOf(result.value)).padStart(8)} rows  ` +
        (budget === undefined ? '' : verdict(result.ms, budget)),
    );
  const { queue, detail, reconcile } = dataset.budgetMs;

  console.log(
    `\nDataset ${dataset.key}: ${dataset.employments} employments per tenant, two tenants ` +
      `(seeded in ${(seeded.ms / 1000).toFixed(1)}s)`,
  );
  console.log(
    `  rows per tenant: ${rowCounts.map((row) => `${row.name.replace('learning_', '')}=${row.rows}`).join(', ')}`,
  );

  line('course list (published)', measured.courseList, queue);
  line('course read', measured.courseRead, detail);
  line('course versions', measured.courseVersions, detail);
  line('assessment definitions', measured.assessmentDefinitions, detail);
  line('path list', measured.pathList, queue);
  line('path steps', measured.pathSteps, detail);
  line('mandatory rule list', measured.ruleList, queue);
  line('instructor list', measured.instructorList, queue);
  line('compliance queue', measured.assignmentQueue, queue);
  line('overdue queue', measured.overdueQueue, queue);
  line('assignments by employment', measured.assignmentsByEmployment, queue);
  line('assignments, scope-bounded', measured.assignmentsScoped, queue);
  line('enrolment list (completed)', measured.enrolmentList, queue);
  line('enrolments by employment', measured.enrolmentsByEmployment, queue);
  line('enrolment read', measured.enrolmentRead, detail);
  line('assessment results', measured.assessmentResults, detail);
  line('certification list (active)', measured.certificationList, queue);
  line('expiring certificates', measured.expiringQueue, queue);
  line('certificates for employment', measured.certificationsForEmployment, detail);
  line('certificate for enrolment', measured.certificationForEnrolment, detail);
  line('last completion of a course', measured.lastCompletion, detail);
  line('reconciliation lookup (200)', measured.reconcileLookup, reconcile);
  line('reconciliation generate (200)', measured.reconcileGenerate, reconcile);
  line('reconciliation replay (200)', measured.reconcileReplay, reconcile);
};

await run();
