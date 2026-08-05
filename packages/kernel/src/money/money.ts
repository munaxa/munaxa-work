import { DomainException } from '../errors/domain-exception.js';

/**
 * Money, as integer minor units.
 *
 * Payroll is the reason this is not a `number`. Binary floating point cannot represent 0.1, so
 * accumulating allowances and deductions in `number` produces payslips that are wrong by
 * fractions and journals that do not balance. Minor units in `bigint` are exact.
 *
 * The currency's exponent is supplied, never assumed. Two decimal places is a habit, not a rule:
 * the Kuwaiti dinar, the Bahraini dinar and the Omani rial all have three, and a system that
 * assumes two is wrong by a factor of ten in exactly the markets this product sells into.
 * Currencies come from configuration (ADR-0018), so nothing here is hardcoded.
 */

export interface Currency {
  readonly code: string;
  /** Decimal places. 2 for SAR, 3 for KWD, 0 for JPY. */
  readonly exponent: number;
}

export type Rounding = 'half-up' | 'half-even' | 'down' | 'up';

export class Money {
  private constructor(
    public readonly minorUnits: bigint,
    public readonly currency: Currency,
  ) {}

  public static of(minorUnits: bigint, currency: Currency): Money {
    if (!Number.isInteger(currency.exponent) || currency.exponent < 0 || currency.exponent > 4) {
      throw new DomainException(
        'money_invalid_currency',
        `Currency ${currency.code} has an implausible exponent ${String(currency.exponent)}.`,
      );
    }
    return new Money(minorUnits, currency);
  }

  public static zero(currency: Currency): Money {
    return new Money(0n, currency);
  }

  /**
   * Parses a decimal string exactly. A string, not a number: the moment an amount passes
   * through `number` the precision is already gone.
   */
  public static parse(amount: string, currency: Currency): Money {
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(amount.trim());

    if (match === null) {
      throw new DomainException('money_unparsable', `"${amount}" is not a decimal amount.`);
    }
    const [, sign, whole = '0', fraction = ''] = match;

    if (fraction.length > currency.exponent) {
      throw new DomainException(
        'money_too_precise',
        `${amount} has more precision than ${currency.code} allows (${String(currency.exponent)} places).`,
      );
    }
    const padded = fraction.padEnd(currency.exponent, '0');
    const minorUnits = BigInt(`${whole}${padded}`) * (sign === '-' ? -1n : 1n);

    return new Money(minorUnits, currency);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency.code !== this.currency.code) {
      throw new DomainException(
        'money_currency_mismatch',
        `Cannot combine ${this.currency.code} with ${other.currency.code}.`,
      );
    }
  }

  public plus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits + other.minorUnits, this.currency);
  }

  public minus(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minorUnits - other.minorUnits, this.currency);
  }

  public negated(): Money {
    return new Money(-this.minorUnits, this.currency);
  }

  public isZero(): boolean {
    return this.minorUnits === 0n;
  }

  public isNegative(): boolean {
    return this.minorUnits < 0n;
  }

  public compare(other: Money): number {
    this.assertSameCurrency(other);
    if (this.minorUnits === other.minorUnits) return 0;
    return this.minorUnits < other.minorUnits ? -1 : 1;
  }

  public equals(other: Money): boolean {
    return this.currency.code === other.currency.code && this.minorUnits === other.minorUnits;
  }

  /**
   * Multiplies by a rational factor — a percentage, a proration, an accrual fraction — with the
   * rounding stated at the call site. There is no default: the caller knows whether the statute
   * rounds half up or half to even, and guessing is how a payroll ends up a fil out.
   */
  public multipliedBy(numerator: bigint, denominator: bigint, rounding: Rounding): Money {
    if (denominator === 0n) {
      throw new DomainException('money_division_by_zero', 'Cannot divide an amount by zero.');
    }
    const scaled = this.minorUnits * numerator;
    return new Money(divideRounded(scaled, denominator, rounding), this.currency);
  }

  /**
   * Splits into `parts` shares that sum exactly to the original. Remainder pennies are handed
   * to the earliest shares; nothing is lost or invented, which is what makes it safe for
   * allocating an amount across cost centres or instalments.
   */
  public allocate(parts: number): readonly Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new DomainException('money_invalid_allocation', 'Allocation requires whole parts.');
    }
    const count = BigInt(parts);
    const base = this.minorUnits / count;
    const remainder = this.minorUnits - base * count;
    const sign = remainder < 0n ? -1n : 1n;
    let left = remainder * sign;

    return Array.from({ length: parts }, () => {
      const extra = left > 0n ? sign : 0n;
      if (left > 0n) left -= 1n;
      return new Money(base + extra, this.currency);
    });
  }

  /** The exact decimal representation, for display, export and journals. */
  public toString(): string {
    const negative = this.minorUnits < 0n;
    const digits = (negative ? -this.minorUnits : this.minorUnits).toString();
    const padded = digits.padStart(this.currency.exponent + 1, '0');
    const cut = padded.length - this.currency.exponent;
    const whole = padded.slice(0, cut);
    const fraction = padded.slice(cut);

    return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`;
  }
}

/** Whether the magnitude rounds away from zero, decided per mode and nothing else. */
const roundsAway = (
  rounding: Rounding,
  remainder: bigint,
  denominator: bigint,
  quotient: bigint,
): boolean => {
  const twiceRemainder = remainder * 2n;

  switch (rounding) {
    case 'down':
      return false;
    case 'up':
      return true;
    case 'half-up':
      return twiceRemainder >= denominator;
    case 'half-even':
      return (
        twiceRemainder > denominator || (twiceRemainder === denominator && quotient % 2n === 1n)
      );
  }
};

/** Integer division with an explicit rounding mode, symmetric about zero. */
const divideRounded = (numerator: bigint, denominator: bigint, rounding: Rounding): bigint => {
  const negative = numerator < 0n !== denominator < 0n;
  const absoluteNumerator = numerator < 0n ? -numerator : numerator;
  const absoluteDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = absoluteNumerator / absoluteDenominator;
  const remainder = absoluteNumerator % absoluteDenominator;

  if (remainder === 0n) return negative ? -quotient : quotient;

  const magnitude = roundsAway(rounding, remainder, absoluteDenominator, quotient)
    ? quotient + 1n
    : quotient;
  return negative ? -magnitude : magnitude;
};
