#!/usr/bin/env node
/**
 * Measures the **production** Career implementation at the volumes the Phase 15 plan's §19 names:
 * 500, 10,000 and 100,000 employments.
 *
 * Real PostgreSQL, the real repositories, the real row mappers. Every measurement runs as an
 * **unprivileged role** under the same row-level security a request runs under, because a superuser
 * sees every row without consulting a policy and would hide exactly the cost RLS adds.
 *
 * **A second tenant is seeded at every tier**, holding the same volume. A benchmark against a
 * database containing one tenant measures a policy that never has to exclude anything, which is the
 * easy case and not the one production runs. The same run then asserts that neither tenant can see
 * the other's rows *or* the other's totals — a count computed without the tenant predicate discloses
 * how many people sit on a succession bench elsewhere even when no row comes back, and in this
 * module that number is itself the sensitive fact.
 *
 * The reads measured are the ones the plan's §19 names, because an aggregate says a page took a
 * second and does not say which query to index:
 *
 * 1. **The succession queue** — the highest-traffic read, and the one whose bound is applied in SQL
 *    rather than after the rows leave the database. Measured with and without the review-due filter,
 *    because the second is a derived answer against a stated day (D-16) rather than a stored flag.
 * 2. **Successors for one plan, and bench strength for one plan** — the two shapes the plan flags as
 *    suspect. Bench strength is measured **across four hundred positions in sequence** as well as
 *    once, because an O(n×m) shape is invisible in a single call.
 * 3. **The pool reads** — the listing and the as-of question, which is the read a succession review
 *    actually makes.
 * 4. **Career plans by path, development plans by employment, development items due by a day, and
 *    the recommendation listing** — one per remaining aggregate.
 * 5. **The career summary** — six store reads composed, the shape ADR-0008 says is derived on read
 *    rather than maintained.
 * 6. **The cohort reads** — every filter's `employmentIdsIn`, over two hundred employments in one
 *    query each. This is the bounded shape §16 calls reconciliation: one query for a cohort, never
 *    one query per person.
 *
 * The figures this prints are the figures the Checkpoint 9 report carries, **including any that miss
 * their budget**. A benchmark whose failures are not reported is not a benchmark.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-career-performance.mjs [--only=A|B|C] [--purge] [--plans]
 */

import { Pool } from 'pg';

import { InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import { postgresCareerStores } from '../packages/modules/career/dist/index.js';
import { seedTenant } from './career-benchmark-data.mjs';
import { report } from './career-benchmark-report.mjs';
import {
  assertExactValues,
  assertIsolation,
  assertNoCrossModuleForeignKeys,
  assertRoleUnprivileged,
  assertRowLevelSecurityForced,
  explain,
} from './career-benchmark-audit.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated database.');
  process.exit(1);
}

const TENANT = '01930000-0000-7000-8000-0000000df001';
const OTHER = '01930000-0000-7000-8000-0000000df002';
const ROLE = 'career_benchmark_role';

/** The day every derived answer is computed against. Stated, never taken from the wall clock. */
const AS_OF = '2026-08-14';

/**
 * The three tiers, and the budgets each read is held to.
 *
 * Inherited from Phase 13 and Phase 14A **unchanged**, because the question a person is waiting on
 * is the same one: a queue read is a screen somebody opens every morning, a detail read is a page
 * they navigated to, and a cohort read is a question they asked and will wait on.
 *
 * They do not relax as the data grows, except where the work genuinely does: a queue is a bounded
 * page whatever the tenant's size, so its budget stays flat, while a cohort read examines a slice of
 * a workforce and is allowed to scale with it.
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
  'career_development_item',
  'career_development_plan',
  'career_mobility_recommendation',
  'career_readiness_assessment',
  'career_successor',
  'career_succession_plan',
  'career_readiness_level',
  'career_pool_membership',
  'career_talent_pool',
  'career_plan',
  'career_stage',
  'career_path',
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
  // `truncate` rather than `delete`: the immutability trigger refuses a delete of a readiness
  // assessment, and a table-level truncate is not something a row trigger sees. This is the
  // established safe reset, not a way around the protection.
  await admin.query(`truncate ${TABLES.join(', ')}`);
};

const PAGE = { limit: 50, offset: 0 };
/** The cohort a bounded question is asked about. Two hundred people, one query. */
const COHORT = 200;

const run = async () => {
  const application = new Pool({
    connectionString: await applicationUrl(),
    max: 4,
    statement_timeout: 900_000,
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresCareerStores();
  const asTenant = (tenantId, work) =>
    runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:benchmark' }, () =>
      unitOfWork.execute(work),
    );

  await assertRoleUnprivileged(admin, ROLE);
  await assertRowLevelSecurityForced(admin, TABLES);
  await assertNoCrossModuleForeignKeys(admin, TABLES);

  for (const dataset of DATASETS) {
    if (only !== undefined && only !== dataset.key) continue;

    await truncate();
    const seeded = await elapsed(async () => {
      const mine = await seedTenant(admin, TENANT, dataset.employments);

      // The neighbour, at the same volume. Every read below pays the cost of excluding it.
      await seedTenant(admin, OTHER, dataset.employments);
      // `vacuum analyze`, not `analyze`. A freshly bulk-loaded table has statistics but an empty
      // **visibility map**, and without one PostgreSQL cannot answer a count from an index at all.
      // Phase 14A measured a bottleneck that did not exist because of this; recorded there, and not
      // repeated here.
      await admin.query('vacuum analyze');
      return mine;
    });

    report(dataset, seeded, await measure(stores, asTenant, seeded.value), await counts());
    await assertIsolation(stores, asTenant, OTHER, seeded.value);
    await assertExactValues(stores, asTenant, TENANT, seeded.value);
    if (plans) await explain(asTenant, stores, TENANT, AS_OF, seeded.value);
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

const measure = async (stores, asTenant, seeded) => {
  const at = (work) => elapsed(() => asTenant(TENANT, work));

  return {
    ...(await configurationReads(stores, at, seeded)),
    ...(await successionReads(stores, at, seeded)),
    ...(await personReads(stores, at, seeded)),
    ...(await cohortReads(stores, at, seeded)),
  };
};

const configurationReads = async (stores, at, seeded) => ({
  pathList: await at((tx) => stores.paths.search(tx, { status: 'published' }, PAGE)),
  pathStages: await at((tx) => stores.paths.stagesFor(tx, seeded.paths[2].pathId)),
  poolList: await at((tx) => stores.pools.all(tx, 'active', PAGE)),
  levelList: await at((tx) => stores.readinessLevels.all(tx, true)),
  plansByPath: await at((tx) => stores.plans.search(tx, { pathId: seeded.paths[2].pathId }, PAGE)),
  membershipList: await at((tx) =>
    stores.memberships.search(tx, { talentPoolId: seeded.pools[1].talentPoolId }, PAGE),
  ),
  membershipAsOf: await at((tx) => stores.memberships.search(tx, { inForceOn: AS_OF }, PAGE)),
});

/**
 * The succession reads, including the two shapes the plan flags as suspect.
 *
 * `benchAcrossPositions` is the O(n×m) watch: forty benches counted one after another, which is what
 * a screen showing bench strength for a page of positions would cost. Measured as a whole rather
 * than divided, because the question is whether the total grows with the tenant.
 */
const successionReads = async (stores, at, seeded) => {
  const active = seeded.succession.filter((plan) => plan.status === 'active');
  const first = active[0].successionPlanId;
  const page = active.slice(0, 40);

  return {
    successionList: await at((tx) => stores.successionPlans.search(tx, { status: 'active' }, PAGE)),
    successionReviewDue: await at((tx) =>
      stores.successionPlans.search(tx, { status: 'active', reviewOnOrBefore: AS_OF }, PAGE),
    ),
    successionRead: await at((tx) => stores.successionPlans.byId(tx, first)),
    successorsForPlan: await at((tx) => stores.successors.forPlan(tx, first)),
    benchStrength: await at((tx) => stores.successors.benchCountsOf(tx, first)),
    benchAcrossPositions: await at(async (tx) => {
      const counted = [];

      for (const plan of page) {
        counted.push(await stores.successors.benchCountsOf(tx, plan.successionPlanId));
      }
      return counted;
    }),
  };
};

/**
 * One person's record, and the summary composed from six of these reads.
 *
 * The summary is measured as the handler composes it — `activeFor`, the open memberships, the open
 * nominations, the history, the active development plan and the open recommendations — because that
 * is what `career.read-summary` costs. Measuring one of the six would report a sixth of the answer.
 */
const personReads = async (stores, at, seeded) => {
  const person = seeded.successors[0].employmentId;
  const developmentPlan = seeded.people.find((_, index) => index % 10 === 0);
  const bounded = { limit: 20, offset: 0 };

  return {
    plansByEmployment: await at((tx) => stores.plans.search(tx, { employmentId: person }, PAGE)),
    readinessHistory: await at((tx) => stores.assessments.historyFor(tx, person)),
    readinessByLevel: await at((tx) =>
      stores.assessments.search(tx, { readinessLevelId: seeded.levels[0].readinessLevelId }, PAGE),
    ),
    developmentByEmployment: await at((tx) =>
      stores.developmentPlans.search(tx, { employmentId: developmentPlan }, PAGE),
    ),
    // **The open items due by a day**, which is the shape `career_development_item_due_idx`
    // actually serves: the index is partial on `status in ('planned','in_progress')`, so a query
    // that omits the status cannot reach it and falls to a sequential scan. Measured here without a
    // status first — 28.6 ms and a `Seq Scan` over sixty thousand rows at tier C — and the index
    // was *not* changed to suit it: the omission was the benchmark's, and the question the product
    // would ask names the status. See the Checkpoint 9 report, defect 3.
    developmentDue: await at((tx) =>
      stores.developmentItems.search(tx, { status: 'planned', targetOnOrBefore: AS_OF }, PAGE),
    ),
    mobilityList: await at((tx) => stores.mobility.search(tx, { status: 'proposed' }, PAGE)),
    summary: await at(async (tx) => {
      const plan = await stores.plans.activeFor(tx, person);
      const memberships = await stores.memberships.search(
        tx,
        { employmentId: person, openOnly: true },
        bounded,
      );
      const nominations = await stores.successors.search(
        tx,
        { employmentId: person, status: 'nominated' },
        bounded,
      );
      const history = await stores.assessments.historyFor(tx, person);
      const development = await stores.developmentPlans.activeFor(tx, person);
      const open = await stores.mobility.search(
        tx,
        { employmentId: person, status: 'proposed' },
        bounded,
      );

      return [plan, memberships, nominations, history, development, open];
    }),
  };
};

/**
 * The bounded cohort reads: one question about two hundred people, in one query each.
 *
 * This is the shape §16 calls reconciliation — "a question somebody asks, answered live and
 * bounded". Every filter that carries an `employmentIdsIn` is measured here, because the alternative
 * shape is the N+1 the contract exists to prevent, and Phase 13's first benchmark miss was exactly
 * that.
 */
const cohortReads = async (stores, at, seeded) => {
  const cohort = seeded.people.slice(0, COHORT);

  return {
    cohortPlans: await at((tx) => stores.plans.search(tx, { employmentIdsIn: cohort }, PAGE)),
    cohortMemberships: await at((tx) =>
      stores.memberships.search(tx, { employmentIdsIn: cohort }, PAGE),
    ),
    cohortSuccessors: await at((tx) =>
      stores.successors.search(tx, { employmentIdsIn: cohort }, PAGE),
    ),
    cohortAssessments: await at((tx) =>
      stores.assessments.search(tx, { employmentIdsIn: cohort }, PAGE),
    ),
    cohortDevelopment: await at((tx) =>
      stores.developmentPlans.search(tx, { employmentIdsIn: cohort }, PAGE),
    ),
    cohortMobility: await at((tx) => stores.mobility.search(tx, { employmentIdsIn: cohort }, PAGE)),
  };
};

await run();
