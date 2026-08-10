import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { leaveEvent, type LeaveEventName } from './leave-events.js';
import { accept, refuse, type LeaveResult } from './leave-rejection.js';
import { isCivilDate, isEntityCode, isWallClock } from './leave-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across eight aggregates would mean eight chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class LeaveAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: LeaveEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      leaveEvent(
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
 * A leave type's name and a blackout's name are **authored data, not catalogue keys**, so they
 * cannot live in a translation file. Both languages are required for the reason every module before
 * this requires them: a leave type named in one language is a leave type half the workforce cannot
 * choose.
 */
export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

/** What a caller may hand in: an authored map from the wire, or a value already checked. */
export type BilingualInput = BilingualText | Readonly<Record<string, string>>;

export const bilingualFrom = (value: BilingualInput, field: string): LeaveResult<BilingualText> => {
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
 * **not a place to put the facts this module declined to hold**: a pay rate, an employment status
 * or a contracted-hours figure put here is a second copy of another module's fact, sitting outside
 * every protection that module built for it.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): LeaveResult<Metadata> => {
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
 * A leave type's code, a paid-treatment code, a gender restriction, a reason and a statutory source
 * are all codes rather than enumerations this product ships. Which leave a customer offers, and on
 * what statutory basis, is their question — and in several of this product's markets the answer is
 * legislated and belongs to a country pack (00B).
 */
export const checkedCode = (value: string, field: string): LeaveResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): LeaveResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

export const checkedCivilDate = (value: string, field: string): LeaveResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): LeaveResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/** A wall-clock time, meaningless until something says which zone it is in. */
export const checkedWallClock = (value: string, field: string): LeaveResult<string> =>
  isWallClock(value) ? accept(value) : refuse('wall_clock_malformed', { field });

/** Free text a human wrote: a justification, a note on an adjustment, a comment on a decision. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): LeaveResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const trimmed = value.trim();

  if (trimmed === '') return accept(undefined);
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};

/** Free text that is required rather than optional — an adjustment's note, for instance. */
export const requiredText = (
  value: string | undefined,
  field: string,
  limit: number,
): LeaveResult<string> => {
  const checked = checkedText(value, field, limit);

  if (!checked.ok) return checked;
  if (checked.value === undefined) return refuse('text_required', { field });
  return accept(checked.value);
};

/**
 * A whole number of minutes within a stated range.
 *
 * **Every duration in this module is integer minutes.** Not a float, not a fractional day. Half a
 * day is 240 of 480 minutes and is exact; half a day as `0.5` is a float, and a year of them does
 * not sum to a whole number (§10.4).
 */
export const checkedMinutes = (
  value: number,
  field: string,
  bounds: { readonly min: number; readonly max: number },
): LeaveResult<number> =>
  Number.isInteger(value) && value >= bounds.min && value <= bounds.max
    ? accept(value)
    : refuse('minutes_out_of_range', { field });

/** A whole non-negative count — a number of months, of days' notice, of approvals. */
export const checkedCount = (value: number, field: string, max: number): LeaveResult<number> =>
  Number.isInteger(value) && value >= 0 && value <= max
    ? accept(value)
    : refuse('count_out_of_range', { field });

/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` treats an explicit `undefined` as a different thing from an absent
 * key, and spreading a partial with undefined values would widen every optional field it touches.
 *
 * Shared rather than repeated because the alternative is a chain of a dozen ternaries in every
 * mapper — the same statement written twelve times, and twelve chances to omit one.
 */
export const definedOnly = <TShape extends object>(
  shape: TShape,
): { [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined> } =>
  Object.fromEntries(Object.entries(shape).filter(([, value]) => value !== undefined)) as {
    [TKey in keyof TShape]?: Exclude<TShape[TKey], undefined>;
  };

/** Removes one key from a frozen shape, for the fields that are cleared rather than overwritten. */
export const withoutKey = <TShape extends object, TKey extends keyof TShape>(
  shape: TShape,
  key: TKey,
): Omit<TShape, TKey> => {
  const { [key]: _removed, ...rest } = shape;
  return rest;
};
