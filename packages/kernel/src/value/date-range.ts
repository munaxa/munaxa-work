import { DomainException } from '../errors/domain-exception.js';

/**
 * A half-open interval: `from` inclusive, `to` exclusive, or open-ended.
 *
 * Half-open is deliberate. With inclusive ends, adjacent periods either overlap by a day or
 * leave a gap, and both are wrong for employment, assignment and compensation history — the
 * two questions "who held this position on the 1st" and "was this employee ever unassigned"
 * must have exactly one answer.
 */
export class DateRange {
  private constructor(
    public readonly from: Date,
    public readonly to: Date | undefined,
  ) {}

  public static of(from: Date, to?: Date): DateRange {
    if (to !== undefined && to.getTime() <= from.getTime()) {
      throw new DomainException('date_range_reversed', 'A range must end after it starts.');
    }
    return new DateRange(from, to);
  }

  /** A range with no end: current employment, an open assignment. */
  public static startingAt(from: Date): DateRange {
    return new DateRange(from, undefined);
  }

  public isOpenEnded(): boolean {
    return this.to === undefined;
  }

  public contains(instant: Date): boolean {
    const time = instant.getTime();
    return time >= this.from.getTime() && (this.to === undefined || time < this.to.getTime());
  }

  public overlaps(other: DateRange): boolean {
    const endsBefore = (first: DateRange, second: DateRange): boolean =>
      first.to !== undefined && first.to.getTime() <= second.from.getTime();

    return !endsBefore(this, other) && !endsBefore(other, this);
  }

  public isAdjacentTo(other: DateRange): boolean {
    return (
      this.to?.getTime() === other.from.getTime() || other.to?.getTime() === this.from.getTime()
    );
  }

  /** Closes an open range, which is what an effective-dated change does to its predecessor. */
  public closedAt(instant: Date): DateRange {
    return DateRange.of(this.from, instant);
  }

  public toString(): string {
    return `[${this.from.toISOString()}, ${this.to?.toISOString() ?? '∞'})`;
  }
}
