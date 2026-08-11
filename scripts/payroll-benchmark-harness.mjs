/**
 * The instrumentation the payroll benchmark measures through, and the adapters it measures against.
 *
 * Apart from the script that prints the table because the two answer different questions: this one
 * is *how* a stage is timed and what the production path is wired to, and the other is *which*
 * datasets are run and how the numbers are reported. Keeping them together put the file past the
 * 400-line budget, and the budget is right — a reader looking for "what does stage 7 actually
 * measure" should not scroll past the reporting loop to find out.
 */

import { Dispatcher, InProcessEventDispatcher, runInContext, uuidV7 } from '../packages/kernel/dist/index.js';
import { PostgresUnitOfWork } from '../packages/persistence/dist/index.js';
import {
  attendanceUnavailable,
  leaveUnavailable,
  noCountryRules,
  payrollModule,
  postgresPayrollStores,
  sourceAnswered,
} from '../packages/modules/payroll/dist/index.js';

import { TENANT } from './payroll-benchmark-data.mjs';


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

export {
  asApprover,
  clock,
  dependenciesFor,
  dispatcherFor,
  inTenant,
  since,
  stages,
  unwrap,
};
