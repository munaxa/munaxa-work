import { success } from '@work/kernel';

import { completeCalculation, moveRunTo } from '../domain/payroll-run.js';
import { digestOf } from '../domain/digest.js';
import { populationDigest, runSnapshotDigest } from '../domain/payroll-snapshot.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import { BATCH_SIZE, calculateBatch, type BatchOutcome } from './calculation-batch.js';
import { PayrollEvents, payrollEvent } from '../domain/payroll-events.js';
import { conflicted, currentActor, originOfCurrentRequest, refusedBy } from './payroll-context.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type { CalculateRunCommand, RunCalculated, RunContext } from './calculation-contract.js';

/**
 * The batch loop: **capture, calculate, persist, advance the cursor — and commit each time**.
 *
 * Apart from the handler because the handler's job is to resolve what is being calculated and this
 * one's is to grind through it. Each batch is its own transaction, so a crash at employee sixty
 * thousand leaves sixty thousand results committed and a cursor pointing at the next one.
 *
 * `maxBatches` is what lets a long run be driven by repeated calls rather than one request that
 * holds a connection for forty minutes. A run that has not covered its population reports
 * `complete: false` and stays out of `calculated`, so it cannot be approved.
 */

/** Runs batches until the population is exhausted or the invocation's budget is spent. */
export const drive = async (
  dependencies: PayrollDependencies,
  command: CalculateRunCommand,
  context: RunContext,
): Promise<ReturnType<typeof success<RunCalculated>>> => {
  const budget = command.maxBatches ?? Number.MAX_SAFE_INTEGER;
  const covered: string[] = [];
  const digests: string[] = [];
  let cursor = context.run.cursor;
  let results = 0;
  let exceptions = 0;
  let complete = false;

  for (let batch = 0; batch < budget; batch += 1) {
    const page = await nextPage(dependencies, command, context, cursor);

    if (page.length === 0) {
      complete = true;
      break;
    }

    // The loop terminates only because the population source honours the cursor. A source that
    // hands back a page ending where the last one ended would grind forever and exhaust memory,
    // so it is refused here rather than trusted. Found by the API suite, which OOMed on a fake
    // that ignored `after`.
    if (cursor !== undefined && page[page.length - 1] === cursor) {
      return conflicted<RunCalculated>('population_source_did_not_advance');
    }

    const outcome = await runBatch(dependencies, context, page);

    covered.push(...outcome.snapshots.map((snapshot) => snapshot.employmentId));
    digests.push(runSnapshotDigest(outcome.snapshots));
    results += outcome.results.length;
    exceptions += outcome.exceptions.length;
    cursor = page[page.length - 1] ?? cursor;
    if (cursor !== undefined) await advance(dependencies, context, cursor);
  }

  return settle(dependencies, context, {
    covered,
    digests,
    results,
    exceptions,
    complete,
  });
};

/** The next page of employment identifiers, from Employment's published search — never a join. */
const nextPage = async (
  dependencies: PayrollDependencies,
  command: CalculateRunCommand,
  context: RunContext,
  cursor: string | undefined,
): Promise<readonly string[]> => {
  if (command.employmentIds !== undefined) {
    const after = cursor === undefined ? 0 : command.employmentIds.indexOf(cursor) + 1;

    return command.employmentIds.slice(after, after + BATCH_SIZE);
  }
  return dependencies.employment.employmentIds(context.group.legalEntityId, cursor, BATCH_SIZE);
};

const runBatch = (
  dependencies: PayrollDependencies,
  context: RunContext,
  employmentIds: readonly string[],
): Promise<BatchOutcome> =>
  dependencies.unitOfWork.execute((transaction) =>
    calculateBatch(dependencies, transaction, {
      group: context.group,
      period: context.period,
      payrollRunId: context.run.payrollRunId,
      employmentIds,
      definitions: context.definitions,
      ...(context.countryCode === undefined ? {} : { countryCode: context.countryCode }),
      moment: dependencies.clock.now(),
    }),
  );

/** The cursor, committed after each batch, so a crash resumes rather than restarts. */
const advance = (
  dependencies: PayrollDependencies,
  context: RunContext,
  cursor: string,
): Promise<void> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const run = await dependencies.stores.runs.byId(transaction, context.run.payrollRunId);

    if (run === undefined) return;
    await dependencies.stores.runs.update(
      transaction,
      { ...run, status: 'calculating', cursor, version: run.version + 1 },
      run.version,
    );
  });

interface Totals {
  readonly covered: readonly string[];
  readonly digests: readonly string[];
  readonly results: number;
  readonly exceptions: number;
  readonly complete: boolean;
}

const settle = (
  dependencies: PayrollDependencies,
  context: RunContext,
  totals: Totals,
): Promise<ReturnType<typeof success<RunCalculated>>> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const run = await dependencies.stores.runs.byId(transaction, context.run.payrollRunId);

    if (run === undefined) return conflicted<RunCalculated>('run_not_found');
    if (!totals.complete) {
      return success({
        payrollRunId: run.payrollRunId,
        status: run.status,
        resultCount: totals.results,
        exceptionCount: totals.exceptions,
        complete: false,
      });
    }

    const stored = await dependencies.stores.results.forRun(transaction, run.payrollRunId, {
      limit: 1,
      offset: 0,
    });
    const raised = await dependencies.stores.exceptions.forRun(transaction, run.payrollRunId);
    const completed = completeCalculation(
      run.status === 'calculating' ? run : movedToCalculating(run),
      {
        populationDigest: populationDigest(totals.covered),
        snapshotDigest: digestOf(totals.digests),
        populationSize: totals.covered.length,
        resultCount: stored.total,
        exceptionCount: raised.length,
      },
      dependencies.clock.now(),
      currentActor(),
    );

    if (!completed.ok) return refusedBy<RunCalculated>(completed.error);

    await dependencies.stores.runs.update(transaction, completed.value, run.version);
    // Identifiers and counts, never money. Nothing downstream depends on this arriving.
    transaction.collect([
      payrollEvent(
        PayrollEvents.calculated,
        { aggregateType: 'payroll-run', aggregateId: run.payrollRunId },
        {
          payrollRunId: run.payrollRunId,
          payrollPeriodId: run.payrollPeriodId,
          resultCount: completed.value.resultCount,
          exceptionCount: completed.value.exceptionCount,
        },
        originOfCurrentRequest(),
        dependencies.clock.now(),
      ),
    ]);
    return success({
      payrollRunId: run.payrollRunId,
      status: completed.value.status,
      resultCount: completed.value.resultCount,
      exceptionCount: completed.value.exceptionCount,
      complete: true,
    });
  });

/** A run with an empty population never entered `calculating`; the table still governs the move. */
const movedToCalculating = (run: PayrollRunState): PayrollRunState => {
  const moved = moveRunTo(run, 'calculating');

  return moved.ok ? { ...moved.value, version: run.version } : run;
};
