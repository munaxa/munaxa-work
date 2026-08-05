import { DomainException } from '../errors/domain-exception.js';
import { DateRange } from '../value/date-range.js';

/**
 * Effective dating and the timeline projection — the two patterns the master instructions make
 * mandatory, implemented once so no module invents its own.
 *
 * The rule they encode: history is never rewritten. A salary change effective in March does not
 * edit February's salary, it closes it and opens a new period. That is what lets a payroll
 * re-run for February produce February's answer, and what lets an auditor ask what an employee
 * was paid on any date and get one answer.
 */

export interface EffectiveDated {
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

export interface TimelineEntry<TValue> extends EffectiveDated {
  readonly value: TValue;
  readonly version: number;
}

/**
 * An ordered, non-overlapping, gapless-by-construction history of one thing.
 *
 * Non-overlapping is enforced rather than assumed: two open salary periods is not a display
 * problem, it is two different answers to "what is this person paid", and the system must be
 * incapable of holding both.
 */
export class Timeline<TValue> {
  private constructor(private readonly entries: readonly TimelineEntry<TValue>[]) {}

  public static empty<TValue>(): Timeline<TValue> {
    return new Timeline<TValue>([]);
  }

  public static from<TValue>(entries: readonly TimelineEntry<TValue>[]): Timeline<TValue> {
    const ordered = [...entries].sort(
      (left, right) => left.effectiveFrom.getTime() - right.effectiveFrom.getTime(),
    );
    assertNoOverlap(ordered);
    return new Timeline(ordered);
  }

  public get all(): readonly TimelineEntry<TValue>[] {
    return this.entries;
  }

  public get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** The entry in force on a date — the question every consumer actually asks. */
  public at(instant: Date): TimelineEntry<TValue> | undefined {
    return this.entries.find((entry) => rangeOf(entry).contains(instant));
  }

  public current(now: Date): TimelineEntry<TValue> | undefined {
    return this.at(now);
  }

  /** Entries that begin after a date: scheduled future changes, visible before they take effect. */
  public scheduledAfter(instant: Date): readonly TimelineEntry<TValue>[] {
    return this.entries.filter((entry) => entry.effectiveFrom.getTime() > instant.getTime());
  }

  /**
   * Records a change effective from a date. The period it supersedes is closed at that instant;
   * nothing is edited and nothing is deleted.
   *
   * Back-dating is permitted — corrections and retroactive raises are ordinary business — but it
   * supersedes rather than rewrites, so the superseded value remains answerable.
   */
  public change(value: TValue, effectiveFrom: Date): Timeline<TValue> {
    const superseded = this.at(effectiveFrom);
    const untouched = this.entries.filter(
      (entry) => entry !== superseded && entry.effectiveFrom.getTime() < effectiveFrom.getTime(),
    );
    const closed =
      superseded === undefined
        ? []
        : [{ ...superseded, effectiveTo: effectiveFrom, version: superseded.version + 1 }];

    return new Timeline([...untouched, ...closed, { value, effectiveFrom, version: 1 }]);
  }

  /** Ends the open period, as a termination or a plan withdrawal does. */
  public close(effectiveTo: Date): Timeline<TValue> {
    const open = this.entries.find((entry) => entry.effectiveTo === undefined);

    if (open === undefined) return this;

    return new Timeline(
      this.entries.map((entry) =>
        entry === open ? { ...entry, effectiveTo, version: entry.version + 1 } : entry,
      ),
    );
  }
}

const rangeOf = (entry: EffectiveDated): DateRange =>
  entry.effectiveTo === undefined
    ? DateRange.startingAt(entry.effectiveFrom)
    : DateRange.of(entry.effectiveFrom, entry.effectiveTo);

const assertNoOverlap = (ordered: readonly EffectiveDated[]): void => {
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (
      previous !== undefined &&
      current !== undefined &&
      rangeOf(previous).overlaps(rangeOf(current))
    ) {
      throw new DomainException(
        'timeline_overlap',
        `Two periods are in force at once from ${current.effectiveFrom.toISOString()}. A timeline must answer "what applied on this date" with exactly one value.`,
      );
    }
  }
};
