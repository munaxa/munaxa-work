import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedCode, checkedText } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, type PeopleResult } from './people-rejection.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';

/**
 * A personal configuration this person chose, and from when.
 *
 * Deliberately a key and an opaque value rather than columns. This module holds the *person's*
 * preferences — dietary requirement, shirt size for a uniform, whether they consent to appearing
 * in a directory photograph — and every one of those is a customer's own list. A column per
 * preference would be a schema change per customer.
 *
 * **This is not the user's application preferences.** Language, calendar, numerals and time zone
 * are `identity`'s `user_preference`, owned since Phase 2 and defaulted from the tenant's settings
 * since Phase 3 (ADR-0036). Two modules holding a language preference would produce two answers
 * on the first screen that read the wrong one, so this module does not have one.
 *
 * Versioned because a preference is a statement somebody made at a time. "Did this person consent
 * to their photograph being published when that brochure went to print" is a question about a
 * date, and consent that could be overwritten could not be evidenced.
 */

export interface PersonPreferenceState extends VersionedChildState {
  readonly preferenceKey: string;
  /** Opaque. No rule in this module reads a preference value. */
  readonly value: string;
}

export interface RecordPreference {
  readonly tenantId: string;
  readonly personId: string;
  readonly preferenceKey: string;
  readonly value: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

const VALUE_LIMIT = 1024;

export class PersonPreference extends VersionedChild<PersonPreferenceState> {
  private constructor(state: PersonPreferenceState) {
    super(state, 'PersonPreference', PeopleEvents.preferenceChanged);
  }

  public static record(
    request: RecordPreference,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonPreference> {
    const key = checkedCode(request.preferenceKey);

    if (!key.ok) return key;

    const value = checkedText(request.value, 'value', VALUE_LIMIT);

    if (!value.ok) return value;

    const preference = new PersonPreference({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      preferenceKey: key.value,
      value: value.value,
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    preference.raise(
      PeopleEvents.preferenceChanged,
      {
        preferenceId: preference.id,
        personId: request.personId,
        preferenceKey: key.value,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(preference);
  }

  public static rehydrate(state: PersonPreferenceState): PersonPreference {
    return new PersonPreference(state);
  }

  public get preferenceKey(): string {
    return this.state.preferenceKey;
  }
}
