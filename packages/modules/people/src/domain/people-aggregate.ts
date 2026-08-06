import { AggregateRoot, LocalizedText, type EventOrigin } from '@work/kernel';

import { peopleEvent, type PeopleEventName } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { isCivilDate, isEntityCode } from './people-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant (AD-007), it knows
 * its own type name, and it raises events carrying its identity.
 *
 * Repeating that across a dozen classes would mean a dozen chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class PeopleAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: PeopleEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      peopleEvent(
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
 * A person's name, in both first-class languages.
 *
 * A name is **authored data, not a catalogue key**. "محمد عبد الله" is the person's own name, not
 * a string this product ships, so it cannot live in a translation file — it is `LocalizedText`,
 * and both languages are required exactly as Organization requires them for a unit.
 *
 * Requiring both is a real cost at data entry and it is the right one. A registry that accepted an
 * English name alone produces an Arabic contract, an Arabic payslip and an Arabic government
 * submission with Latin characters in the middle of the person's own name, forever, because
 * nobody was ever asked for the second form.
 */
export interface BilingualName {
  readonly en: string;
  readonly ar: string;
}

export const nameFrom = (value: Readonly<Record<string, string>>): PeopleResult<BilingualName> => {
  const en = value['en']?.trim() ?? '';
  const ar = value['ar']?.trim() ?? '';

  if (en === '' || ar === '') {
    return refuse('name_requires_both_languages', { missing: en === '' ? 'en' : 'ar' });
  }
  return accept({ en, ar });
};

/** The kernel's value object, built from a name this module has already checked. */
export const localized = (name: BilingualName): LocalizedText =>
  LocalizedText.of({ en: name.en, ar: name.ar });

/** An optional bilingual field: absent is fine, half-present is not. */
export const optionalNameFrom = (
  value: Readonly<Record<string, string>> | undefined,
): PeopleResult<BilingualName | undefined> => {
  if (value === undefined) return accept(undefined);
  return nameFrom(value);
};

export const checkedCode = (value: string): PeopleResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { code: value });

/**
 * A civil date, checked as a date rather than parsed into an instant.
 *
 * `1990-03-14` is the same date in Riyadh and in London. Storing it as a timestamp makes it shift
 * across a zone boundary, and a date of birth that shifts by a day changes an age, an eligibility
 * and — in several markets this product sells into — a retirement date.
 *
 * Both calendars are accepted at the edge: the API converts a Hijri date through the kernel's
 * `fromHijri` before it reaches the domain, so nothing here implements a calendar (00B).
 */
export const checkedCivilDate = (value: string, field: string): PeopleResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

/** A period expressed in civil dates, where the end may be open. */
export const checkedCivilPeriod = (
  from: string,
  to: string | undefined,
  field: string,
): PeopleResult<{ readonly from: string; readonly to?: string }> => {
  const checkedFrom = checkedCivilDate(from, field);

  if (!checkedFrom.ok) return checkedFrom;
  if (to === undefined) return accept({ from: checkedFrom.value });

  const checkedTo = checkedCivilDate(to, field);

  if (!checkedTo.ok) return checkedTo;
  if (checkedTo.value < checkedFrom.value) return refuse('period_ends_before_it_begins', { field });
  return accept({ from: checkedFrom.value, to: checkedTo.value });
};

/**
 * Tenant-authored metadata (AD-008).
 *
 * Deliberately opaque: a customer that needs to record a works-council reference against every
 * person should not have to wait for a schema change, and this product should not acquire a
 * column for one customer's works council. It is stored, returned and never interpreted — no rule
 * in this module reads a metadata key, because a rule that did would be a business rule hidden in
 * a customer's data.
 *
 * It is also **not a place to put personal data this module declined to model**. Metadata is
 * excluded from the redaction the sensitive-field permission applies, precisely because this
 * module cannot know what is in it, and that exclusion is stated in the administrator guide.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): PeopleResult<Metadata> => {
  const entries = Object.entries(value ?? {});
  const oversized = entries.find(
    ([key, entry]) => key.length > METADATA_KEY_LIMIT || entry.length > METADATA_VALUE_LIMIT,
  );

  if (oversized !== undefined) return refuse('metadata_entry_too_long', { key: oversized[0] });
  return accept(Object.fromEntries(entries));
};

/** Free text a human wrote: a note, an address line, a job title on a previous employer's record. */
export const checkedText = (value: string, field: string, limit: number): PeopleResult<string> => {
  const trimmed = value.trim();

  if (trimmed === '') return refuse('text_required', { field });
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};
