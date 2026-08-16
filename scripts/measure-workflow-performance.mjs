#!/usr/bin/env node
/**
 * Measures the **production** Workflow implementation at the volumes the Phase 16 plan's §14 names:
 * 500, 10,000 and 100,000 per tenant.
 *
 * Real PostgreSQL, the real repositories, the real row mappers, the real unit of work. Every
 * measurement runs as an **unprivileged role** under the same row-level security a request runs
 * under, because a superuser sees every row without consulting a policy and would hide exactly the
 * cost row-level security adds.
 *
 * **A second tenant is seeded at every tier**, holding the same volume and — deliberately — the same
 * membership identifiers. A benchmark against a database containing one tenant measures a policy
 * that never has to exclude anything, which is the easy case and not the one production runs; and
 * one whose tenants held disjoint identifiers would pass its isolation assertions whether or not the
 * policy worked, because every read would be separated by the value rather than by the boundary.
 *
 * The reads measured are the critical ones, because an aggregate says a page took a second and does
 * not say which query to index:
 *
 * 1. **The pending queue** — the screen everybody opens, resolved from the caller's own membership
 *    and bounded by a partial index over awaiting steps. The read this phase most has to get right.
 * 2. **The decided listing** — the other half of a queue, on the same identity rule, over a table
 *    that grows without bound because nothing is ever deleted from it.
 * 3. **Instances by subject, and the open-approval probe** — the business module's own lookup, and
 *    the uniqueness read behind duplicate convergence.
 * 4. **One approval in full** — the four store reads `read-instance` composes, plus its timeline and
 *    its status in the port's vocabulary. Fixed fan-out, whatever the length of the chain.
 * 5. **The configuration reads** — definitions, versions, the published-version choice and the step
 *    templates, which are flat with volume and would be a surprise if they were not.
 * 6. **The cohort shape** — two hundred subjects, measured as the repository can actually answer it.
 *    See the note in the report: no cohort filter exists, and this measures what its absence costs.
 *
 * **Two workloads the plan proposes are not measured, and their absence is not an oversight.**
 * "Instances breaching SLA as of an instant" and "escalation candidates as of an instant" require a
 * due time and an escalation level; Workflow has neither a column nor a field for either, because
 * both are Phase 16B (D-12). Measuring them would mean inventing the capability. They are named here
 * so the gap is visible rather than silent.
 *
 * The figures this prints are the figures the Checkpoint 10 report carries, **including any that
 * miss their budget**. A benchmark whose failures are not reported is not a benchmark.
 *
 * **Running this changes the database's planner statistics, and they outlive the rows.** The
 * `vacuum analyze` the plan requires writes column statistics — how many distinct statuses, how
 * selective a subject is — that describe *this fixture*, and `truncate` does not remove them:
 * `pg_statistic` keeps them, and an `analyze` of an empty table has nothing with which to replace
 * them. A repository plan suite run afterwards therefore plans a five-row fixture against a hundred
 * thousand rows' worth of statistics, and can see the planner choose a different index from the one
 * it names.
 *
 * That is not a defect in either the benchmark or the suite — each is right about its own
 * conditions — but it does mean the two must not share a database casually. **Re-apply the
 * migrations to a fresh database before running the repository suites again**, which is the only
 * reliable way to return `pg_statistic` to its unanalyzed state. The same is true of every other
 * `measure-*-performance` script in this repository, for the same reason.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-workflow-performance.mjs [--only=A|B|C] [--keep] [--plans]
 */

import { Pool } from 'pg';

import { InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import { postgresWorkflowStores } from '../packages/modules/workflow/dist/index.js';
import { seedTenant } from './workflow-benchmark-data.mjs';
import { report } from './workflow-benchmark-report.mjs';
import {
  assertNoCrossModuleForeignKeys,
  assertNoInexactColumns,
  assertRoleUnprivileged,
  assertRowLevelSecurityForced,
  assertVocabularyParity,
  explain,
  forgetStatistics,
} from './workflow-benchmark-audit.mjs';
import {
  assertCompositeForeignKeys,
  assertExactValues,
  assertIsolation,
} from './workflow-benchmark-isolation.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL (or DATABASE_URL) to a migrated database.');
  process.exit(1);
}

/**
 * Two tenants that share their first twenty-four characters, so the memberships built from that
 * prefix are identical in both. See the file note: this is what makes the isolation assertions test
 * the policy rather than the values.
 */
const TENANT = '01930000-0000-7000-8000-00000000af01';
const OTHER = '01930000-0000-7000-8000-00000000af02';
const ROLE = 'workflow_benchmark_role';

/**
 * The three tiers, and the budgets each read is held to.
 *
 * Inherited from Phases 13–15 **unchanged**, exactly as the Phase 16 plan's §14 requires: a queue
 * read is a screen somebody opens every morning, a detail read is a page they navigated to, and a
 * cohort read is a question they asked and will wait on. **No new budget is invented here.**
 *
 * They do not relax as the data grows, except where the work genuinely does: a queue is a bounded
 * page whatever the tenant's size, so its budget stays flat, while a cohort read examines a slice of
 * an organization and is allowed to scale with it.
 */
const DATASETS = [
  { key: 'A', approvals: 500, budgetMs: { queue: 100, detail: 150, cohort: 2_000 } },
  { key: 'B', approvals: 10_000, budgetMs: { queue: 100, detail: 150, cohort: 10_000 } },
  { key: 'C', approvals: 100_000, budgetMs: { queue: 100, detail: 150, cohort: 60_000 } },
];

/** The nine tables, most dependent first: a truncate in the wrong order fails on a foreign key. */
const TABLES = [
  'workflow_history',
  'workflow_decision',
  'workflow_step',
  'workflow_instance',
  'workflow_step_template',
  'workflow_version',
  'workflow_definition',
  'workflow_approval_group_member',
  'workflow_approval_group',
];

/**
 * Every closed vocabulary the domain declares, checked against the constraint that enforces it.
 *
 * Named by constraint rather than by column: `workflow_version` has two check constraints that
 * mention `status`, and matching on the column would compare the domain's list against whichever
 * one the catalogue returned first.
 */
const VOCABULARIES = [
  ['workflow_definition_status_check', 'definition status', ['active', 'retired']],
  ['workflow_version_status_check', 'version status', ['draft', 'published', 'archived']],
  [
    'workflow_instance_status_check',
    'instance status',
    ['running', 'completed', 'rejected', 'cancelled'],
  ],
  [
    'workflow_step_status_check',
    'step status',
    ['pending', 'awaiting', 'approved', 'rejected', 'skipped'],
  ],
  ['workflow_decision_kind_check', 'decision', ['approved', 'rejected']],
  // Phase 16B. A **template** may name a person or a list; a running **step** never names a list,
  // because the list was resolved into its members before the row existed. The two constraints are
  // deliberately different and are checked as two.
  ['workflow_step_template_approver_kind_check', 'template approver kind', ['membership', 'group']],
  ['workflow_step_approver_kind_check', 'step approver kind', ['membership']],
  [
    'workflow_step_template_branch_rule_check',
    'template branch rule',
    ['unanimous', 'majority', 'first-response'],
  ],
  [
    'workflow_step_branch_rule_check',
    'step branch rule',
    ['unanimous', 'majority', 'first-response'],
  ],
  ['workflow_decision_authority_check', 'decision authority', ['assigned', 'delegated']],
  [
    'workflow_history_event_check',
    'history event',
    [
      'instance-started',
      'step-awaiting',
      'step-approved',
      'step-rejected',
      'step-skipped',
      'instance-completed',
      'instance-rejected',
      'instance-cancelled',
    ],
  ],
];

const only = process.argv
  .find((argument) => argument.startsWith('--only='))
  ?.slice('--only='.length);
/**
 * The seed is removed when the run finishes, unless `--keep` asks for it.
 *
 * Cleaning up is the default rather than the opt-in because this runs against the **shared** test
 * database. Two hundred thousand approvals left behind do not merely occupy space: they change the
 * table statistics every other suite's planner sees, and the repository's own query-plan tests then
 * fail against a database nobody meant to leave in that state. That happened once here, which is
 * why the flag is this way round.
 */
const keep = process.argv.includes('--keep');
const plans = process.argv.includes('--plans');

const elapsed = async (work) => {
  const started = process.hrtime.bigint();
  const value = await work();

  return { value, ms: Number(process.hrtime.bigint() - started) / 1e6 };
};

const admin = new Pool({ connectionString: CONNECTION, max: 4, statement_timeout: 900_000 });

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

// `truncate` rather than `delete`: the immutability triggers refuse a delete of a decision or a
// history entry, and a table-level truncate is not something a row trigger sees. This is the
// established safe reset, not a way around the protection — and the protection itself is asserted
// by the API and repository suites rather than here.
const truncate = () => admin.query(`truncate ${TABLES.join(', ')}`);

const PAGE = { limit: 50, offset: 0 };

const counts = async () => {
  const rows = [];

  for (const table of [...TABLES].reverse()) {
    const { rows: counted } = await admin.query(
      `select count(*)::int as rows from ${table} where tenant_id = $1`,
      [TENANT],
    );

    rows.push({ name: table, rows: counted[0].rows });
  }
  return rows;
};

/**
 * Every measured read, through the production repositories inside a real tenant context.
 *
 * Each is timed once rather than as a median of five. A repeated read is served from the buffer
 * cache and measures memory; the first is the one a person waits on, and at tier C the difference
 * is the point.
 */
const measure = async (stores, asTenant, mine) => {
  const one = (work) => elapsed(() => asTenant(TENANT, work));

  return {
    definitionList: await one((tx) => stores.definitions.search(tx, { status: 'active' }, PAGE)),
    definitionRead: await one((tx) => stores.definitions.byId(tx, mine.definition)),
    definitionByCode: await one((tx) => stores.definitions.byCode(tx, 'approval-0001')),
    versionList: await one((tx) => stores.versions.forDefinition(tx, mine.definition, PAGE)),
    publishedVersion: await one((tx) => stores.versions.currentPublished(tx, mine.definition)),
    templates: await one((tx) => stores.versions.templatesFor(tx, mine.version)),

    instanceList: await one((tx) => stores.instances.search(tx, {}, PAGE)),
    runningList: await one((tx) => stores.instances.search(tx, { status: 'running' }, PAGE)),
    bySubject: await one((tx) =>
      stores.instances.search(tx, { subjectType: mine.subjecttype, subjectId: mine.subject }, PAGE),
    ),
    openForSubject: await one((tx) =>
      stores.instances.openForSubject(tx, mine.subjecttype, mine.subject),
    ),
    instanceRead: await one((tx) => stores.instances.byId(tx, mine.running)),
    // The four reads `workflow.read-instance` composes, in one transaction, as the handler does.
    instanceDetail: await one(async (tx) => ({
      instance: await stores.instances.byId(tx, mine.running),
      steps: await stores.steps.forInstance(tx, mine.running),
      decisions: await stores.decisions.forInstance(tx, mine.running),
      total: 1,
    })),
    stepChain: await one((tx) => stores.steps.forInstance(tx, mine.running)),
    timeline: await one((tx) => stores.history.forInstance(tx, mine.running, PAGE)),

    pendingQueue: await one((tx) => stores.steps.awaitingFor(tx, mine.approver, PAGE)),
    decidedQueue: await one((tx) => stores.decisions.decidedBy(tx, mine.decider, PAGE)),
    // The three reads `workflow.read-approval-status` composes.
    approvalStatus: await one(async (tx) => ({
      instance: await stores.instances.byId(tx, mine.running),
      steps: await stores.steps.forInstance(tx, mine.running),
      decisions: await stores.decisions.forInstance(tx, mine.running),
      total: 1,
    })),

    // Phase 16B — the lists, and the read an approval start depends on.
    groupSearch: await one((tx) => stores.groups.search(tx, PAGE)),
    groupByCode: await one((tx) => stores.groups.byCode(tx, mine.groupCode)),
    groupRead: await one((tx) => stores.groups.byId(tx, mine.group)),
    groupMembers: await one((tx) => stores.groups.membersOf(tx, mine.group)),
    // Every group in the tenant at once. One statement, whatever the number of lists.
    membersOfAll: await one((tx) => stores.groups.membersOfAll(tx, mine.groupIds)),

    // Phase 16B — a branch: three steps awaiting at one position on one approval.
    branchSteps: await one((tx) => stores.steps.forInstance(tx, mine.branchInstance)),
    branchDetail: await one(async (tx) => ({
      instance: await stores.instances.byId(tx, mine.branchInstance),
      steps: await stores.steps.forInstance(tx, mine.branchInstance),
      decisions: await stores.decisions.forInstance(tx, mine.branchInstance),
      total: 1,
    })),
    branchQueue: await one((tx) => stores.steps.awaitingFor(tx, mine.branchApprover, PAGE)),

    cohort: await one(async (tx) => {
      const found = [];

      for (const subject of mine.cohort) {
        found.push(await stores.instances.openForSubject(tx, mine.subjecttype, subject));
      }
      return found.filter(Boolean);
    }),
  };
};

const run = async () => {
  const application = new Pool({
    connectionString: await applicationUrl(),
    max: 4,
    statement_timeout: 900_000,
  });
  const unitOfWork = new PostgresUnitOfWork(application, new InProcessEventDispatcher());
  const stores = postgresWorkflowStores();
  const asTenant = (tenantId, work) =>
    runInContext({ tenantId, correlationId: uuidV7(), actor: 'user:benchmark' }, () =>
      unitOfWork.execute(work),
    );

  await assertRoleUnprivileged(admin, ROLE);
  await assertRowLevelSecurityForced(admin, TABLES);
  await assertNoCrossModuleForeignKeys(admin, TABLES);
  await assertVocabularyParity(admin, VOCABULARIES);
  await assertNoInexactColumns(admin, TABLES);

  const missed = [];

  for (const dataset of DATASETS) {
    if (only !== undefined && only !== dataset.key) continue;

    await truncate();
    const seeded = await elapsed(async () => {
      const mine = await seedTenant(admin, TENANT, dataset.approvals);

      // The neighbour, at the same volume. Every read below pays the cost of excluding it.
      await seedTenant(admin, OTHER, dataset.approvals);
      // `vacuum analyze`, not `analyze`. A freshly bulk-loaded table has statistics but an empty
      // **visibility map**, and without one PostgreSQL cannot answer a count from an index at all.
      await admin.query('vacuum analyze');
      return mine;
    });

    missed.push(
      ...report(dataset, seeded, await measure(stores, asTenant, seeded.value), await counts()),
    );
    await assertIsolation(stores, asTenant, OTHER, seeded.value);
    await assertCompositeForeignKeys(admin, OTHER, seeded.value);
    await assertExactValues(stores, asTenant, TENANT, seeded.value);
    if (plans) await explain(asTenant, stores, TENANT, seeded.value);
  }

  console.log(
    missed.length === 0
      ? '\nEvery measured workload met its budget at every tier run.'
      : `\n${String(missed.length)} workload(s) MISSED: ${missed.join(', ')}`,
  );

  await application.end();
  if (!keep) {
    await truncate();
    // The statistics matter as much as the rows: a suite that plans against a table PostgreSQL
    // still believes holds two hundred thousand rows is planning against this benchmark's leftovers.
    await admin.query('vacuum analyze');
    console.log(
      `Seed data removed${await forgetStatistics(admin, TABLES)}. Pass --keep to leave it in place.`,
    );
  }
  await admin.end();
};

await run();
