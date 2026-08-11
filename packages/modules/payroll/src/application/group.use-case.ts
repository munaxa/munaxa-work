import {
  success,
  uuidV7,
  type Command,
  type CommandHandler,
  type RuleDefinition,
} from '@work/kernel';

import { amendPayrollGroup, definePayrollGroup } from '../domain/payroll-group.js';
import { checkedMoney, type MoneyInput } from '../domain/money-amount.js';
import {
  isCode,
  isDeductionBasis,
  isDeductionSource,
  isRoundingMode,
} from '../domain/payroll-vocabulary.js';
import { refuse, type PayrollResult } from '../domain/payroll-rejection.js';
import type { DeductionDefinitionState } from '../domain/deductions.js';
import { conflicted, refusedBy } from './payroll-context.js';
import { PayrollPermissions } from './payroll-permissions.js';
import type { PayrollDependencies } from './payroll-dependencies.js';

/**
 * Configuring who is paid together, and what is deducted.
 *
 * A payroll group is the only place in this module where a jurisdictional anchor is chosen, and it
 * is chosen by naming a **legal entity** — ADR-0035 puts the country and the currency there rather
 * than on the tenant. Nothing else here knows what a country is.
 *
 * A deduction definition is generic in the strongest sense: a code, a treatment code, an amount or
 * a share of gross, a rounding mode and a priority. No rate, no threshold, no bracket and no
 * authority name (ADR-0067). A definition whose `deductionSource` is `statutory`, `benefit` or
 * `loan_advance` may be *declared* — the classification is reserved — but nothing in this phase
 * produces a line from one.
 */

export interface DefinePayrollGroupCommand extends Command {
  readonly commandName: 'payroll.define-group';
  readonly legalEntityId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly payFrequency: string;
  readonly permittedCurrencies: readonly { readonly code: string; readonly exponent: number }[];
  readonly prorationBasis: string;
  readonly roundingMode: string;
  readonly paysSuspended: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  readonly expenseAccount: string;
  readonly deductionAccount: string;
  readonly payableAccount: string;
  readonly paymentMethodCode: string;
}

export interface GroupDefined {
  readonly payrollGroupId: string;
}

export const definePayrollGroupHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<DefinePayrollGroupCommand, GroupDefined> => ({
  commandName: 'payroll.define-group',
  permission: PayrollPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const existing = await dependencies.stores.groups.byCode(transaction, command.code);

      if (existing !== undefined) return conflicted<GroupDefined>('group_code_taken');

      const defined = definePayrollGroup({ ...command, payrollGroupId: uuidV7() });

      if (!defined.ok) return refusedBy<GroupDefined>(defined.error);

      await dependencies.stores.groups.insert(transaction, defined.value);

      return success({ payrollGroupId: defined.value.payrollGroupId });
    }),
});

export interface AmendPayrollGroupCommand extends Command {
  readonly commandName: 'payroll.amend-group';
  readonly payrollGroupId: string;
  readonly name?: Readonly<Record<string, string>>;
  readonly prorationBasis?: string;
  readonly roundingMode?: string;
  readonly paysSuspended?: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly active?: boolean;
  readonly expectedVersion: number;
}

export interface GroupAmended {
  readonly eligibilityRuleVersion: number;
}

export const amendPayrollGroupHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<AmendPayrollGroupCommand, GroupAmended> => ({
  commandName: 'payroll.amend-group',
  permission: PayrollPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const group = await dependencies.stores.groups.byId(transaction, command.payrollGroupId);

      if (group === undefined) return conflicted<GroupAmended>('group_not_found');

      const amended = amendPayrollGroup(group, command);

      if (!amended.ok) return refusedBy<GroupAmended>(amended.error);

      await dependencies.stores.groups.update(transaction, amended.value, command.expectedVersion);
      return success({ eligibilityRuleVersion: amended.value.eligibilityRuleVersion });
    }),
});

export interface DefineDeductionCommand extends Command {
  readonly commandName: 'payroll.define-deduction';
  readonly payrollGroupId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly deductionSource: string;
  readonly payrollTreatmentCode: string;
  readonly basis: string;
  readonly fixedAmount?: MoneyInput;
  readonly basisPoints?: number;
  readonly roundingMode: string;
  readonly priority: number;
}

export interface DeductionDefined {
  readonly deductionDefinitionId: string;
}

export const defineDeductionHandler = (
  dependencies: PayrollDependencies,
): CommandHandler<DefineDeductionCommand, DeductionDefined> => ({
  commandName: 'payroll.define-deduction',
  permission: PayrollPermissions.manage,

  handle: async (command) =>
    dependencies.unitOfWork.execute(async (transaction) => {
      const group = await dependencies.stores.groups.byId(transaction, command.payrollGroupId);

      if (group === undefined) return conflicted<DeductionDefined>('group_not_found');

      const definition = checkedDefinition(command);

      if (!definition.ok) return refusedBy<DeductionDefined>(definition.error);

      await dependencies.stores.deductionDefinitions.insert(transaction, definition.value);
      return success({ deductionDefinitionId: definition.value.deductionDefinitionId });
    }),
});

/**
 * A checked deduction definition.
 *
 * The basis and its inputs must agree: a fixed amount needs a currency, a share needs basis points,
 * and a definition supplying neither cannot produce a figure. The database enforces the same pair
 * in a check constraint — this is the same rule where a developer meets it first.
 */
const checkedDefinition = (
  command: DefineDeductionCommand,
): PayrollResult<DeductionDefinitionState> => {
  if (!isCode(command.code)) return refuse('code_malformed', { code: command.code });
  if (!isDeductionSource(command.deductionSource)) {
    return refuse('deduction_source_unknown', { deductionSource: command.deductionSource });
  }
  if (!isDeductionBasis(command.basis)) return refuse('deduction_basis_unknown');
  if (!isRoundingMode(command.roundingMode)) {
    return refuse('rounding_mode_unknown', { rounding: command.roundingMode });
  }
  if (!Number.isInteger(command.priority) || command.priority < 0 || command.priority > 999) {
    return refuse('deduction_priority_out_of_range');
  }

  const amount = checkedFixedAmount(command);

  if (!amount.ok) return amount;

  return {
    ok: true,
    value: {
      deductionDefinitionId: uuidV7(),
      payrollGroupId: command.payrollGroupId,
      code: command.code,
      name: command.name,
      deductionSource: command.deductionSource,
      payrollTreatmentCode: command.payrollTreatmentCode,
      basis: command.basis,
      ...amount.value,
      roundingMode: command.roundingMode,
      priority: command.priority,
      active: true,
      version: 1,
    },
  };
};

type AmountFields = Pick<DeductionDefinitionState, 'fixedAmount' | 'basisPoints'>;

const checkedFixedAmount = (command: DefineDeductionCommand): PayrollResult<AmountFields> => {
  if (command.basis === 'fixed_amount') {
    if (command.fixedAmount === undefined) {
      return refuse('deduction_amount_missing', { code: command.code });
    }

    const money = checkedMoney(command.fixedAmount, 'fixedAmount');

    return money.ok ? { ok: true, value: { fixedAmount: money.value } } : money;
  }

  if (command.basisPoints === undefined) {
    return refuse('deduction_basis_points_missing', { code: command.code });
  }
  return { ok: true, value: { basisPoints: command.basisPoints } };
};
