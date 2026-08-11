import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { compensationEvent, type CompensationEventName } from './compensation-events.js';
import { accept, refuse, type CompensationResult } from './compensation-rejection.js';
import { isCivilDate, isEntityCode } from './compensation-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across the aggregates would mean as many chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class CompensationAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: CompensationEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      compensationEvent(
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
 * A plan's name, a grade's name and a component's name are **authored data, not catalogue keys**,
 * so they cannot live in a translation file. Both languages are required for the reason every
 * module before this requires them: a component named in one language is a component half the
 * administrators cannot read.
 */
export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

export type BilingualInput = BilingualText | Readonly<Record<string, string>>;

export const bilingualFrom = (
  value: BilingualInput,
  field: string,
): CompensationResult<BilingualText> => {
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
 * **not a place to put money**: an amount hidden here would sit outside the exponent discipline,
 * outside the exclusion constraint and outside every permission this module built for the columns
 * that hold figures.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): CompensationResult<Metadata> => {
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
 * A component code, a payroll-treatment code, an adjustment type, a progression model, a reason and
 * a statutory source are all codes rather than enumerations this product ships. Which components a
 * customer offers, and on what statutory basis, is their question — and in several of this
 * product's markets the answer is legislated and belongs to a country pack (00B).
 */
export const checkedCode = (value: string, field: string): CompensationResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): CompensationResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

export const checkedCivilDate = (value: string, field: string): CompensationResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): CompensationResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/**
 * An effective period: a start, and an optional end that must follow it.
 *
 * Half-open by convention — `[from, to)` — matching the database's `daterange(..., '[)')`, so a
 * period ending on the day the next begins does not overlap it.
 */
export interface EffectivePeriod {
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export const checkedPeriod = (
  from: string,
  to: string | undefined,
  field: string,
): CompensationResult<EffectivePeriod> => {
  const start = checkedCivilDate(from, `${field}.effectiveFrom`);

  if (!start.ok) return start;

  const end = checkedOptionalCivilDate(to, `${field}.effectiveTo`);

  if (!end.ok) return end;
  if (end.value !== undefined && end.value <= start.value) {
    return refuse('period_ends_before_it_starts', { field });
  }
  return accept({
    effectiveFrom: start.value,
    ...(end.value === undefined ? {} : { effectiveTo: end.value }),
  });
};

/** Free text a human wrote: a note on an adjustment, a comment on a decision, a description. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): CompensationResult<string | undefined> => {
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
): CompensationResult<string> => {
  const checked = checkedText(value, field, limit);

  if (!checked.ok) return checked;
  if (checked.value === undefined) return refuse('text_required', { field });
  return accept(checked.value);
};

/** A whole non-negative count — a version number, a number of approvals. */
export const checkedCount = (
  value: number,
  field: string,
  max: number,
): CompensationResult<number> =>
  Number.isInteger(value) && value >= 0 && value <= max
    ? accept(value)
    : refuse('count_out_of_range', { field });

/**
 * Drops the keys whose value is `undefined`.
 *
 * `exactOptionalPropertyTypes` treats an explicit `undefined` as a different thing from an absent
 * key, and spreading a partial with undefined values would widen every optional field it touches.
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
