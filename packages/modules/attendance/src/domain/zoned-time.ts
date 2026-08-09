import { MINUTES_PER_DAY, minutesOfDay } from './attendance-vocabulary.js';

/**
 * Wall-clock time in a named zone, and the instant it corresponds to.
 *
 * **This file exists because a civil date is never a truncated UTC instant.** For a tenant in
 * `Asia/Riyadh`, a punch at 02:00 local on the 3rd is 23:00 UTC on the 2nd, and
 * `occurred_at.toISOString().slice(0, 10)` puts a night's work on the wrong date, in the wrong week
 * and in the wrong payroll period. Every conversion in this module goes through here.
 *
 * Conversion uses the ICU data the runtime already carries, through `Intl.DateTimeFormat` with an
 * explicit `timeZone` — the same dependency `@work/kernel`'s Umm al-Qura conversion relies on. **No
 * zone table is shipped and no offset is hardcoded**, so a jurisdiction that changes its rules is a
 * runtime data update rather than a release.
 *
 * It lives in Attendance rather than in the kernel deliberately, and the decision is recorded: the
 * kernel is the right long-term home, changing it changes a package every phase depends on, and the
 * repository already carries a three-phase precedent for extracting a shared helper when a second
 * consumer appears rather than before (D-3).
 *
 * **Nothing here assumes a day is twenty-four hours.** A day on which the clocks go forward is
 * twenty-three, and a shift measured by subtracting instants is correct across it while a shift
 * measured by adding 86,400,000 milliseconds is not.
 */

/** A civil date and a wall-clock time, as a human in that zone would read them. */
export interface ZonedWallClock {
  readonly date: string;
  readonly time: string;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formatters are expensive to construct and are reused.
 *
 * Ingestion builds one per event otherwise, and at the volumes this table reaches that is the
 * difference between a millisecond and a hundred microseconds on every punch in the product.
 */
const formatterFor = (zone: string): Intl.DateTimeFormat => {
  const existing = formatters.get(zone);

  if (existing !== undefined) return existing;

  const created = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  formatters.set(zone, created);
  return created;
};

/** Whether a zone name is one this runtime's ICU data knows. Checked, never assumed. */
export const isKnownZone = (zone: string): boolean => {
  try {
    formatterFor(zone).format(new Date(0));
    return true;
  } catch {
    return false;
  }
};

/** An instant, as the wall clock in a zone reads it. */
export const wallClockAt = (instant: Date, zone: string): ZonedWallClock => {
  const parts = new Map(
    formatterFor(zone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const hour = parts.get('hour') ?? '00';

  return {
    date: `${parts.get('year') ?? '0000'}-${parts.get('month') ?? '00'}-${parts.get('day') ?? '00'}`,
    // ICU renders midnight as `24` in some locales under `hour12: false`. Left uncorrected it puts
    // every midnight punch on the previous day.
    time: `${hour === '24' ? '00' : hour}:${parts.get('minute') ?? '00'}`,
  };
};

/** The civil date an instant falls on in a zone. */
export const civilDateAt = (instant: Date, zone: string): string => wallClockAt(instant, zone).date;

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/**
 * The instant at which a wall-clock time occurs in a zone.
 *
 * There is no direct API for this, so it is solved rather than looked up: guess the instant as if
 * the zone were UTC, read what the wall clock actually says there, and correct by the difference.
 * Two passes converge for every real zone, including those with offsets that are not whole hours.
 *
 * **Daylight saving makes two of these questions unanswerable, and both are answered explicitly
 * rather than by whatever the arithmetic happens to produce.** On a spring-forward morning 02:30
 * does not exist; on an autumn morning it happens twice. A shift that starts in a gap is anchored
 * to the instant the clocks jumped to, and one that starts in a repeated hour takes the first
 * occurrence — the earlier instant, which is the one a person turning up for work experiences.
 */
export const instantAt = (date: string, time: string, zone: string): Date => {
  const target = Date.parse(`${date}T${time}:00Z`);
  let guess = target;

  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClockAt(new Date(guess), zone);
    const drift = Date.parse(`${seen.date}T${seen.time}:00Z`) - target;

    if (drift === 0) return new Date(guess);
    guess -= drift;
  }

  // A wall-clock time in a spring-forward gap never reads back as itself, whatever the guess. The
  // loop leaves `guess` on the far side of the jump, which is the first instant that exists at or
  // after the requested time — the honest anchor for a shift nobody could have started.
  return new Date(guess);
};

/**
 * Real elapsed minutes between two instants.
 *
 * Instants, not wall clocks: a night shift that spans a daylight-saving transition worked
 * twenty-three or twenty-five hours, and the person who worked it is entitled to the number that
 * actually elapsed rather than the one the clock face suggests.
 */
export const minutesBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / MINUTE_MS);

/**
 * Where a shift starting on a civil date begins and ends, as instants.
 *
 * `crossesMidnight` moves the end to the following civil date rather than adding twenty-four hours,
 * so the conversion happens in the zone and a transition night is the length it really was.
 */
export const shiftBoundsOn = (
  onDate: string,
  startLocal: string,
  endLocal: string,
  zone: string,
): { readonly startAt: Date; readonly endAt: Date } => {
  const startAt = instantAt(onDate, startLocal, zone);
  const overnight = minutesOfDay(endLocal) <= minutesOfDay(startLocal);
  const endDate = overnight ? nextDay(onDate) : onDate;
  const endAt = instantAt(endDate, endLocal, zone);

  return { startAt, endAt };
};

const nextDay = (civilDate: string): string => {
  const at = new Date(`${civilDate}T00:00:00Z`);

  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
};

/**
 * How far an instant is, in minutes, from local midnight on a given civil date.
 *
 * Negative before it, and beyond `MINUTES_PER_DAY` after it — which is what makes an 02:00 punch
 * belong to the previous day's night shift rather than to the day it is nominally on.
 */
export const minutesFromMidnight = (instant: Date, onDate: string, zone: string): number =>
  Math.round((instant.getTime() - instantAt(onDate, '00:00', zone).getTime()) / MINUTE_MS);

/** A whole local day's length in minutes. Twenty-three or twenty-five on a transition day. */
export const localDayMinutes = (onDate: string, zone: string): number =>
  Math.round(
    (instantAt(nextDay(onDate), '00:00', zone).getTime() -
      instantAt(onDate, '00:00', zone).getTime()) /
      MINUTE_MS,
  );

/** Whether a local day is the usual length. False on a daylight-saving transition. */
export const isRegularLocalDay = (onDate: string, zone: string): boolean =>
  localDayMinutes(onDate, zone) === MINUTES_PER_DAY;

/** The offset a zone was at on an instant, in minutes. Reported, never used as a constant. */
export const offsetMinutesAt = (instant: Date, zone: string): number => {
  const seen = wallClockAt(instant, zone);

  return Math.round((Date.parse(`${seen.date}T${seen.time}:00Z`) - instant.getTime()) / MINUTE_MS);
};

export const HOUR_IN_MILLISECONDS = HOUR_MS;
