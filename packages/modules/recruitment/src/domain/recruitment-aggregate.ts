import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { recruitmentEvent, type RecruitmentEventName } from './recruitment-events.js';
import { accept, refuse, type RecruitmentResult } from './recruitment-rejection.js';
import {
  isCivilDate,
  isDocumentReference,
  isEmailAddress,
  isEntityCode,
  isTelephoneNumber,
  normalizeEmail,
  normalizeTelephone,
} from './recruitment-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across seven classes would mean seven chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class RecruitmentAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: RecruitmentEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      recruitmentEvent(
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
 * A vacancy title and a candidate's name are **authored data, not catalogue keys**, so they cannot
 * live in a translation file. Both languages are required for the same reason Organization requires
 * them for a unit and People for a name: a posting written in one language is an opening half the
 * market cannot read, and a name recorded in one script produces a contract with Latin characters
 * in the middle of somebody's own name, forever, because nobody was ever asked for the second form.
 */
export interface BilingualText {
  readonly en: string;
  readonly ar: string;
}

export const bilingualFrom = (
  value: Readonly<Record<string, string>>,
  field: string,
): RecruitmentResult<BilingualText> => {
  const en = value['en']?.trim() ?? '';
  const ar = value['ar']?.trim() ?? '';

  if (en === '' || ar === '') {
    return refuse('text_requires_both_languages', { field, missing: en === '' ? 'en' : 'ar' });
  }
  return accept({ en, ar });
};

export const optionalBilingualFrom = (
  value: Readonly<Record<string, string>> | undefined,
  field: string,
): RecruitmentResult<BilingualText | undefined> =>
  value === undefined ? accept(undefined) : bilingualFrom(value, field);

/**
 * Tenant-authored metadata.
 *
 * Stored, returned and never interpreted — no rule in this module reads a metadata key. It is also
 * **not a place to put candidate personal data this module declined to model**: A-2 keeps
 * government identifiers, dates of birth and nationalities out of Recruitment, and a customer who
 * puts one in metadata has put it somewhere with none of People's protections around it. Stated in
 * the administrator guide rather than implied.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): RecruitmentResult<Metadata> => {
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
 * Source, reason, priority, stage, mode, rejection reason and employment type are all codes rather
 * than enumerations this product ships. Which recruitment sources a customer tracks, and which
 * reasons they record for a rejection, are their questions — and in several of this product's
 * markets the second has legal consequences a country pack owns (00B).
 */
export const checkedCode = (value: string, field: string): RecruitmentResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): RecruitmentResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

export const checkedCivilDate = (value: string, field: string): RecruitmentResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): RecruitmentResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/** An email address, kept twice: normalized for matching, and as entered for the screen. */
export interface CheckedEmail {
  readonly normalized: string;
  readonly display: string;
}

export const checkedEmail = (value: string): RecruitmentResult<CheckedEmail> => {
  const display = value.trim();

  if (!isEmailAddress(display)) return refuse('email_malformed');
  return accept({ normalized: normalizeEmail(display), display });
};

export const checkedOptionalTelephone = (
  value: string | undefined,
): RecruitmentResult<string | undefined> => {
  if (value === undefined || value.trim() === '') return accept(undefined);

  const normalized = normalizeTelephone(value.trim());

  return isTelephoneNumber(normalized) ? accept(normalized) : refuse('telephone_malformed');
};

/** A reference into the document store. Recruitment builds no document management (§11). */
export const checkedDocumentReference = (
  value: string | undefined,
): RecruitmentResult<string | undefined> => {
  if (value === undefined) return accept(undefined);
  return isDocumentReference(value)
    ? accept(value)
    : refuse('document_reference_malformed', { field: 'documentReference' });
};

/** Free text a human wrote: a screening note, an interviewer's concerns, a decision note. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): RecruitmentResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const trimmed = value.trim();

  if (trimmed === '') return accept(undefined);
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};
