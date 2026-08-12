#!/usr/bin/env node
/**
 * Measures the **production** Performance implementation at the volumes Phase 13 names: 500, 10,000
 * and 100,000 employments running a full annual cycle.
 *
 * Real PostgreSQL, the real repositories, the real row mappers. Every measurement runs as an
 * **unprivileged role** under the same row-level security a request runs under, because a superuser
 * sees every row without consulting a policy and would hide exactly the cost RLS adds.
 *
 * **A second tenant is seeded at every tier**, holding the same volume. A benchmark against a
 * database containing one tenant measures a policy that never has to exclude anything, which is the
 * easy case and not the one production runs.
 *
 * The reads measured are the ones the plan's §22 names, because an aggregate says a page took a
 * second and does not say which query to index:
 *
 * 1. **The manager review queue** — the highest-traffic read in the module, and the one whose bound
 *    is applied in SQL rather than after the rows leave the database.
 * 2. **Goals by employment** and **goals by cycle** — the two directions a goal list is asked for.
 * 3. **One review in full** — the detail read: assessments, items, working, panel, snapshot.
 * 4. **Competency assessment read**, **calibration queue**, **peer aggregation**, **nine-box**,
 *    **feedback** and **progress history** — each on its own index.
 * 5. **Reconciliation** — deliberately the slowest. A query somebody runs, not one on a page load.
 *
 * The figures this prints are the figures the Phase 13 final report carries, **including any that
 * miss their budget**. A benchmark whose failures are not reported is not a benchmark.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-performance.mjs [--only=A|B|C] [--purge] [--plans]
 */

import { Pool } from 'pg';

import { InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import { postgresPerformanceStores } from '../packages/modules/performance/dist/index.js';
import { seedTenant } from './measure-performance-seed.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated database.');
  process.exit(1);
}

const TENANT = '01930000-0000-7000-8000-0000000bf001';
const OTHER = '01930000-0000-7000-8000-0000000bf002';
const ROLE = 'performance_benchmark_role';

/**
 * The three tiers, and the budgets each read is held to.
 *
 * The budgets are what a person waiting at a screen will tolerate rather than what the machine
 * happens to manage. A manager opening their queue every morning has to be answered immediately; a
 * review detail is a page somebody navigated to; reconciliation is a report somebody asked for and
 * is allowed to take its time.
 *
 * They do not relax as the data grows, except where the work genuinely does: a queue is a bounded
 * page whatever the tenant's size, so its budget stays flat, while reconciliation scans a cycle and
 * is allowed to scale with it.
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
  'performance_review_snapshot',
  'performance_talent_placement',
  'performance_calibration_decision',
  'performance_calibration_session',
  'performance_review_component_score',
  'performance_assessment_item',
  'performance_assessment',
  'performance_reviewer_assignment',
  'performance_feedback',
  'performance_review',
  'performance_goal_progress',
  'performance_key_result',
  'performance_objective',
  'performance_goal',
  'performance_cycle',
  'performance_review_template_component',
  'performance_review_template',
  'performance_goal_category',
  'performance_competency_level',
  'performance_competency',
  'performance_competency_framework',
  'performance_rating_level',
  'performance_rating_scale',
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
  // `truncate` rather than `delete`: the immutability triggers refuse a delete of a snapshot, a
  // calibration decision or a progress entry, and a table-level truncate is not something a row
  // trigger sees. This is the established safe reset, not a way around the protection.
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
  const stores = postgresPerformanceStores();
  const asTenant = (tenantId, work) =>
    runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:benchmark' }, () =>
      unitOfWork.execute(work),
    );

  for (const dataset of DATASETS) {
    if (only !== undefined && only !== dataset.key) continue;

    await truncate();
    const seeded = await elapsed(async () => {
      const mine = await seedTenant(admin, TENANT, dataset.employments);

      // The neighbour, at the same volume. Every read below pays the cost of excluding it.
      await seedTenant(admin, OTHER, dataset.employments);
      await admin.query('analyze');
      return mine;
    });

    report(dataset, seeded, await measure(stores, asTenant, seeded.value));
    if (plans) await explain(application, seeded.value);
  }

  await application.end();
  if (purge) await truncate();
  await admin.end();
};

/** Every read the plan's §22 names, each measured on its own. */
const measure = async (stores, asTenant, seeded) => {
  const { cycleId, reviews, goals, managers } = seeded;
  const first = reviews[0];
  const at = (work) => elapsed(() => asTenant(TENANT, work));

  return {
    cycleList: await at((tx) => stores.cycles.all(tx, PAGE)),
    cycleRead: await at((tx) => stores.cycles.byId(tx, cycleId)),
    managerQueue: await at((tx) =>
      stores.reviews.search(tx, { cycleId, managerEmploymentId: managers[7] }, PAGE),
    ),
    reviewList: await at((tx) => stores.reviews.search(tx, { cycleId }, PAGE)),
    reviewDetail: await at((tx) => stores.reviews.byId(tx, first.reviewId)),
    assessments: await at((tx) => stores.assessments.forReview(tx, first.reviewId)),
    componentScores: await at((tx) => stores.componentScores.forReview(tx, first.reviewId)),
    panel: await at((tx) => stores.reviewers.forReview(tx, first.reviewId)),
    goalsByEmployment: await at((tx) =>
      stores.goals.search(tx, { employmentId: first.employmentId }, PAGE),
    ),
    goalsByCycle: await at((tx) => stores.goals.search(tx, { cycleId }, PAGE)),
    goalsScoped: await at((tx) =>
      stores.goals.search(
        tx,
        { cycleId, employmentIdsIn: reviews.slice(0, 50).map((r) => r.employmentId) },
        PAGE,
      ),
    ),
    progress: await at((tx) => stores.goalProgress.forGoal(tx, goals[0].goalId)),
    calibrationQueue: await at((tx) => stores.calibrationSessions.forCycle(tx, cycleId)),
    calibrationDecisions: await at((tx) =>
      stores.calibrationDecisions.forReview(tx, first.reviewId),
    ),
    talentMatrix: await at((tx) => stores.placements.forCycle(tx, cycleId)),
    feedback: await at((tx) =>
      stores.feedback.search(tx, { subjectEmploymentId: first.employmentId }, PAGE),
    ),
    reconciliation: await at((tx) => stores.reconciliation.findings(tx, cycleId)),
  };
};

/** The plans behind the four reads that decide whether this module scales. */
const explain = async (application, seeded) => {
  const client = await application.connect();

  await client.query(`select set_config('app.tenant_id', '${TENANT}', false)`);
  console.log('\n  Query plans (unprivileged role, RLS on):');

  for (const [name, sql] of [
    [
      'manager queue',
      `select * from performance_review where tenant_id = current_setting('app.tenant_id')::uuid
         and deleted_at is null and cycle_id = '${seeded.cycleId}'
         and manager_employment_id = '${seeded.managers[7]}'
       order by created_at desc limit 50`,
    ],
    [
      'queue count',
      `select count(*) from performance_review where tenant_id = current_setting('app.tenant_id')::uuid
         and deleted_at is null and manager_employment_id = '${seeded.managers[7]}'`,
    ],
    [
      'goals by employment',
      `select * from performance_goal where tenant_id = current_setting('app.tenant_id')::uuid
         and deleted_at is null and employment_id = '${seeded.reviews[0].employmentId}'
       order by due_date desc limit 50`,
    ],
    [
      'assessments for one review',
      `select * from performance_assessment where tenant_id = current_setting('app.tenant_id')::uuid
         and deleted_at is null and review_id = '${seeded.reviews[0].reviewId}'`,
    ],
  ]) {
    const { rows } = await client.query(`explain (analyze, costs off) ${sql}`);

    console.log(`\n  ${name}`);
    for (const row of rows) console.log(`    ${row['QUERY PLAN']}`);
  }
  client.release();
};

const verdict = (ms, budget) => (ms <= budget ? 'within budget' : `MISSED (budget ${budget}ms)`);

const sizeOf = (value) =>
  value === undefined ? 0 : Array.isArray(value) ? value.length : (value.total ?? 1);

const report = (dataset, seeded, measured) => {
  const line = (name, result, budget) =>
    console.log(
      `  ${name.padEnd(30)} ${result.ms.toFixed(1).padStart(9)} ms  ` +
        `${String(sizeOf(result.value)).padStart(8)} rows  ` +
        (budget === undefined ? '' : verdict(result.ms, budget)),
    );
  const { queue, detail, reconcile } = dataset.budgetMs;

  console.log(
    `\nDataset ${dataset.key}: ${dataset.employments} employments per tenant, two tenants ` +
      `(seeded in ${(seeded.ms / 1000).toFixed(1)}s)`,
  );
  line('cycle list', measured.cycleList, queue);
  line('cycle read', measured.cycleRead, detail);
  line('manager review queue', measured.managerQueue, queue);
  line('review list (cycle)', measured.reviewList, queue);
  line('review detail', measured.reviewDetail, detail);
  line('assessments for review', measured.assessments, detail);
  line('component scores', measured.componentScores, detail);
  line('reviewer panel', measured.panel, detail);
  line('goals by employment', measured.goalsByEmployment, queue);
  line('goals by cycle', measured.goalsByCycle, queue);
  line('goals, scope-bounded', measured.goalsScoped, queue);
  line('progress history', measured.progress, detail);
  line('calibration queue', measured.calibrationQueue, queue);
  line('calibration decisions', measured.calibrationDecisions, detail);
  line('nine-box population', measured.talentMatrix, reconcile);
  line('feedback by subject', measured.feedback, queue);
  line('reconciliation', measured.reconciliation, reconcile);
};

await run();
