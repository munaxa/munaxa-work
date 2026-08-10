import { uuidV7, type CommandHandler, type Transaction } from '@work/kernel';

import { digestOf } from '../domain/digest.js';
import { drive } from './calculation-driver.js';
import type { CalculateRunCommand, RunCalculated, RunContext } from './calculation-contract.js';
import { CALCULATION_VERSION } from '../domain/payroll-calculation.js';
import { createPayrollRun } from '../domain/payroll-run.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type { PayrollRunState } from '../domain/payroll-run.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import { conflicted } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Calculating a run: **bounded batches, a resumable cursor, and no tenant in memory**.
 *
 * A hundred-thousand-employee run is two hundred transactions rather than one. Each batch reads its
 * four sources once, calculates purely, and writes its rows in four multi-row inserts; the cursor
 * on the run says where the next batch resumes. A crash at employee sixty thousand leaves sixty
 * thousand results committed and a cursor pointing at the next one — no duplicates, because the
 * result's unique index is the idempotency key, and no restart.
 *
 * **A run whose cursor has not reached the end is not `calculated`**, so a partial run cannot be
 * approved. That invariant lives in `completeCalculation` rather than here, because an invariant
 * enforced in one place cannot be forgotten in another.
 *
 * Recalculation is the same code with a narrower population: reconciliation names which employments
 * went stale, and only those are recomputed (D-14). An unaffected result is never touched.
 */

export const calculateRunHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<CalculateRunCommand, RunCalculated> => ({
  commandName: 'payroll.calculate',
  permission: PayrollPermissions.calculate,

  handle: async (command) => {
    const prepared = await prepare(dependencies, command);

    if (!prepared.ok) return prepared.failure;

    return drive(dependencies, command, prepared.context);
  },
});

type Prepared =
  | { readonly ok: true; readonly context: RunContext }
  | { readonly ok: false; readonly failure: ReturnType<typeof conflicted<RunCalculated>> };

/**
 * The run, its period, its group and its rules — resolved once, in their own transaction.
 *
 * The country code comes from Organization's published legal-entity read, and **`known: false` is
 * a refusal** rather than "no country": calculating a workforce under no statutory rules because
 * Organization was briefly unreachable would be silently wrong (ADR-0056).
 */
const prepare = async (
  dependencies: PayrollDependencies,
  command: CalculateRunCommand,
): Promise<Prepared> =>
  dependencies.unitOfWork.execute(async (transaction) => {
    const period = await dependencies.stores.periods.byId(transaction, command.payrollPeriodId);

    if (period === undefined) return refused('period_not_found');
    if (period.status !== 'open' && period.status !== 'calculating') {
      return refused('period_not_open');
    }

    const group = await dependencies.stores.groups.byId(transaction, period.payrollGroupId);

    if (group === undefined) return refused('group_not_found');

    const entity = await dependencies.organization.legalEntity(group.legalEntityId);

    if (!entity.known) return refused('organization_unavailable');

    const definitions = await dependencies.stores.deductionDefinitions.forGroup(
      transaction,
      group.payrollGroupId,
    );
    const run = await runFor(dependencies, { transaction, command, period, group, definitions });

    if (run === undefined) return refused('run_not_found');

    return {
      ok: true,
      context: {
        period,
        group,
        definitions,
        run,
        ...(entity.entity === undefined ? {} : { countryCode: entity.entity.countryCode }),
      },
    };
  });

const refused = (reason: string): Prepared => ({ ok: false, failure: conflicted(reason) });

/**
 * The existing run, or a new one.
 *
 * The `payroll_run_active_idx` partial unique index permits **one non-terminal run per period**, so
 * two concurrent calculation commands cannot both create one — the loser is refused rather than
 * silently forking the period into two payrolls.
 */
interface RunRequest {
  readonly transaction: Transaction;
  readonly command: CalculateRunCommand;
  readonly period: PayrollPeriodState;
  readonly group: PayrollGroupState;
  readonly definitions: readonly DeductionDefinitionState[];
}

const runFor = async (
  dependencies: PayrollDependencies,
  request: RunRequest,
): Promise<PayrollRunState | undefined> => {
  const { transaction, command, period, group, definitions } = request;

  if (command.payrollRunId !== undefined) {
    return dependencies.stores.runs.byId(transaction, command.payrollRunId);
  }

  const existing = await dependencies.stores.runs.forPeriod(transaction, period.payrollPeriodId);
  const created = createPayrollRun({
    payrollRunId: uuidV7(),
    payrollPeriodId: period.payrollPeriodId,
    payrollGroupId: group.payrollGroupId,
    runSequence: existing.length + 1,
    runKind: existing.some((run) => run.status === 'finalized') ? 'correction' : 'regular',
    calculationVersion: CALCULATION_VERSION,
    ruleSetDigest: ruleSetDigestOf(group, definitions),
    eligibilityRuleVersion: group.eligibilityRuleVersion,
    ...(group.countryPackId === undefined ? {} : { countryPackId: group.countryPackId }),
    ...(group.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: group.countryPackVersion }),
  });

  await dependencies.stores.runs.insert(transaction, created);
  return created;
};

/**
 * The digest that catches what a version number misses.
 *
 * The code did not change and the calculation version is the same, but a tenant edited a deduction
 * definition between two runs. Without this the difference is invisible; with it, it is a stale
 * marker (D-10).
 */
export const ruleSetDigestOf = (
  group: PayrollGroupState,
  definitions: readonly DeductionDefinitionState[],
): string =>
  digestOf([
    group.prorationBasis,
    group.roundingMode,
    String(group.paysSuspended),
    String(group.eligibilityRuleVersion),
    group.countryPackId ?? 'none',
    String(group.countryPackVersion ?? 0),
    ...[...definitions]
      .map(
        (definition) =>
          `${definition.code}:${definition.basis}:${definition.basisPoints ?? ''}:${
            definition.fixedAmount?.amountMinor ?? ''
          }:${definition.roundingMode}:${definition.priority}:${String(definition.active)}`,
      )
      .sort(),
  ]);
