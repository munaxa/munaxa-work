#!/usr/bin/env node
/**
 * Measures the **production** Payroll implementation at the three volumes Phase 11 names: 500,
 * 10,000 and 100,000 employees.
 *
 * Real PostgreSQL, real repositories, real cross-module adapter shapes, the real dispatcher and the
 * real command handlers. Every measurement runs as an **unprivileged role** under the same
 * row-level security a request runs under, because a superuser sees every row without consulting a
 * policy and would hide exactly the cost RLS adds.
 *
 * **Seventeen stages, reported separately.** An aggregate total says a run took four minutes; it
 * does not say whether that was the source reads, the arithmetic or the inserts, and only one of
 * those three is fixed by a different index. Stages 1–5 and 7–11 are measured by wrapping the ports
 * and stores the real run calls, so the numbers come from the production path rather than from a
 * re-creation of it. Stages 6 and 8 call the module's own published `captureSnapshots` and
 * `calculateEmployment` for the same reason.
 *
 * The figures this prints are the figures the Phase 11 report carries, including any that miss
 * their budget. A benchmark whose failures are not reported is not a benchmark.
 *
 * Usage: TEST_DATABASE_URL=... node scripts/measure-payroll-performance.mjs [--only=A|B|C] [--purge]
 */

import { Client, Pool } from 'pg';

import {
  InProcessEventDispatcher,
  Dispatcher,
  runInContext,
  uuidV7,
} from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import {
  attendanceUnavailable,
  calculateEmployment,
  captureSnapshots,
  leaveUnavailable,
  noCountryRules,
  payrollModule,
  postgresPayrollStores,
  sourceAnswered,
} from '../packages/modules/payroll/dist/index.js';

import {
  DATASETS,
  LEGAL_ENTITY,
  PAYMENT_DATE,
  PERIOD_END,
  PERIOD_START,
  TENANT,
  applicationUrl,
  employmentIds,
  ensureRole,
  purge,
  resetPayroll,
  seed,
  tally,
} from './payroll-benchmark-data.mjs';

const CONNECTION = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

if (CONNECTION === undefined) {
  console.error('Set TEST_DATABASE_URL to the database to measure against.');
  process.exit(1);
}

const admin = new Client({ connectionString: CONNECTION });

await admin.connect();
await ensureRole(admin);

if (process.argv.includes('--purge')) {
  await purge(admin);
  console.log('Purged.');
  await admin.end();
  process.exit(0);
}

const only = process.argv.find((argument) => argument.startsWith('--only='))?.slice(7);
const chosen = only === undefined ? DATASETS : DATASETS.filter((set) => set.name === only);
import {
  asApprover,
  clock,
  dependenciesFor,
  dispatcherFor,
  inTenant,
  since,
  stages,
  unwrap,
} from './payroll-benchmark-harness.mjs';

const measureDataset = async (dataset) => {
  stages.clear();
  // Payroll's own tables only. The population is shared across datasets and seeded once.
  await resetPayroll(admin);
  console.log(`\nPreparing ${dataset.employees.toLocaleString()} employees…`);

  const seedingStarted = clock();

  await seed(admin, dataset.employees);
  console.log(`Ready in ${(since(seedingStarted) / 1000).toFixed(1)} s.`);

  // The first N of the shared population, so a smaller dataset is a prefix of a larger one.
  const ids = (await employmentIds(admin)).slice(0, dataset.employees);
  const pool = new Pool({
    connectionString: applicationUrl(CONNECTION),
    max: 8,
    connectionTimeoutMillis: 30_000,
  });
  const dependencies = dependenciesFor(pool, ids);
  const dispatcher = dispatcherFor(dependencies);
  const groupId = uuidV7();
  const periodId = uuidV7();

  await inTenant(async () => {
    unwrap(
      await dispatcher.send({
        commandName: 'payroll.define-group',
        payrollGroupId: groupId,
        legalEntityId: LEGAL_ENTITY,
        code: 'benchmark',
        name: { en: 'Benchmark', ar: 'قياس' },
        payFrequency: 'monthly',
        permittedCurrencies: [{ code: 'JOD', exponent: 3 }],
        prorationBasis: 'calendar_days',
        roundingMode: 'half-up',
        paysSuspended: false,
        expenseAccount: 'payroll-expense',
        deductionAccount: 'payroll-deductions',
        payableAccount: 'payroll-payable',
        paymentMethodCode: 'bank-transfer',
      }),
      'define-group',
    );
  });

  const group = await inTenant(() => dispatcher.ask({ queryName: 'payroll.groups' }));
  const definedGroupId = unwrap(group, 'groups').items[0].payrollGroupId;

  const period = await inTenant(() =>
    dispatcher.send({
      commandName: 'payroll.open-period',
      payrollPeriodId: periodId,
      payrollGroupId: definedGroupId,
      code: '2026-06',
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      paymentDate: PAYMENT_DATE,
    }),
  );
  const openedPeriodId = unwrap(period, 'open-period').payrollPeriodId;

  await inTenant(() =>
    dispatcher.send({
      commandName: 'payroll.move-period',
      payrollPeriodId: openedPeriodId,
      status: 'open',
      expectedVersion: 1,
    }),
  );

  // Stages 6 and 8, on one batch, against the module's own published functions.
  const window = { periodStart: PERIOD_START, periodEnd: PERIOD_END };
  const batch = ids.slice(0, 500);
  const captureStarted = clock();
  const snapshots = await captureSnapshots(dependencies, {
    group: { payrollGroupId: definedGroupId, legalEntityId: LEGAL_ENTITY },
    period: window,
    employmentIds: batch,
    capturedAt: new Date('2026-07-01T09:00:00Z'),
  });
  const captureMs = since(captureStarted);
  const pureStarted = clock();

  for (const snapshot of snapshots) {
    calculateEmployment({
      period: window,
      snapshot,
      policy: {
        basis: 'calendar_days',
        rounding: 'half-up',
        permittedCurrencies: ['JOD'],
        countryCode: 'JO',
      },
      definitions: [],
      countryRules: noCountryRules,
      payrollRunId: uuidV7(),
      identifier: () => uuidV7(),
    });
  }
  const pureMs = since(pureStarted);

  // Stage 12: the whole run, driven the way a long run is driven — repeated bounded calls.
  const runStarted = clock();
  let runId;
  let complete = false;

  while (!complete) {
    const calculated = unwrap(
      await inTenant(() =>
        dispatcher.send({
          commandName: 'payroll.calculate',
          payrollPeriodId: openedPeriodId,
          ...(runId === undefined ? {} : { payrollRunId: runId }),
          maxBatches: 20,
        }),
      ),
      'calculate',
    );

    runId = calculated.payrollRunId;
    complete = calculated.complete;
  }
  const totalRunMs = since(runStarted);

  const reconcileStarted = clock();

  await inTenant(() => dispatcher.send({ commandName: 'payroll.reconcile', payrollRunId: runId }));
  const reconcileMs = since(reconcileStarted);

  await asApprover(() => dispatcher.send({ commandName: 'payroll.approve', payrollRunId: runId }));

  const finalizeStarted = clock();

  unwrap(
    await asApprover(() =>
      dispatcher.send({ commandName: 'payroll.finalize', payrollRunId: runId }),
    ),
    'finalize',
  );
  const finalizeMs = since(finalizeStarted);

  const accountingStarted = clock();

  await inTenant(() =>
    dispatcher.ask({
      queryName: 'payroll.accounting-output',
      payrollRunId: runId,
      page: 1,
      size: 200,
    }),
  );
  const accountingMs = since(accountingStarted);

  const results = unwrap(
    await inTenant(() =>
      dispatcher.ask({ queryName: 'payroll.results', payrollRunId: runId, page: 1, size: 1 }),
    ),
    'results',
  );
  const lookupStarted = clock();

  await inTenant(() =>
    dispatcher.ask({
      queryName: 'payroll.earnings',
      payrollResultId: results.items[0].payrollResultId,
    }),
  );
  const lookupMs = since(lookupStarted);

  const periodQueryStarted = clock();

  await inTenant(() =>
    dispatcher.ask({ queryName: 'payroll.results', payrollRunId: runId, page: 1, size: 200 }),
  );
  const periodQueryMs = since(periodQueryStarted);

  await pool.end();

  const counted = { ...(await tally(admin)), employments: ids.length };
  const wrapped = (stage) => stages.get(stage)?.total ?? 0;

  return {
    dataset,
    counted,
    measured: [
      ['1. population resolution', wrapped('1. population resolution')],
      ['2. Employment retrieval', wrapped('2. Employment retrieval')],
      ['3. Compensation retrieval', wrapped('3. Compensation retrieval')],
      ['4. Attendance retrieval', wrapped('4. Attendance retrieval')],
      ['5. Leave retrieval', wrapped('5. Leave retrieval')],
      ['6. snapshot creation (500)', captureMs],
      ['7. snapshot persistence', wrapped('7. snapshot persistence')],
      ['8. pure calculation (500)', pureMs],
      ['9. earning persistence', wrapped('9. earning persistence')],
      ['10. deduction persistence', wrapped('10. deduction persistence')],
      ['11. result persistence', wrapped('11. result persistence')],
      ['12. total payroll run', totalRunMs],
      ['13. reconciliation', reconcileMs],
      ['14. finalization', finalizeMs],
      ['15. accounting output', accountingMs],
      ['16. employee result lookup', lookupMs],
      ['17. payroll-period query (200)', periodQueryMs],
    ],
  };
};

for (const dataset of chosen) {
  const outcome = await measureDataset(dataset);

  console.log(
    `\nDataset ${dataset.name}: ${outcome.counted.employments.toLocaleString()} employments, ` +
      `${outcome.counted.results.toLocaleString()} results.\n`,
  );
  console.log('Stage'.padEnd(34) + 'total ms   per employee (µs)');
  console.log('-'.repeat(66));

  for (const [stage, milliseconds] of outcome.measured) {
    const each = (milliseconds * 1000) / dataset.employees;

    console.log(
      `${stage.padEnd(34)}${milliseconds.toFixed(1).padStart(9)}  ${each.toFixed(1).padStart(12)}`,
    );
  }
}

await admin.end();
