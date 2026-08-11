import { accept, refuse, type CompensationResult } from '../domain/compensation-rejection.js';
import {
  moneyView,
  resolvePercentage,
  sameCurrency,
  type MoneyAmount,
} from '../domain/money-amount.js';
import {
  chainIsCircular,
  type CompensationComponentState,
} from '../domain/compensation-component.js';
import { inForceOn, type RecurringState } from '../domain/recurring.js';
import type { PercentageResolutionView } from '../contracts/views.js';

/**
 * Resolving a percentage-of-component allowance — 40% of a basic salary — exactly.
 *
 * **Compensation resolves it, and publishes both the figure and the rule** (D-3). The alternative
 * — publishing only the rule and letting each consumer resolve it — means an HR screen and Payroll
 * each apply a rounding mode, and the two disagree by a fil on somebody's payslip. One resolver,
 * one answer, and the rule travels alongside so the working is checkable.
 *
 * Three things are refused rather than guessed:
 *
 * - **A missing basis.** If the employment has no active record of the basis component on the
 *   date, the allowance has no value. Resolving it to zero would put "no housing allowance" and
 *   "housing allowance of nothing" into the same answer, and only one of those is true.
 * - **A cross-currency basis.** 40% of an amount in another currency is not a quantity this module
 *   can produce without converting, and nothing here converts (§20.4).
 * - **A circular chain.** A component whose basis chain returns to itself has no value and would
 *   loop. Refused at definition time as well; this is the second line.
 */

export interface ResolvedAmount {
  readonly amount: MoneyAmount;
  readonly resolvedFrom: PercentageResolutionView;
}

/**
 * The amount a percentage component is worth for one employment on one date.
 *
 * `records` is that employment's recurring compensation — the caller has already read it, and
 * passing it in keeps this a pure function that a test can drive without a database.
 */
export const resolvedPercentageAmount = (
  component: CompensationComponentState,
  records: readonly RecurringState[],
  components: readonly CompensationComponentState[],
  onDate: string,
): CompensationResult<ResolvedAmount> => {
  const { basisComponentId, percentageBasisPoints } = component;

  if (basisComponentId === undefined || percentageBasisPoints === undefined) {
    return refuse('percentage_requires_a_basis', { componentId: component.id });
  }
  if (chainIsCircular(component, components)) {
    return refuse('component_basis_is_circular', { componentId: component.id });
  }

  const basisRecord = records.find(
    (record) => record.componentId === basisComponentId && inForceOn(record, onDate),
  );

  if (basisRecord === undefined) {
    return refuse('percentage_basis_not_assigned', { componentId: component.id, onDate });
  }

  const resolved = resolvePercentage(
    basisRecord.amount,
    percentageBasisPoints,
    component.roundingMode,
  );

  if (!resolved.ok) return resolved;

  return accept({
    amount: resolved.value,
    resolvedFrom: {
      basisComponentId,
      percentageBasisPoints,
      roundingMode: component.roundingMode,
      basisAmount: moneyView(basisRecord.amount),
    },
  });
};

/**
 * Whether a percentage component's basis is in the same currency as the amount being assigned.
 *
 * Checked at assignment time so the configuration is refused when somebody makes it, rather than
 * when a payroll run three months later cannot produce a figure.
 */
export const basisCurrencyAgrees = (
  amount: MoneyAmount,
  basis: MoneyAmount,
): CompensationResult<void> =>
  sameCurrency(amount, basis)
    ? accept(undefined)
    : refuse('percentage_basis_currency_mismatch', {
        currencyCode: amount.currencyCode,
        basisCurrencyCode: basis.currencyCode,
      });

/**
 * The resolution a published view carries for a record whose amount came from a percentage.
 *
 * Reads the *stored* basis points rather than the component's current ones: the record is
 * authoritative, and a component revised since would otherwise restate what a historical figure was
 * a percentage of.
 */
export const resolutionOf = (
  record: RecurringState,
  roundingMode: string,
  basisAmount: MoneyAmount | undefined,
): PercentageResolutionView | undefined => {
  if (
    record.basisComponentId === undefined ||
    record.percentageBasisPoints === undefined ||
    basisAmount === undefined
  ) {
    return undefined;
  }
  return {
    basisComponentId: record.basisComponentId,
    percentageBasisPoints: record.percentageBasisPoints,
    roundingMode,
    basisAmount: moneyView(basisAmount),
  };
};
