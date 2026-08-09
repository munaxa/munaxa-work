import { AggregateRoot, type EventOrigin } from '@work/kernel';

import { employmentEvent, type EmploymentEventName } from './employment-events.js';
import { accept, refuse, type EmploymentResult } from './employment-rejection.js';
import { isCivilDate, isDocumentReference, isEntityCode } from './employment-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant, it knows its own
 * type name, and it raises events carrying its identity.
 *
 * Repeating that across five classes would mean five chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than a
 * missing event — a consumer acts on it.
 */
export abstract class EmploymentAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: EmploymentEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      employmentEvent(
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
 * Tenant-authored metadata.
 *
 * Deliberately opaque: a customer that needs to record a works-council reference against every
 * employment should not wait for a schema change, and this product should not acquire a column for
 * one customer's works council. It is stored, returned and never interpreted — no rule in this
 * module reads a metadata key, because a rule that did would be a business rule hidden in a
 * customer's data.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): EmploymentResult<Metadata> => {
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
 * Employment type, category, class, end reason and contract type are all codes rather than
 * enumerations this product ships. Which employment classifications exist, and which termination
 * reasons carry which consequences, are statutory and cultural questions answered differently in
 * every market — a fixed list here would be labour law hardcoded in a domain model (00B).
 */
export const checkedCode = (value: string, field: string): EmploymentResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { field });

export const checkedOptionalCode = (
  value: string | undefined,
  field: string,
): EmploymentResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCode(value, field);

/** A civil date, checked as a date rather than parsed into an instant. */
export const checkedCivilDate = (value: string, field: string): EmploymentResult<string> =>
  isCivilDate(value) ? accept(value) : refuse('date_malformed', { field });

export const checkedOptionalCivilDate = (
  value: string | undefined,
  field: string,
): EmploymentResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedCivilDate(value, field);

/** A reference into the document store. Employment stores no bytes and owns no documents (§24). */
export const checkedDocumentReference = (
  value: string | undefined,
): EmploymentResult<string | undefined> => {
  if (value === undefined) return accept(undefined);
  return isDocumentReference(value)
    ? accept(value)
    : refuse('document_reference_malformed', { field: 'documentReference' });
};

/** Free text a human wrote: the note on a suspension, the reason recorded against a transfer. */
export const checkedText = (
  value: string | undefined,
  field: string,
  limit: number,
): EmploymentResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const trimmed = value.trim();

  if (trimmed === '') return accept(undefined);
  if (trimmed.length > limit) return refuse('text_too_long', { field });
  return accept(trimmed);
};
