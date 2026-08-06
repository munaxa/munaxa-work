import { AggregateRoot, LocalizedText, type EventOrigin } from '@work/kernel';

import { organizationEvent, type OrganizationEventName } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import { isEntityCode } from './organization-vocabulary.js';

/**
 * What every aggregate in this module shares: it belongs to exactly one tenant (AD-004), it
 * knows its own type name, and it raises events carrying its identity.
 *
 * Repeating that in nine classes would mean nine chances to publish an event whose
 * `aggregateId` is the wrong one, and an event with the wrong aggregate identity is worse than
 * a missing event — a consumer acts on it.
 */
export abstract class OrganizationAggregate extends AggregateRoot {
  protected constructor(
    id: string,
    public readonly tenantId: string,
    version: number,
    private readonly aggregateType: string,
  ) {
    super(id, version);
  }

  protected raise<TPayload extends object>(
    eventName: OrganizationEventName,
    payload: TPayload,
    origin: EventOrigin,
    occurredAt: Date,
  ): void {
    this.recordEvent(
      organizationEvent(
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
 * The name of anything a tenant authors, in both first-class languages.
 *
 * Organization names are *not* catalogue keys: "Riyadh Operations" is the customer's word, not
 * a string this product ships, so it cannot live in a translation file. It is `LocalizedText`
 * instead, and both languages are required — the alternative is an org chart that reads
 * correctly in English and shows Latin characters in the middle of an Arabic page, forever,
 * because nobody was ever asked for the second name.
 */
export interface BilingualName {
  readonly en: string;
  readonly ar: string;
}

export const nameFrom = (
  value: Readonly<Record<string, string>>,
): OrganizationResult<BilingualName> => {
  const en = value['en']?.trim() ?? '';
  const ar = value['ar']?.trim() ?? '';

  if (en === '' || ar === '') {
    return refuse('name_requires_both_languages', {
      missing: en === '' ? 'en' : 'ar',
    });
  }
  return accept({ en, ar });
};

/** The kernel's value object, built from a name this module has already checked. */
export const localized = (name: BilingualName): LocalizedText =>
  LocalizedText.of({ en: name.en, ar: name.ar });

/** An optional bilingual field: absent is fine, half-present is not. */
export const optionalNameFrom = (
  value: Readonly<Record<string, string>> | undefined,
): OrganizationResult<BilingualName | undefined> => {
  if (value === undefined) return accept(undefined);
  return nameFrom(value);
};

export const checkedCode = (value: string): OrganizationResult<string> =>
  isEntityCode(value) ? accept(value) : refuse('code_malformed', { code: value });

/**
 * Tenant-authored metadata (AD-005).
 *
 * Deliberately opaque: a customer that needs to record a regulator's branch identifier against
 * every branch should not have to wait for a schema change, and this product should not acquire
 * a column for one customer's regulator. It is stored, returned and never interpreted — no rule
 * in this module reads a metadata key, because a rule that did would be a business rule hidden
 * in a customer's data.
 */
export type Metadata = Readonly<Record<string, string>>;

const METADATA_KEY_LIMIT = 64;
const METADATA_VALUE_LIMIT = 1024;

export const checkedMetadata = (value: Metadata | undefined): OrganizationResult<Metadata> => {
  const entries = Object.entries(value ?? {});
  const oversized = entries.find(
    ([key, entry]) => key.length > METADATA_KEY_LIMIT || entry.length > METADATA_VALUE_LIMIT,
  );

  if (oversized !== undefined) return refuse('metadata_entry_too_long', { key: oversized[0] });
  return accept(Object.fromEntries(entries));
};
