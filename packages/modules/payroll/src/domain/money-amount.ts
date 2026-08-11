import { Money, type Currency } from '@work/kernel';

import { accept, refuse, type PayrollResult } from './payroll-rejection.js';
import {
  BASIS_POINT_SCALE,
  MAX_BASIS_POINTS,
  MAX_CURRENCY_EXPONENT,
  isCurrencyCode,
  isRoundingMode,
  type RoundingMode,
} from './payroll-vocabulary.js';

/**
 * A monetary amount as this module stores and publishes it — the same three fields Compensation
 * settled on in ADR-0061, restated here rather than imported.
 *
 * Restated deliberately. Payroll depends on Compensation through a **published contract**, not
 * through its domain, and a shared domain type would be a second coupling that no published view
 * requires. The two shapes are identical by design and by ADR, which is the level at which they are
 * meant to agree.
 *
 * **`amountMinor` is a `bigint`** because binary floating point cannot represent 0.1, and a gross
 * accumulated in `number` produces payslips wrong by fractions. **`currencyExponent` travels on
 * every amount** because nothing in this repository publishes one and two decimal places is a habit
 * rather than a rule — JOD, KWD, BHD and OMR all have three.
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
  /** The same amount as a decimal, for display — `"250.000"`. Derived, never authoritative. */
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

export const zeroLike = (amount: MoneyAmount): MoneyAmount => ({
  amountMinor: 0n,
  currencyCode: amount.currencyCode,
  currencyExponent: amount.currencyExponent,
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
export const checkedMoney = (input: MoneyInput, field: string): PayrollResult<MoneyAmount> => {
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

/** Two amounts are comparable only in the same currency. **Nothing here converts** (ADR-0067). */
export const sameCurrency = (left: MoneyAmount, right: MoneyAmount): boolean =>
  left.currencyCode === right.currencyCode && left.currencyExponent === right.currencyExponent;

/**
 * The sum of amounts **in one currency**.
 *
 * Returns `undefined` on a mismatch rather than throwing or converting, so the caller decides
 * whether that is a refusal or a recorded exception. Every caller in this module has already
 * grouped by currency, so a mismatch here is a defect and is treated as one — but it is a defect
 * that reports itself rather than producing a plausible wrong total.
 */
export const sumIn = (
  currency: { readonly currencyCode: string; readonly currencyExponent: number },
  amounts: readonly MoneyAmount[],
): MoneyAmount | undefined => {
  let total = 0n;

  for (const amount of amounts) {
    if (
      amount.currencyCode !== currency.currencyCode ||
      amount.currencyExponent !== currency.currencyExponent
    ) {
      return undefined;
    }
    total += amount.amountMinor;
  }

  return {
    amountMinor: total,
    currencyCode: currency.currencyCode,
    currencyExponent: currency.currencyExponent,
  };
};

/** `left − right`, in one currency. May be negative; the caller decides what that means. */
export const minus = (left: MoneyAmount, right: MoneyAmount): MoneyAmount | undefined =>
  sameCurrency(left, right)
    ? { ...left, amountMinor: left.amountMinor - right.amountMinor }
    : undefined;

/**
 * `amount × numerator ÷ denominator`, exactly, with the rounding mode stated.
 *
 * The one multiplication in this module, and every proration and every basis-point deduction goes
 * through it. `Money.multipliedBy` is exact integer arithmetic and takes **no default rounding** —
 * the caller knows whether a contract rounds half up or half to even, and guessing is how a payroll
 * ends up a fil out.
 */
export const scaled = (
  amount: MoneyAmount,
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode,
): PayrollResult<MoneyAmount> => {
  if (denominator <= 0n) return refuse('proration_denominator_invalid');
  if (numerator < 0n) return refuse('proration_numerator_invalid');
  if (!isRoundingMode(rounding)) return refuse('rounding_mode_unknown', { rounding });

  return accept(fromMoney(toMoney(amount).multipliedBy(numerator, denominator, rounding)));
};

/** A share of an amount in basis points — 2.5% is `250`. Exact, with the mode stated. */
export const basisPointsOf = (
  amount: MoneyAmount,
  basisPoints: number,
  rounding: RoundingMode,
): PayrollResult<MoneyAmount> => {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_BASIS_POINTS) {
    return refuse('basis_points_out_of_range', { basisPoints: String(basisPoints) });
  }

  return scaled(amount, BigInt(basisPoints), BASIS_POINT_SCALE, rounding);
};

/**
 * A split of an amount into **weighted** parts that sums back to the whole.
 *
 * The kernel's `Money.allocate` splits into *equal* parts, which is not what a cost-centre split
 * needs — 60/40 is a weighting, not two halves. So the weighted case is implemented here, with the
 * same discipline: each part gets the floor of its exact share, and the remaining minor units are
 * handed out one at a time in descending order of the remainder each part gave up.
 *
 * That last clause is the whole point. Rounding each share independently loses or invents minor
 * units, and a cost allocation that does not sum back to the amount produces a journal that does
 * not balance — which is caught in production, by an accountant, months later.
 */
export const allocated = (
  amount: MoneyAmount,
  weights: readonly number[],
): PayrollResult<readonly MoneyAmount[]> => {
  if (weights.length === 0) return refuse('allocation_weights_empty');
  if (weights.some((weight) => !Number.isInteger(weight) || weight < 0)) {
    return refuse('allocation_weight_invalid');
  }

  const total = weights.reduce((sum, weight) => sum + BigInt(weight), 0n);

  if (total === 0n) return refuse('allocation_weights_empty');

  const shares = weights.map((weight) => (amount.amountMinor * BigInt(weight)) / total);
  const remainders = weights.map(
    (weight, index) => amount.amountMinor * BigInt(weight) - (shares[index] ?? 0n) * total,
  );

  return accept(withRemainderDistributed(amount, shares, remainders));
};

/** Hands the leftover minor units to the parts that gave up most, one each, largest first. */
const withRemainderDistributed = (
  amount: MoneyAmount,
  shares: readonly bigint[],
  remainders: readonly bigint[],
): readonly MoneyAmount[] => {
  const allocatedSoFar = shares.reduce((sum, share) => sum + share, 0n);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((left, right) =>
      right.remainder === left.remainder ? 0 : right.remainder > left.remainder ? 1 : -1,
    );
  const final = [...shares];
  let left = amount.amountMinor - allocatedSoFar;

  for (const { index } of order) {
    if (left <= 0n) break;
    final[index] = (final[index] ?? 0n) + 1n;
    left -= 1n;
  }

  return final.map((minorUnits) => ({ ...amount, amountMinor: minorUnits }));
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
