import type { RuleDefinition } from '@work/kernel';

import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import {
  isCode,
  isCurrencyCode,
  isPayFrequency,
  isProrationBasis,
  isRoundingMode,
  MAX_CURRENCY_EXPONENT,
  type PayFrequency,
  type ProrationBasis,
  type RoundingMode,
} from './payroll-vocabulary.js';

/**
 * A payroll group: **the population a run covers, and the policy it is calculated under**.
 *
 * The legal entity is mandatory and is the anchor for everything jurisdictional. ADR-0035 puts the
 * country and the currency on the legal entity rather than on the tenant, so a group spanning two
 * entities would span two countries and have no single statutory answer — which is why it cannot.
 *
 * A tenant may have several groups: monthly staff and weekly labourers in one entity, and a
 * separate set per entity. Nothing here assumes one payroll per tenant and nothing hardcodes a
 * cadence.
 *
 * **Membership is a rule, not a list.** A stored membership is a fourth copy of the workforce that
 * goes stale the moment somebody transfers; a rule evaluated against facts Employment publishes
 * cannot. The rule and its version are written into every input snapshot, so re-running a closed
 * period selects the people the rule selected *then* — which is what makes a historical population
 * reproducible (D-18).
 */

export interface PayrollGroupState {
  readonly payrollGroupId: string;
  readonly legalEntityId: string;
  readonly code: string;
  readonly name: Readonly<Record<string, string>>;
  readonly payFrequency: PayFrequency;
  /** The currencies this group pays in. A group permitting exactly one is the common case. */
  readonly permittedCurrencies: readonly string[];
  readonly currencyExponents: Readonly<Record<string, number>>;
  readonly prorationBasis: ProrationBasis;
  readonly roundingMode: RoundingMode;
  /** Whether a suspended employment is paid. **No default** — it is a contract question (§54). */
  readonly paysSuspended: boolean;
  /** Membership, as data. Versioned, and snapshotted with every run. */
  readonly eligibilityRule?: RuleDefinition;
  readonly eligibilityRuleVersion: number;
  /** The country pack this group's statutory rules would come from. Nothing implements one. */
  readonly countryPackId?: string;
  readonly countryPackVersion?: number;
  /**
   * Opaque tenant-configured account codes, and the payment method a run's instructions name.
   *
   * **Payroll owns no chart of accounts** and no payment rail. These are strings a tenant supplies
   * so the accounting output and the payment instruction carry a reference a future Finance or
   * payment domain can resolve; nothing here interprets one (ADR-0067).
   */
  readonly expenseAccount: string;
  readonly deductionAccount: string;
  readonly payableAccount: string;
  readonly paymentMethodCode: string;
  readonly active: boolean;
  readonly version: number;
}

export interface DefinePayrollGroup {
  readonly payrollGroupId: string;
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

export const definePayrollGroup = (
  command: DefinePayrollGroup,
): PayrollResult<PayrollGroupState> => {
  if (!isCode(command.code)) return refuse('code_malformed', { code: command.code });
  if (!isPayFrequency(command.payFrequency)) {
    return refuse('pay_frequency_unknown', { payFrequency: command.payFrequency });
  }
  if (!isProrationBasis(command.prorationBasis)) {
    return refuse('proration_basis_unknown', { prorationBasis: command.prorationBasis });
  }
  if (!isRoundingMode(command.roundingMode)) {
    return refuse('rounding_mode_unknown', { rounding: command.roundingMode });
  }

  const currencies = checkedCurrencies(command.permittedCurrencies);

  if (!currencies.ok) return currencies;

  return accept({
    payrollGroupId: command.payrollGroupId,
    legalEntityId: command.legalEntityId,
    code: command.code,
    name: command.name,
    payFrequency: command.payFrequency,
    permittedCurrencies: currencies.value.codes,
    currencyExponents: currencies.value.exponents,
    prorationBasis: command.prorationBasis,
    roundingMode: command.roundingMode,
    paysSuspended: command.paysSuspended,
    ...(command.eligibilityRule === undefined ? {} : { eligibilityRule: command.eligibilityRule }),
    eligibilityRuleVersion: 1,
    ...(command.countryPackId === undefined ? {} : { countryPackId: command.countryPackId }),
    ...(command.countryPackVersion === undefined
      ? {}
      : { countryPackVersion: command.countryPackVersion }),
    expenseAccount: command.expenseAccount,
    deductionAccount: command.deductionAccount,
    payableAccount: command.payableAccount,
    paymentMethodCode: command.paymentMethodCode,
    active: true,
    version: 1,
  });
};

interface CheckedCurrencies {
  readonly codes: readonly string[];
  readonly exponents: Readonly<Record<string, number>>;
}

/**
 * The currencies a group pays in, each with its exponent stated.
 *
 * The exponent is required rather than looked up, for the reason ADR-0061 gives: nothing in this
 * repository publishes one, and a group assuming two decimal places would be wrong by a factor of
 * ten in Jordan, Kuwait, Bahrain and Oman.
 */
const checkedCurrencies = (
  input: readonly { readonly code: string; readonly exponent: number }[],
): PayrollResult<CheckedCurrencies> => {
  if (input.length === 0) return refuse('permitted_currencies_empty');

  const exponents: Record<string, number> = {};

  for (const currency of input) {
    if (!isCurrencyCode(currency.code)) {
      return refuse('currency_code_malformed', { currencyCode: currency.code });
    }
    if (
      !Number.isInteger(currency.exponent) ||
      currency.exponent < 0 ||
      currency.exponent > MAX_CURRENCY_EXPONENT
    ) {
      return refuse('currency_exponent_implausible', { currencyCode: currency.code });
    }
    if (exponents[currency.code] !== undefined) {
      return refuse('currency_duplicated', { currencyCode: currency.code });
    }
    exponents[currency.code] = currency.exponent;
  }

  return accept({ codes: input.map((currency) => currency.code), exponents });
};

/** Whether a group pays in a currency at all. A block in any other is a recorded exception. */
export const permitsCurrency = (group: PayrollGroupState, currencyCode: string): boolean =>
  group.permittedCurrencies.includes(currencyCode);

/**
 * Amending a group **advances the eligibility rule's version** whenever the rule itself changes.
 *
 * The version is what a historical snapshot names, so it must move when the rule moves and must not
 * move when only a display name does — otherwise every cosmetic edit would make old runs look as
 * though they were selected under different rules.
 */
export interface AmendPayrollGroup {
  readonly name?: Readonly<Record<string, string>>;
  readonly prorationBasis?: string;
  readonly roundingMode?: string;
  readonly paysSuspended?: boolean;
  readonly eligibilityRule?: RuleDefinition;
  readonly active?: boolean;
  readonly expectedVersion: number;
}

export const amendPayrollGroup = (
  state: PayrollGroupState,
  command: AmendPayrollGroup,
): PayrollResult<PayrollGroupState> => {
  if (state.version !== command.expectedVersion) return refuse('concurrent_modification');
  if (command.prorationBasis !== undefined && !isProrationBasis(command.prorationBasis)) {
    return refuse('proration_basis_unknown', { prorationBasis: command.prorationBasis });
  }
  if (command.roundingMode !== undefined && !isRoundingMode(command.roundingMode)) {
    return refuse('rounding_mode_unknown', { rounding: command.roundingMode });
  }

  return accept({
    ...state,
    ...supplied(command),
    eligibilityRuleVersion: state.eligibilityRuleVersion + (ruleChanged(state, command) ? 1 : 0),
    version: state.version + 1,
  });
};

/** The fields the command actually supplied. An absent key leaves the state's own value alone. */
const supplied = (command: AmendPayrollGroup): Partial<PayrollGroupState> => ({
  ...(command.name === undefined ? {} : { name: command.name }),
  ...(command.prorationBasis === undefined
    ? {}
    : { prorationBasis: command.prorationBasis as PayrollGroupState['prorationBasis'] }),
  ...(command.roundingMode === undefined
    ? {}
    : { roundingMode: command.roundingMode as PayrollGroupState['roundingMode'] }),
  ...(command.paysSuspended === undefined ? {} : { paysSuspended: command.paysSuspended }),
  ...(command.eligibilityRule === undefined ? {} : { eligibilityRule: command.eligibilityRule }),
  ...(command.active === undefined ? {} : { active: command.active }),
});

/**
 * Whether the rule itself moved, as opposed to a display name beside it.
 *
 * Compared by serialization rather than by reference because a rule arrives as data from an edge
 * and is never the same object twice. The comparison is what keeps the version honest: it must move
 * when the rule moves, and must not move when only a label does, or every cosmetic edit would make
 * old runs look as though they were selected under different rules.
 */
const ruleChanged = (state: PayrollGroupState, command: AmendPayrollGroup): boolean =>
  command.eligibilityRule !== undefined &&
  JSON.stringify(command.eligibilityRule) !== JSON.stringify(state.eligibilityRule);
