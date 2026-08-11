import { Money, type Currency } from '@work/kernel';

import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import {
  BASIS_POINT_SCALE,
  MAX_BASIS_POINTS,
  MAX_CURRENCY_EXPONENT,
  isCurrencyCode,
  isRoundingMode,
  type RoundingMode,
} from './compensation-vocabulary.js';

/**
 * A monetary amount as this module stores and publishes it.
 *
 * Three fields, and each earns its place. **`amountMinor` is a `bigint`** because binary floating
 * point cannot represent 0.1 and a salary accumulated in `number` produces payslips wrong by
 * fractions. **`currencyCode`** because an amount without one is not a quantity. **`currencyExponent`
 * because nothing in this repository publishes it** — `legal_entity.currency_code` is a bare ISO
 * 4217 code, and a module assuming two decimal places would be wrong by a factor of ten in Kuwait,
 * Bahrain and Oman (D-2).
 *
 * The exponent travels *on every row* rather than being normalised into a currency table. That is
 * unusual and is deliberate for one reason: a compensation record must stay exactly reconstructable
 * years later, and a join to a table somebody can revise is a dependency a historical figure should
 * not have.
 *
 * `Money` is the kernel's and is used for every calculation. This is the *persisted and published*
 * shape; the two convert in one function each, so nothing in this module does monetary arithmetic
 * by hand.
 */
export interface MoneyAmount {
  readonly amountMinor: bigint;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

/** The wire and storage form: a **decimal string**, never a JSON number. */
export interface MoneyAmountView {
  /** Exact minor units as a decimal string — `"250000"`. A JSON number loses precision above 2^53. */
  readonly amountMinor: string;
  /** The same amount as a decimal, for display — `"2500.00"`. Derived, never authoritative. */
  readonly amount: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

export const currencyOf = (amount: MoneyAmount): Currency => ({
  code: amount.currencyCode,
  exponent: amount.currencyExponent,
});

export const toMoney = (amount: MoneyAmount): Money =>
  Money.of(amount.amountMinor, currencyOf(amount));

export const fromMoney = (money: Money): MoneyAmount => ({
  amountMinor: money.minorUnits,
  currencyCode: money.currency.code,
  currencyExponent: money.currency.exponent,
});

/** What a caller may hand in: minor units as a decimal string, plus the currency's two facts. */
export interface MoneyInput {
  readonly amountMinor: string;
  readonly currencyCode: string;
  readonly currencyExponent: number;
}

/**
 * A checked monetary input.
 *
 * The amount arrives as a **string** and is parsed with `BigInt`, so a caller cannot lose precision
 * on the way in. A malformed one is refused by name rather than silently becoming `NaN` — and
 * `BigInt('')` is `0n`, which is exactly the kind of quiet wrong answer this refuses.
 */
export const checkedMoney = (input: MoneyInput, field: string): CompensationResult<MoneyAmount> => {
  if (!isCurrencyCode(input.currencyCode)) {
    return refuse('currency_code_malformed', { field, currencyCode: input.currencyCode });
  }
  if (
    !Number.isInteger(input.currencyExponent) ||
    input.currencyExponent < 0 ||
    input.currencyExponent > MAX_CURRENCY_EXPONENT
  ) {
    return refuse('currency_exponent_implausible', { field });
  }

  const minor = parsedMinorUnits(input.amountMinor);

  if (minor === undefined) return refuse('amount_malformed', { field });
  if (minor < 0n) return refuse('amount_negative', { field });

  return accept({
    amountMinor: minor,
    currencyCode: input.currencyCode,
    currencyExponent: input.currencyExponent,
  });
};

/** Whole minor units, or nothing. Rejects a decimal point, a sign trick and an empty string. */
const parsedMinorUnits = (value: string): bigint | undefined => {
  const trimmed = value.trim();

  if (!/^-?\d+$/.test(trimmed)) return undefined;
  return BigInt(trimmed);
};

/** Two amounts are comparable only in the same currency. Nothing here converts (§20.4). */
export const sameCurrency = (left: MoneyAmount, right: MoneyAmount): boolean =>
  left.currencyCode === right.currencyCode && left.currencyExponent === right.currencyExponent;

export const isWithinRange = (
  amount: MoneyAmount,
  range: { readonly minimum: MoneyAmount; readonly maximum: MoneyAmount },
): boolean =>
  sameCurrency(amount, range.minimum) &&
  amount.amountMinor >= range.minimum.amountMinor &&
  amount.amountMinor <= range.maximum.amountMinor;

/**
 * A percentage of another component's amount, resolved exactly.
 *
 * `Money.multipliedBy(basisPoints, 10_000n, rounding)` — integer arithmetic throughout, with the
 * rounding mode taken from the component definition rather than defaulted. The result carries the
 * **basis's** currency, which is why a cross-currency basis is refused above rather than converted:
 * 40% of an amount in another currency is not a quantity this module can produce (§20.4).
 */
export const resolvePercentage = (
  basis: MoneyAmount,
  basisPoints: number,
  rounding: RoundingMode,
): CompensationResult<MoneyAmount> => {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_BASIS_POINTS) {
    return refuse('basis_points_out_of_range', { basisPoints: String(basisPoints) });
  }
  if (!isRoundingMode(rounding)) return refuse('rounding_mode_unknown', { rounding });

  const resolved = toMoney(basis).multipliedBy(BigInt(basisPoints), BASIS_POINT_SCALE, rounding);

  return accept(fromMoney(resolved));
};

/**
 * The published form of an amount.
 *
 * Both representations are given: `amountMinor` is authoritative and exact, `amount` is the decimal
 * a screen renders. A consumer that needs to compute uses the first; one that needs to display uses
 * the second, and neither has to know the exponent to get it right.
 */
export const moneyView = (amount: MoneyAmount): MoneyAmountView => ({
  amountMinor: amount.amountMinor.toString(),
  amount: toMoney(amount).toString(),
  currencyCode: amount.currencyCode,
  currencyExponent: amount.currencyExponent,
});
