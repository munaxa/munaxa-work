import { success, uuidV7, type Command, type CommandHandler, type Transaction } from '@work/kernel';

import { accountingFor, paymentFor, wholeTo } from '../domain/payroll-outputs.js';
import { createPayrollRun, finalizeRun, reverseRun } from '../domain/payroll-run.js';
import { CALCULATION_VERSION } from '../domain/payroll-calculation.js';
import type { AccountingLine, PaymentInstruction } from '../domain/payroll-outputs.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollResultState } from '../domain/payroll-lines.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import { PayrollEvents, payrollEvent } from '../domain/payroll-events.js';
import { conflicted, currentActor, originOfCurrentRequest, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Finalization: **the strong boundary**, and the one operation in this module that is genuinely
 * irreversible in the ordinary sense.
 *
 * In one transaction it moves the run to `finalized`, stamps `finalized_at` across the snapshot,
 * the results and every line, and generates the accounting and payment outputs from the figures it
 * has just frozen. After it, the ordinary update path refuses (`where finalized_at is null`) and
 * the database trigger refuses (ADR-0066) — two mechanisms because the first protects the code that
 * remembers it and the second protects the table.
 *
 * A run carrying unresolved exceptions cannot be finalized, and neither can a stale one. Finalizing
 * is the statement that these are the figures to act on; making it over a known doubt would be
 * asserting something nobody established.
 *
 * The outputs are **prepared and nothing more**. `accountingPreparedAt` and `paymentPreparedAt`
 * exist; `posted` and `executed` do not, because nothing in this repository posts a journal or
 * moves money (ADR-0067).
 */

export interface FinalizeRunCommand extends Command {
  readonly commandName: 'payroll.finalize';
  readonly payrollRunId: string;
}

export interface RunFinalized {
  readonly payrollRunId: string;
  readonly accountingLines: number;
  readonly paymentInstructions: number;
}

export const finalizeRunHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<FinalizeRunCommand, RunFinalized> => ({
  commandName: 'payroll.finalize',
  permission: PayrollPermissions.finalize,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const context = await load(dependencies, transaction, command.payrollRunId);

      if (context === undefined) return conflicted<RunFinalized>('run_not_found');

      const finalized = finalizeRun(context.run, dependencies.clock.now(), currentActor());

      if (!finalized.ok) return refusedBy<RunFinalized>(finalized.error);

      const outputs = await generate(dependencies, transaction, context);

      if (!outputs.ok) return refusedBy<RunFinalized>(outputs.error);

      await dependencies.stores.accounting.insertMany(transaction, outputs.accounting);
      await dependencies.stores.payments.insertMany(transaction, outputs.payments);
      await dependencies.stores.runs.update(transaction, finalized.value, context.run.version);
      // Last, because it is what makes every row above immutable: after this the trigger refuses.
      await dependencies.stores.runs.finalize(
        transaction,
        context.run.payrollRunId,
        dependencies.clock.now(),
      );

      transaction.collect([
        payrollEvent(
          PayrollEvents.finalized,
          { aggregateType: 'payroll-run', aggregateId: context.run.payrollRunId },
          {
            payrollRunId: context.run.payrollRunId,
            payrollPeriodId: context.run.payrollPeriodId,
            resultCount: context.results.length,
          },
          originOfCurrentRequest(),
          dependencies.clock.now(),
        ),
      ]);

      return success({
        payrollRunId: context.run.payrollRunId,
        accountingLines: outputs.accounting.length,
        paymentInstructions: outputs.payments.length,
      });
    }),
});

interface Context {
  readonly run: PayrollRunState;
  readonly period: PayrollPeriodState;
  readonly group: PayrollGroupState;
  readonly results: readonly PayrollResultState[];
}

const load = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  payrollRunId: string,
): Promise<Context | undefined> => {
  const run = await dependencies.stores.runs.byId(transaction, payrollRunId);

  if (run === undefined) return undefined;

  const period = await dependencies.stores.periods.byId(transaction, run.payrollPeriodId);
  const group = await dependencies.stores.groups.byId(transaction, run.payrollGroupId);

  if (period === undefined || group === undefined) return undefined;

  const page = await dependencies.stores.results.forRun(transaction, payrollRunId, {
    limit: MAX_FINALIZED_RESULTS,
    offset: 0,
  });

  return { run, period, group, results: page.items };
};

/** Bounded, and generous: a run larger than this finalizes in pages a later phase can add. */
const MAX_FINALIZED_RESULTS = 100_000;

type Generated =
  | {
      readonly ok: true;
      readonly accounting: readonly AccountingLine[];
      readonly payments: readonly PaymentInstruction[];
    }
  | {
      readonly ok: false;
      readonly error: { readonly reason: string; readonly messageKey: string };
    };

/**
 * The two outputs, generated from the frozen figures.
 *
 * Cost allocation reads the **snapshot's** employment facts rather than Employment's current ones,
 * so a period that closed in March allocates to March's cost centre. Where the snapshot records no
 * cost centre the line carries none: Payroll retains the identifier it was given and **fabricates
 * no label or code** (D-17).
 */
const generate = async (
  dependencies: PayrollDependencies,
  transaction: Transaction,
  context: Context,
): Promise<Generated> => {
  const accounting: AccountingLine[] = [];
  const payments: PaymentInstruction[] = [];

  for (const result of context.results) {
    const snapshot = await dependencies.stores.snapshots.forEmployment(
      transaction,
      context.run.payrollRunId,
      result.employmentId,
    );
    const centre = snapshot?.employment?.costCenterId;
    const unit = snapshot?.employment?.unitId;
    const lines = accountingFor({
      result,
      allocations:
        centre === undefined
          ? [{ costCenterId: UNALLOCATED, basisPoints: 10_000 }]
          : wholeTo(centre, unit),
      expenseAccount: context.group.expenseAccount,
      deductionAccount: context.group.deductionAccount,
      payableAccount: context.group.payableAccount,
      journalReference: `${context.run.payrollRunId}:${context.period.code}`,
      identifier: () => uuidV7(),
    });

    if (!lines.ok) return { ok: false, error: lines.error };

    accounting.push(...lines.value);
    payments.push(
      paymentFor({
        result,
        paymentDate: context.period.paymentDate,
        paymentMethodCode: context.group.paymentMethodCode,
        paymentInstructionId: uuidV7(),
        paymentReference: `${context.period.code}:${result.payrollResultId}`,
      }),
    );
  }

  return { ok: true, accounting, payments };
};

/**
 * The cost centre for an employment that has none.
 *
 * A sentinel rather than a guess. An employment with no cost centre is a real configuration gap,
 * and allocating its cost to a parent unit Payroll picked would be inventing an accounting fact.
 * The reconciliation exception `cost_centre_missing` is what surfaces it to a human.
 */
const UNALLOCATED = '00000000-0000-0000-0000-000000000000';

export interface ReverseRunCommand extends Command {
  readonly commandName: 'payroll.reverse-run';
  readonly payrollRunId: string;
  readonly reasonCode: string;
}

export interface RunReversed {
  readonly reversalRunId: string;
}

/**
 * A reversal creates a **new run** referencing the original.
 *
 * The original run, its results, its lines and its snapshot are untouched — the trigger would
 * refuse anything else. The reversal's own results are produced by recalculating with negated
 * lines, which is a later step; what this command establishes is the auditable fact that the
 * original was reversed, by whom, and under which new run.
 *
 * Accounting and payment outputs of a reversed run are **not deleted**. They may already have left
 * the system, and a row deleted here would not unsend them.
 */
export const reverseRunHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<ReverseRunCommand, RunReversed> => ({
  commandName: 'payroll.reverse-run',
  permission: PayrollPermissions.reverse,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const run = await dependencies.stores.runs.byId(transaction, command.payrollRunId);

      if (run === undefined) return conflicted<RunReversed>('run_not_found');

      const reversed = reverseRun(run, dependencies.clock.now(), currentActor());

      if (!reversed.ok) return refusedBy<RunReversed>(reversed.error);

      const existing = await dependencies.stores.runs.forPeriod(transaction, run.payrollPeriodId);
      const reversal = createPayrollRun({
        payrollRunId: uuidV7(),
        payrollPeriodId: run.payrollPeriodId,
        payrollGroupId: run.payrollGroupId,
        runSequence: existing.length + 1,
        runKind: 'reversal',
        calculationVersion: CALCULATION_VERSION,
        ruleSetDigest: run.ruleSetDigest,
        eligibilityRuleVersion: run.eligibilityRuleVersion,
        reversalOfRunId: run.payrollRunId,
      });

      await dependencies.stores.runs.insert(transaction, reversal);
      await dependencies.stores.runs.update(transaction, reversed.value, run.version);

      return success({ reversalRunId: reversal.payrollRunId });
    }),
});
