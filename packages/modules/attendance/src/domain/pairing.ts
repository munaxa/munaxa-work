import { isOpeningEvent, type EventKind } from './attendance-vocabulary.js';
import { minutesBetween } from './zoned-time.js';

/**
 * Turning a list of punches into intervals.
 *
 * The one rule worth stating before the code: **nothing is invented to close a pair.** A day whose
 * clock-out never arrived is reported as incomplete, not completed at the shift's end time. A
 * system that guesses an end time is a system that pays a guess, and the guess is always in
 * somebody's favour.
 *
 * Ordering is by `occurredAt` and never by arrival, because an offline mobile queue delivers a
 * morning punch after an afternoon one as a matter of course. Pairing is recomputed from scratch on
 * every calculation, so a late arrival simply produces a different — and better — answer.
 */

export interface PairableEvent {
  readonly id: string;
  readonly kind: EventKind;
  readonly occurredAt: Date;
  readonly supersedesEventId?: string;
}

export interface Interval {
  readonly kind: 'work' | 'break';
  readonly from: Date;
  readonly to: Date;
  readonly minutes: number;
  readonly fromEventId: string;
  readonly toEventId: string;
}

export interface Pairing {
  readonly work: readonly Interval[];
  readonly breaks: readonly Interval[];
  /** Openers with no closer, and closers with no opener. Each becomes a `missing_*` exception. */
  readonly unmatched: readonly PairableEvent[];
  /** Events that could not be placed at all — a break outside any shift, for instance. */
  readonly invalid: readonly PairableEvent[];
  readonly firstIn?: Date;
  readonly lastOut?: Date;
}

/**
 * Removes what a correction replaced, then orders what is left.
 *
 * A superseded event is still in the database and still readable — that is the whole point of
 * ADR-0052 — but it is not part of the day's arithmetic. Filtering here rather than in the query
 * keeps the rule in the domain, where a reader can find it.
 */
export const live = (events: readonly PairableEvent[]): readonly PairableEvent[] => {
  const superseded = new Set(
    events.map((event) => event.supersedesEventId).filter((id): id is string => id !== undefined),
  );

  return [...events]
    .filter((event) => !superseded.has(event.id))
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
};

/**
 * Pairs a day's events into worked and break intervals.
 *
 * Breaks nest inside an open work interval: a `break_start` with no clock-in before it is not a
 * break somebody took, it is a punch that makes no sense, and calling it one would silently deduct
 * time from a day nobody worked.
 */
export const pair = (events: readonly PairableEvent[]): Pairing => {
  const result: Accumulated = { work: [], breaks: [], unmatched: [], invalid: [] };
  let open: OpenPunches = {};

  for (const event of live(events)) {
    open = absorb(event, open, result);
  }
  // A punch still open at the end of the day is a missing one. Nothing is invented to close it: a
  // day whose end is unknown has no defensible worked figure, and inventing a clock-out at the
  // shift's end would put a number nobody can justify into a payable snapshot.
  if (open.work !== undefined) result.unmatched.push(open.work);
  if (open.break !== undefined) result.unmatched.push(open.break);

  return { ...result, ...boundsOf(live(events)) };
};

/** What is still open as the day is walked. Replaced rather than mutated, one punch at a time. */
interface OpenPunches {
  readonly work?: PairableEvent;
  readonly break?: PairableEvent;
}

interface Accumulated {
  readonly work: Interval[];
  readonly breaks: Interval[];
  readonly unmatched: PairableEvent[];
  readonly invalid: PairableEvent[];
}

/**
 * One punch, against what is currently open.
 *
 * Split from the walk so each half stays inside its complexity budget, and along a seam that is the
 * rule rather than an arbitrary cut: **a break nests inside an open work interval**. A
 * `break_start` with no clock-in before it is not a break somebody took, it is a punch that makes
 * no sense — and calling it one would silently deduct time from a day nobody worked.
 */
const absorb = (event: PairableEvent, open: OpenPunches, result: Accumulated): OpenPunches =>
  event.kind === 'clock_in' || event.kind === 'clock_out'
    ? absorbWork(event, open, result)
    : absorbBreak(event, open, result);

const absorbWork = (event: PairableEvent, open: OpenPunches, result: Accumulated): OpenPunches => {
  // A break left open by a clock-in or a clock-out is an unmatched punch either way: nobody
  // recorded coming back, and closing it at the departure would credit the break as worked time.
  if (open.break !== undefined) result.unmatched.push(open.break);

  if (event.kind === 'clock_in') {
    // A second clock-in without a clock-out leaves the first unmatched rather than silently
    // extending it: two arrivals and one departure is a missing punch, not a longer day.
    if (open.work !== undefined) result.unmatched.push(open.work);
    return { work: event };
  }
  if (open.work === undefined) {
    result.unmatched.push(event);
    return {};
  }
  result.work.push(intervalOf('work', open.work, event));
  return {};
};

const absorbBreak = (event: PairableEvent, open: OpenPunches, result: Accumulated): OpenPunches => {
  if (event.kind === 'break_start') {
    if (open.work === undefined) {
      result.invalid.push(event);
      return open;
    }
    if (open.break !== undefined) result.unmatched.push(open.break);
    return { work: open.work, break: event };
  }
  if (open.break === undefined) {
    result.invalid.push(event);
    return open;
  }
  result.breaks.push(intervalOf('break', open.break, event));
  return { ...(open.work === undefined ? {} : { work: open.work }) };
};

const intervalOf = (kind: 'work' | 'break', from: PairableEvent, to: PairableEvent): Interval => ({
  kind,
  from: from.occurredAt,
  to: to.occurredAt,
  minutes: Math.max(0, minutesBetween(from.occurredAt, to.occurredAt)),
  fromEventId: from.id,
  toEventId: to.id,
});

/**
 * The first arrival and the last departure of the day.
 *
 * Taken from the events rather than from the paired intervals, so a day with a missing clock-out
 * still reports when the person arrived. A screen that showed nothing because the pair was
 * incomplete would hide the very fact somebody needs in order to correct it.
 */
const boundsOf = (
  ordered: readonly PairableEvent[],
): { readonly firstIn?: Date; readonly lastOut?: Date } => {
  const firstIn = ordered.find((event) => event.kind === 'clock_in')?.occurredAt;
  const lastOut = [...ordered].reverse().find((event) => event.kind === 'clock_out')?.occurredAt;

  return {
    ...(firstIn === undefined ? {} : { firstIn }),
    ...(lastOut === undefined ? {} : { lastOut }),
  };
};

/** Whether an unmatched event is an opener, which decides which `missing_*` exception it becomes. */
export const isMissingCloser = (event: PairableEvent): boolean => isOpeningEvent(event.kind);

/**
 * Punches of the same kind close enough together to be one event arriving twice.
 *
 * Deliberately *not* the same test as deduplication. The `event_key` index catches a device
 * resending the identical punch; this catches two readers, or a person pressing twice, producing
 * two genuinely distinct rows seconds apart. Both are recorded — deleting one would be Attendance
 * deciding which reader to believe — and a human is asked.
 */
export const nearDuplicates = (
  events: readonly PairableEvent[],
  windowSeconds: number,
): readonly PairableEvent[] => {
  const ordered = live(events);
  const found: PairableEvent[] = [];

  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];

    if (previous === undefined || current === undefined) continue;
    if (previous.kind !== current.kind) continue;

    const apart = (current.occurredAt.getTime() - previous.occurredAt.getTime()) / 1000;

    if (apart <= windowSeconds) found.push(current);
  }
  return found;
};
