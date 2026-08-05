import { describe, expect, it } from 'vitest';

import { DomainException } from '../errors/domain-exception.js';

import { Money, type Currency } from './money.js';

const SAR: Currency = { code: 'SAR', exponent: 2 };
const KWD: Currency = { code: 'KWD', exponent: 3 };
const JPY: Currency = { code: 'JPY', exponent: 0 };

describe('Money', () => {
  it('parses and renders exactly, at each currency precision', () => {
    expect(Money.parse('1234.56', SAR).toString()).toBe('1234.56');
    expect(Money.parse('1234.567', KWD).toString()).toBe('1234.567');
    expect(Money.parse('1234', JPY).toString()).toBe('1234');
    expect(Money.parse('-0.05', SAR).toString()).toBe('-0.05');
  });

  it('holds precision that floating point loses', () => {
    const tenth = Money.parse('0.10', SAR);
    let total = Money.zero(SAR);

    for (let index = 0; index < 10; index += 1) total = total.plus(tenth);

    expect(total.toString()).toBe('1.00');
    // The same sum in binary floating point does not equal 1.
    expect(0.1 * 10 === 1).toBe(true);
    expect(0.1 + 0.2 === 0.3).toBe(false);
  });

  it('refuses more precision than the currency has', () => {
    expect(() => Money.parse('1.005', SAR)).toThrow(DomainException);
    expect(() => Money.parse('1.5', JPY)).toThrow(DomainException);
  });

  it('refuses to combine different currencies', () => {
    expect(() => Money.parse('1.00', SAR).plus(Money.parse('1.000', KWD))).toThrow(
      /Cannot combine SAR with KWD/,
    );
  });

  it('applies the rounding the caller states, never a default', () => {
    const amount = Money.parse('10.005', KWD);

    expect(amount.multipliedBy(1n, 2n, 'half-up').toString()).toBe('5.003');
    expect(amount.multipliedBy(1n, 2n, 'half-even').toString()).toBe('5.002');
    expect(amount.multipliedBy(1n, 2n, 'down').toString()).toBe('5.002');
    expect(amount.multipliedBy(1n, 2n, 'up').toString()).toBe('5.003');
  });

  it('rounds negative amounts away from zero symmetrically', () => {
    const negative = Money.parse('-10.005', KWD);

    expect(negative.multipliedBy(1n, 2n, 'half-up').toString()).toBe('-5.003');
  });

  it('allocates without losing or inventing a unit', () => {
    const shares = Money.parse('100.00', SAR).allocate(3);

    expect(shares.map((share) => share.toString())).toEqual(['33.34', '33.33', '33.33']);
    const total = shares.reduce((sum, share) => sum.plus(share), Money.zero(SAR));
    expect(total.toString()).toBe('100.00');
  });

  it('allocates a negative amount without losing a unit', () => {
    const shares = Money.parse('-100.00', SAR).allocate(3);
    const total = shares.reduce((sum, share) => sum.plus(share), Money.zero(SAR));

    expect(total.toString()).toBe('-100.00');
  });

  it('compares and equates only within a currency', () => {
    expect(Money.parse('5.00', SAR).compare(Money.parse('4.99', SAR))).toBe(1);
    expect(Money.parse('5.00', SAR).equals(Money.parse('5.00', SAR))).toBe(true);
    expect(Money.parse('5.00', SAR).equals(Money.of(5000n, KWD))).toBe(false);
  });

  it('rejects an implausible currency exponent', () => {
    expect(() => Money.of(1n, { code: 'XXX', exponent: 9 })).toThrow(DomainException);
  });
});
