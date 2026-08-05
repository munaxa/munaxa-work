import { DomainException } from '../errors/domain-exception.js';

/**
 * A fractional amount held exactly, as scaled integers.
 *
 * Leave balances are the reason. An accrual of 2.5 days a month produces balances like 15.318,
 * and a live competitor's app shows exactly that — fractional days, not rounded ones. Holding
 * them in binary floating point loses a fraction on every accrual, and an employee whose
 * balance is short by a hundredth of a day after three years has been robbed of nothing they
 * can see, which is precisely why nobody catches it.
 *
 * Scale is fixed per quantity and stated, never inferred.
 */
export class Quantity {
  private constructor(
    public readonly units: bigint,
    public readonly scale: number,
  ) {}

  public static of(units: bigint, scale: number): Quantity {
    if (!Number.isInteger(scale) || scale < 0 || scale > 9) {
      throw new DomainException('quantity_invalid_scale', `Implausible scale ${String(scale)}.`);
    }
    return new Quantity(units, scale);
  }

  public static zero(scale: number): Quantity {
    return Quantity.of(0n, scale);
  }

  /** Parses an exact decimal. A string, because a number has already lost the precision. */
  public static parse(value: string, scale: number): Quantity {
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());

    if (match === null) {
      throw new DomainException('quantity_unparsable', `"${value}" is not a decimal quantity.`);
    }
    const [, sign, whole = '0', fraction = ''] = match;

    if (fraction.length > scale) {
      throw new DomainException(
        'quantity_too_precise',
        `${value} exceeds the scale of ${String(scale)}.`,
      );
    }
    const units = BigInt(`${whole}${fraction.padEnd(scale, '0')}`) * (sign === '-' ? -1n : 1n);
    return new Quantity(units, scale);
  }

  private assertSameScale(other: Quantity): void {
    if (other.scale !== this.scale) {
      throw new DomainException(
        'quantity_scale_mismatch',
        `Cannot combine quantities of scale ${String(this.scale)} and ${String(other.scale)}.`,
      );
    }
  }

  public plus(other: Quantity): Quantity {
    this.assertSameScale(other);
    return new Quantity(this.units + other.units, this.scale);
  }

  public minus(other: Quantity): Quantity {
    this.assertSameScale(other);
    return new Quantity(this.units - other.units, this.scale);
  }

  public isNegative(): boolean {
    return this.units < 0n;
  }

  public isZero(): boolean {
    return this.units === 0n;
  }

  public compare(other: Quantity): number {
    this.assertSameScale(other);
    if (this.units === other.units) return 0;
    return this.units < other.units ? -1 : 1;
  }

  public toString(): string {
    const negative = this.units < 0n;
    const digits = (negative ? -this.units : this.units).toString().padStart(this.scale + 1, '0');
    const cut = digits.length - this.scale;
    const fraction = digits.slice(cut);

    return `${negative ? '-' : ''}${digits.slice(0, cut)}${fraction === '' ? '' : `.${fraction}`}`;
  }

  /** For display only. Never feed this back into a calculation. */
  public toNumber(): number {
    return Number(this.toString());
  }
}
