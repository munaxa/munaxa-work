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

/** Per-stage accumulators, filled by the wrappers below during a real run. */
const stages = new Map();

const record = (stage, elapsed) => {
  const held = stages.get(stage) ?? { total: 0, calls: 0 };

  stages.set(stage, { total: held.total + elapsed, calls: held.calls + 1 });
};

const timed = (stage, work) => {
  return async (...parameters) => {
    const started = process.hrtime.bigint();
    const outcome = await work(...parameters);

    record(stage, Number(process.hrtime.bigint() - started) / 1_000_000);
    return outcome;
  };
};

/**
 * The source adapters, in the shape the production ones publish.
 *
 * They answer from memory rather than calling Employment and Compensation over the dispatcher,
 * because what this script measures is **Payroll's** cost: its paging, its snapshot assembly, its
 * arithmetic and its writes. Employment's and Compensation's own read paths are measured by their
 * own benchmarks, and folding them in here would produce a number that moved when either of those
 * modules changed and say nothing about this one. Attendance and Leave answer "unknown", which is
 * the honest production shape for a composition without those contracts.
 */
const sources = (ids) => {
  const facts = new Map(
    ids.map((employmentId) => [
      employmentId,
      {
        employmentId,
        status: 'active',
        startDate: '2020-01-01',
        employmentTypeCode: 'permanent',
        version: 1,
      },
    ]),
  );
  const compensation = {
    currencies: [
      {
        currencyCode: 'JOD',
        currencyExponent: 3,
        recurring: [
          {
            componentId: uuidV7(),
            componentCode: 'salary',
            kind: 'base',
            payrollTreatmentCode: 'ordinary',
            proratable: true,
            amount: { amountMinor: 1_200_000n, currencyCode: 'JOD', currencyExponent: 3 },
            effectiveFrom: '2020-01-01',
            partialPeriod: false,
          },
        ],
        oneTime: [],
      },
    ],
    inputsDigest: 'aaaa0001',
    calculationVersion: 1,
  };
  return {
    employment: {
      employmentIds: timed('1. population resolution', (_legalEntityId, after, limit) => {
        const from = after === undefined ? 0 : ids.indexOf(after) + 1;

        return Promise.resolve(ids.slice(from, from + limit));
      }),
      factsFor: timed('2. Employment retrieval', (batch) =>
        Promise.resolve(sourceAnswered(new Map(batch.map((id) => [id, facts.get(id)])))),
      ),
    },
    compensation: {
      factsFor: timed('3. Compensation retrieval', (batch) =>
        Promise.resolve(sourceAnswered(new Map(batch.map((id) => [id, compensation])))),
      ),
      changedSince: () => Promise.resolve([]),
    },
    attendance: {
      factsFor: timed('4. Attendance retrieval', (batch, period) =>
        attendanceUnavailable.factsFor(batch, period),
      ),
    },
    leave: {
      factsFor: timed('5. Leave retrieval', (batch, period) =>
        leaveUnavailable.factsFor(batch, period),
      ),
    },
  };
};

/**
 * The real repositories, with the write paths §14 names wrapped for timing.
 *
 * Wrapped through the prototype rather than by spreading. `postgresPayrollStores()` returns class
 * instances, and `{...instance}` copies own properties only — every method would be lost, which is
 * exactly what happened the first time this ran. The repositories hold no state (each method takes
 * its transaction), so an object sharing their prototype behaves identically.
 */
const wrapInsert = (store, stage) => {
  const wrapped = Object.create(Object.getPrototypeOf(store));

  Object.assign(wrapped, store);
  wrapped.insertMany = timed(stage, (...parameters) => store.insertMany(...parameters));
  return wrapped;
};

const instrumentedStores = () => {
  const stores = postgresPayrollStores();

  return {
    ...stores,
    snapshots: wrapInsert(stores.snapshots, '7. snapshot persistence'),
    results: wrapInsert(stores.results, '11. result persistence'),
    earnings: wrapInsert(stores.earnings, '9. earning persistence'),
    deductions: wrapInsert(stores.deductions, '10. deduction persistence'),
  };
};

const organization = {
  legalEntity: (legalEntityId) =>
    Promise.resolve({
      known: true,
      entity: { legalEntityId, countryCode: 'JO', currencyCode: 'JOD' },
    }),
};

const dependenciesFor = (pool, ids) => ({
  unitOfWork: new PostgresUnitOfWork(pool, new InProcessEventDispatcher()),
  stores: instrumentedStores(),
  ...sources(ids),
  organization,
  countryRules: noCountryRules,
  clock: { now: () => new Date('2026-07-01T09:00:00Z') },
});

const dispatcherFor = (dependencies) => {
  const dispatcher = new Dispatcher({ holds: () => Promise.resolve(true) });
  const module = payrollModule(dependencies);

  for (const handler of module.commands ?? []) dispatcher.registerCommand(handler);
  for (const handler of module.queries ?? []) dispatcher.registerQuery(handler);
  return dispatcher;
};

const inTenant = (work) =>
  runInContext(
    { tenantId: TENANT, correlationId: uuidV7(), actor: 'user:payroll-benchmark' },
    work,
  );

const asApprover = (work) =>
  runInContext({ tenantId: TENANT, correlationId: uuidV7(), actor: 'user:payroll-approver' }, work);

const clock = () => process.hrtime.bigint();
const since = (started) => Number(process.hrtime.bigint() - started) / 1_000_000;

const unwrap = (result, what) => {
  if (result.ok !== true) {
    throw new Error(`${what} refused: ${JSON.stringify(result.error ?? result)}`);
  }
  return result.value;
};

/** One dataset, end to end. Returns every stage's measured milliseconds. */
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
