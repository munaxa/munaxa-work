import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { attendanceEvent, type AttendanceEventName } from './attendance-events.js';
import { accept, refuse, type AttendanceResult } from './attendance-rejection.js';
import { isCivilDate, isEntityCode, isWallClock } from './attendance-vocabulary.js';
import { isKnownZone } from './zoned-time.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across six classes would mean six chances to publish an event whose `aggregateId`
 * is the wrong one, and an event with the wrong aggregate identity is worse than a missing event —
 * a consumer acts on it.
 */
export abstract class AttendanceAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: AttendanceEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      attendanceEvent(
        eventName,
        { aggregateType: this.aggregateType, aggregateId: this.id },
        payload,
        origin,
        occurredAt,
      ),
    );
  }
}

/**
 * Text in both first-class languages.
 *
 * A shift's name and a schedule's name are **authored data, not catalogue keys**, so they cannot
 * live in a translation file. Both languages are required for the reason every module before this
 * requires them: a rota named in one language is a rota half the shift supervisors cannot read.
 */
export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

/** What a caller may hand in: an authored map from the wire, or a value already checked. */
export type BilingualInput = BilingualText | Readonly<Record<string, string>>;

export const bilingualFrom = (
  value: BilingualInput,
  field: string,
): AttendanceResult<BilingualText> => {
  const en = value['en']?.trim() ?? '';
  const ar = value['ar']?.trim() ?? '';

  if (en === '' || ar === '') {
    return refuse('text_requires_both_languages', { field, missing: en === '' ? 'en' : 'ar' });
  }
  return accept({ en, ar });
};

/**
 * Tenant-authored metadata.
 *
 * Stored, returned and never interpreted — no rule in this module reads a metadata key. It is also
 * **not a place to put the employment data this module declined to model**: an employee number or a
 * contracted-hours figure put here is a second copy of another module's fact, sitting outside every
 * protection that module built for it.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): AttendanceResult<Metadata> => {
  const entries = Object.entries(value ?? {});
  const oversized = entries.find(
    ([key, entry]) => key.length > METADATA_KEY_LIMIT || entry.length > METADATA_VALUE_LIMIT,
  );

  if (oversized !== undefined) return refuse('metadata_entry_too_long', { key: oversized[0] });
  return accept(Object.fromEntries(entries));
};

/**
 * A code the tenant or a country pack supplies.
 *
 * A shift code, a policy code, a correction reason and a waiver reason are all codes rather than
 * enumerations this product ships. Which shifts a customer runs, and which reasons they record for
 * a missed punch, are their questions — and in several of this product's markets the working-time
 * rules behind them are statutory and belong to a country pack (00B).
 */
export const checkedCode = (value: string, field: string): AttendanceResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): AttendanceResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

export const checkedCivilDate = (value: string, field: string): AttendanceResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): AttendanceResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/** A wall-clock time, meaningless until a schedule says which zone it is in. */
export const checkedWallClock = (value: string, field: string): AttendanceResult<string> =>
  isWallClock(value) ? accept(value) : refuse('wall_clock_malformed', { field });

export const checkedOptionalWallClock = (
  value: string | undefined,
  field: string,
): AttendanceResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedWallClock(value, field);

/**
 * An IANA zone name, checked against the runtime's own data.
 *
 * Checked rather than trusted, because a schedule carrying `Asia/Riyad` would silently fall back to
 * UTC on every conversion and put an entire site's night shift on the wrong day.
 */
export const checkedZone = (value: string): AttendanceResult<string> =>
  isKnownZone(value) ? accept(value) : refuse('zone_unknown', { zone: value });

/** Free text a human wrote: a note on a manual punch, a justification on a correction. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): AttendanceResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const trimmed = value.trim();

  if (trimmed === '') return accept(undefined);
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};

/** A whole number of minutes within a stated range. Every duration in this module is minutes. */
export const checkedMinutes = (
  value: number,
  field: string,
  bounds: { readonly min: number; readonly max: number },
): AttendanceResult<number> =>
  Number.isInteger(value) && value >= bounds.min && value <= bounds.max
    ? accept(value)
    : refuse('minutes_out_of_range', { field });

/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` treats an explicit `undefined` as a different thing from an absent
 * key, and spreading a partial with undefined values would widen every optional field it touches.
 *
 * Shared rather than repeated because the alternative is a chain of a dozen ternaries in every
 * mapper — which is the same statement written twelve times, and twelve chances to omit one.
 */
export const definedOnly = <TShape extends object>(
  shape: TShape,
): { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> } =>
  Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
  };
