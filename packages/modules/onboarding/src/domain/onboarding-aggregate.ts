import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { onboardingEvent, type OnboardingEventName } from './onboarding-events.js';
import { accept, refuse, type OnboardingResult } from './onboarding-rejection.js';
import { isCivilDate, isDocumentReference, isEntityCode } from './onboarding-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across four classes would mean four chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class OnboardingAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: OnboardingEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      onboardingEvent(
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
 * A plan's name and a task's title are **authored data, not catalogue keys**, so they cannot live in
 * a translation file. Both languages are required for the reason every module before this requires
 * them: a checklist written in one language is a checklist half the joiners cannot read, and a
 * bilingual tenant discovers it on somebody's first morning.
 */
export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

/**
 * What a caller may hand in: an authored map from the wire, or a value already checked.
 *
 * The union rather than the loose map alone, so a template already holding `BilingualText` can be
 * copied into a new draft version without being widened first — copying is how a version is drafted
 * from the published one, and a type assertion at that seam is a type assertion nobody reads.
 */
export type BilingualInput = BilingualText | Readonly<Record<string, string>>;

export const bilingualFrom = (
  value: BilingualInput,
  field: string,
): OnboardingResult<BilingualText> => {
  const en = value['en']?.trim() ?? '';
  const ar = value['ar']?.trim() ?? '';

  if (en === '' || ar === '') {
    return refuse('text_requires_both_languages', { field, missing: en === '' ? 'en' : 'ar' });
  }
  return accept({ en, ar });
};

export const optionalBilingualFrom = (
  value: BilingualInput | undefined,
  field: string,
): OnboardingResult<BilingualText | undefined> =>
  value === undefined ? accept(undefined) : bilingualFrom(value, field);

/**
 * Tenant-authored metadata.
 *
 * Stored, returned and never interpreted — no rule in this module reads a metadata key. It is also
 * **not a place to put the employee data this module declined to model**: a date of birth, an
 * identifier or a bank detail put here is personal data sitting outside every protection People
 * built for it (ADR-0038). Stated in the administrator guide rather than implied.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): OnboardingResult<Metadata> => {
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
 * A plan code, a role queue, a cancellation reason, a waiver reason and a document type are all
 * codes rather than enumerations this product ships. Which onboarding plans a customer runs, and
 * which reasons they record for cancelling one, are their questions — and in several of this
 * product's markets a required onboarding step is a statutory one a country pack owns (00B).
 */
export const checkedCode = (value: string, field: string): OnboardingResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): OnboardingResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

export const checkedCivilDate = (value: string, field: string): OnboardingResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): OnboardingResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/**
 * A reference into the document store.
 *
 * A reference and nothing else: this module stores no bytes, builds no upload path and has no
 * adapter behind it in this repository. What is validated here is the *shape* of a reference, so a
 * task cannot record a sentence where a document identifier belongs.
 */
export const checkedDocumentReference = (
  value: string | undefined,
): OnboardingResult<string | undefined> => {
  if (value === undefined) return accept(undefined);
  return isDocumentReference(value)
    ? accept(value)
    : refuse('document_reference_malformed', { field: 'documentReference' });
};

/** Free text a human wrote: a completion note, a description. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): OnboardingResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const trimmed = value.trim();

  if (trimmed === '') return accept(undefined);
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};
