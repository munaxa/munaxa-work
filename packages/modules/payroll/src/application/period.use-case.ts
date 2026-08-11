import { success, uuidV7, type Command, type CommandHandler } from '@work/kernel';

import { createPayrollPeriod, movePeriodTo } from '../domain/payroll-period.js';
import { PERIOD_STATUSES, type PeriodStatus } from '../domain/payroll-vocabulary.js';
import { conflicted, currentActor, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Opening a payroll period, and moving it through its lifecycle.
 *
 * The overlap rule is **not checked here**. Two administrators creating June concurrently both read
 * before either writes, so a read-then-check would let both through; the GiST exclusion constraint
 * settles it and the `23P01` is translated into a named refusal. This is the Phase 10 lesson,
 * applied where it matters more.
 *
 * Transitions are checked against a **table**, not a chain of conditions, and a refusal names both
 * ends — "cannot move from approved to calculating" is a sentence an administrator can act on.
 */

export interface OpenPayrollPeriodCommand extends Command {
  readonly commandName: 'payroll.open-period';
  readonly payrollGroupId: string;
  readonly code: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paymentDate: string;
}

export interface PeriodOpened {
  readonly payrollPeriodId: string;
}

export const openPayrollPeriodHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<OpenPayrollPeriodCommand, PeriodOpened> => ({
  commandName: 'payroll.open-period',
  permission: PayrollPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const group = await dependencies.stores.groups.byId(transaction, command.payrollGroupId);

      if (group === undefined) return conflicted<PeriodOpened>('group_not_found');
      if (!group.active) return conflicted<PeriodOpened>('group_inactive');

      const created = createPayrollPeriod({ ...command, payrollPeriodId: uuidV7() });

      if (!created.ok) return refusedBy<PeriodOpened>(created.error);

      try {
        await dependencies.stores.periods.insert(transaction, created.value);
      } catch (error) {
        if (isExclusionViolation(error)) return conflicted<PeriodOpened>('period_overlaps');
        if (isUniqueViolation(error)) return conflicted<PeriodOpened>('period_code_taken');
        throw error;
      }

      return success({ payrollPeriodId: created.value.payrollPeriodId });
    }),
});

export interface MovePeriodCommand extends Command {
  readonly commandName: 'payroll.move-period';
  readonly payrollPeriodId: string;
  readonly status: string;
  readonly expectedVersion: number;
}

export interface PeriodMoved {
  readonly status: string;
}

export const movePeriodHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<MovePeriodCommand, PeriodMoved> => ({
  commandName: 'payroll.move-period',
  permission: PayrollPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const period = await dependencies.stores.periods.byId(transaction, command.payrollPeriodId);

      if (period === undefined) return conflicted<PeriodMoved>('period_not_found');
      if (!isPeriodStatus(command.status)) return conflicted<PeriodMoved>('period_status_unknown');

      const moved = movePeriodTo(
        period,
        command.status,
        dependencies.clock.now(),
        currentActor(),
        command.expectedVersion,
      );

      if (!moved.ok) return refusedBy<PeriodMoved>(moved.error);

      await dependencies.stores.periods.update(transaction, moved.value, command.expectedVersion);
      return success({ status: moved.value.status });
    }),
});

const isPeriodStatus = (value: string): value is PeriodStatus =>
  (PERIOD_STATUSES as readonly string[]).includes(value);

/**
 * The two SQLSTATEs this module translates, recognised without importing the driver.
 *
 * `23P01` is the exclusion constraint — two overlapping periods for one group. `23505` is the
 * unique index — the same period code twice. Both are ordinary business outcomes of a race, and
 * neither should reach a caller as a five-hundred.
 */
export const isExclusionViolation = (error: unknown): boolean => sqlStateOf(error) === '23P01';
export const isUniqueViolation = (error: unknown): boolean => sqlStateOf(error) === '23505';

const sqlStateOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { readonly code: unknown }).code)
    : undefined;
