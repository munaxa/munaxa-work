import { success, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { markRunStale } from '../domain/payroll-run.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import { PayrollEvents, payrollEvent } from '../domain/payroll-events.js';
import { conflicted, originOfCurrentRequest, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';
import type { ReconciliationRecord, StoredDigests } from './payroll-ports.js';

/**
 * **Reconciliation: staleness is found by asking, never by being told.**
 *
 * The event system is post-commit, in-process and at-most-once with no outbox. If every event this
 * product raises were dropped, every payroll figure would still be right and every stale run would
 * still be found — because this command re-asks each source and compares what it says now against
 * what the snapshot recorded (ADR-0058, ADR-0064). The lost-event scenario in the cross-module
 * suite exists to prove exactly that.
 *
 * Four axes, each a comparison rather than a re-derivation:
 *
 * | Source | Compared on |
 * | --- | --- |
 * | Compensation | `changed-since` on the **system** axis, plus the period digest |
 * | Attendance | the freeze `sequence` and the inputs digest |
 * | Leave | the inputs digest |
 * | Employment | the row `version` |
 *
 * What it does **not** do is as important. It never mutates a result, never repairs a figure, and
 * never touches a finalized run. It writes what it found, moves the run to `stale`, and stops —
 * because a system that silently corrected a payroll would be changing what somebody was paid
 * without anybody deciding to.
 */

export interface ReconcileRunCommand extends Command {
  readonly commandName: 'payroll.reconcile';
  readonly payrollRunId: string;
}

export interface RunReconciled {
  readonly payrollRunId: string;
  readonly status: string;
  readonly staleEmployments: readonly string[];
}

export const reconcileRunHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<ReconcileRunCommand, RunReconciled> => ({
  commandName: 'payroll.reconcile',
  permission: PayrollPermissions.calculate,

  handle: async (command) => {
    const context = await load(dependencies, command.payrollRunId);

    if (context === undefined) return conflicted<RunReconciled>('run_not_found');

    // A finalized run is never reconciled into a new state. Its inputs are frozen by definition,
    // and a source that moved afterwards is corrected by a correction run, not by this (§56).
    if (context.run.status === 'finalized' || context.run.status === 'reversed') {
      return conflicted<RunReconciled>('run_finalized');
    }

    const found = await detect(dependencies, context);

    return record(dependencies, context, found);
  },
});

interface Context {
  readonly run: PayrollRunState;
  readonly period: PayrollPeriodState;
  readonly digests: ReadonlyMap<string, StoredDigests>;
}

const load = (
  dependencies: PayrollDependencies,
  payrollRunId: string,
): Promise<Context | undefined> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const run = await dependencies.stores.runs.byId(transaction, payrollRunId);

    if (run === undefined) return undefined;

    const period = await dependencies.stores.periods.byId(transaction, run.payrollPeriodId);

    if (period === undefined) return undefined;

    return {
      run,
      period,
      digests: await dependencies.stores.snapshots.digestsFor(transaction, payrollRunId),
    };
  });

/** Every source, re-asked for the run's own population. Bounded by that population, never global. */
const detect = async (
  dependencies: PayrollDependencies,
  context: Context,
): Promise<readonly ReconciliationRecord[]> => {
  const employmentIds = [...context.digests.keys()];

  if (employmentIds.length === 0) return [];

  const window = {
    periodStart: context.period.periodStart,
    periodEnd: context.period.periodEnd,
  };
  const moment = dependencies.clock.now();
  const [compensation, attendance, leave, employment] = await Promise.all([
    dependencies.compensation.factsFor(employmentIds, window),
    dependencies.attendance.factsFor(employmentIds, window),
    dependencies.leave.factsFor(employmentIds, window),
    dependencies.employment.factsFor(employmentIds, window.periodEnd),
  ]);

  return employmentIds.flatMap((employmentId) => {
    const stored = context.digests.get(employmentId);

    if (stored === undefined) return [];

    return comparisons({
      runId: context.run.payrollRunId,
      employmentId,
      stored,
      moment,
      compensation: digestOrUndefined(compensation, employmentId),
      attendanceDigest: digestOrUndefined(attendance, employmentId),
      attendanceSequence: sequenceNow(attendance, employmentId),
      leave: digestOrUndefined(leave, employmentId),
      employment: versionNow(employment, employmentId),
    });
  });
};

interface Comparison {
  readonly runId: string;
  readonly employmentId: string;
  readonly stored: StoredDigests;
  readonly moment: Date;
  readonly compensation: string | undefined;
  readonly attendanceDigest: string | undefined;
  readonly attendanceSequence: string | undefined;
  readonly leave: string | undefined;
  readonly employment: string | undefined;
}

/** The four axes, side by side, so a reader can see all of them without scrolling. */
const comparisons = (input: Comparison): readonly ReconciliationRecord[] => [
  ...changed(input, 'compensation', input.stored.compensationDigest, input.compensation),
  ...changed(input, 'attendance', input.stored.attendanceDigest, input.attendanceDigest),
  ...changed(input, 'attendance', sequenceOf(input.stored), input.attendanceSequence),
  ...changed(input, 'leave', input.stored.leaveDigest, input.leave),
  ...changed(input, 'employment', versionOf(input.stored), input.employment),
];

interface Digested {
  readonly inputsDigest: string;
}

const digestOrUndefined = <TFacts extends Digested>(
  answer: { readonly known: boolean; readonly facts?: ReadonlyMap<string, TFacts> },
  employmentId: string,
): string | undefined => (answer.known ? answer.facts?.get(employmentId)?.inputsDigest : undefined);

const sequenceOf = (stored: StoredDigests): string | undefined =>
  stored.attendanceSequence === undefined ? undefined : String(stored.attendanceSequence);

const sequenceNow = (
  answer: {
    readonly known: boolean;
    readonly facts?: ReadonlyMap<string, { readonly sequence: number }>;
  },
  employmentId: string,
): string | undefined => {
  const sequence = answer.known ? answer.facts?.get(employmentId)?.sequence : undefined;

  return sequence === undefined ? undefined : String(sequence);
};

const versionOf = (stored: StoredDigests): string | undefined =>
  stored.employmentVersion === undefined ? undefined : String(stored.employmentVersion);

const versionNow = (
  answer: {
    readonly known: boolean;
    readonly facts?: ReadonlyMap<string, { readonly version: number }>;
  },
  employmentId: string,
): string | undefined => {
  const version = answer.known ? answer.facts?.get(employmentId)?.version : undefined;

  return version === undefined ? undefined : String(version);
};

/**
 * One comparison.
 *
 * A source that **could not be asked** produces no record: an outage is not a change, and marking a
 * run stale because a service was briefly down would make reconciliation cry wolf. A source that
 * answered and disagrees with the snapshot is stale, in either direction — a compensation record
 * added *or* removed both change what should have been paid.
 */
const changed = (
  input: Comparison,
  staleSource: string,
  previous: string | undefined,
  current: string | undefined,
): readonly ReconciliationRecord[] => {
  if (current === undefined) return [];
  if (previous === current) return [];

  return [
    {
      payrollRunId: input.runId,
      employmentId: input.employmentId,
      staleSource,
      ...(previous === undefined ? {} : { previousDigest: previous.slice(0, 16) }),
      currentDigest: current.slice(0, 16),
      detectedAt: input.moment,
    },
  ];
};

const record = (
  dependencies: PayrollDependencies,
  context: Context,
  found: readonly ReconciliationRecord[],
): Promise<ReturnType<typeof success<RunReconciled>>> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const employments = [...new Set(found.map((record) => record.employmentId))];

    if (found.length === 0) {
      return success({
        payrollRunId: context.run.payrollRunId,
        status: context.run.status,
        staleEmployments: [],
      });
    }

    await dependencies.stores.reconciliations.insertMany(transaction, found);
    return staled(dependencies, transaction, context, employments);
  });

const staled = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  context: Context,
  employments: readonly string[],
): Promise<ReturnType<typeof success<RunReconciled>>> => {
  const run = await dependencies.stores.runs.byId(transaction, context.run.payrollRunId);

  if (run === undefined) return conflicted<RunReconciled>('run_not_found');
  if (run.status === 'stale') {
    return success({
      payrollRunId: run.payrollRunId,
      status: run.status,
      staleEmployments: employments,
    });
  }

  const marked = markRunStale(run, employments.length, dependencies.clock.now());

  if (!marked.ok) return refusedBy<RunReconciled>(marked.error);

  await dependencies.stores.runs.update(transaction, marked.value, run.version);
  transaction.collect([
    payrollEvent(
      PayrollEvents.stale,
      { aggregateType: 'payroll-run', aggregateId: run.payrollRunId },
      { payrollRunId: run.payrollRunId, staleCount: employments.length },
      originOfCurrentRequest(),
      dependencies.clock.now(),
    ),
  ]);
  return success({
    payrollRunId: run.payrollRunId,
    status: marked.value.status,
    staleEmployments: employments,
  });
};
