import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedText } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import {
  isEmailAddress,
  isTelephoneNumber,
  normalizeTelephone,
  type ContactChannel,
  type ContactPurpose,
} from './people-vocabulary.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';

/**
 * How a person is reached, and from when.
 *
 * A versioned child entity, because a phone number that changed is not a phone number that was
 * wrong. "Which number did we have for this person when we tried to reach them on the day of the
 * incident" is a question an employee-relations case (Phase 5.2) asks about a date, and a registry
 * that overwrote the value could not answer it.
 *
 * The channel is validated according to what it is: an email is checked as an email, a telephone
 * number is normalized to E.164 and checked as one. Normalization is not cosmetic — a number
 * recorded as `+966 50 123 4567` on one screen and `+966501234567` on another is two numbers to a
 * duplicate check and one number to a human being, and AD-001 is about the human being.
 */

export interface PersonContactState extends VersionedChildState {
  readonly channel: ContactChannel;
  readonly purpose: ContactPurpose;
  /** Normalized: lower-cased for email, separators stripped for telephone. */
  readonly value: string;
  /** As entered, kept so a screen shows the customer their own formatting back. */
  readonly displayValue: string;
  readonly isPrimary: boolean;
}

export interface RecordContact {
  readonly tenantId: string;
  readonly personId: string;
  readonly channel: ContactChannel;
  readonly purpose: ContactPurpose;
  readonly value: string;
  readonly isPrimary?: boolean;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

const VALUE_LIMIT = 320;

export class PersonContact extends VersionedChild<PersonContactState> {
  private constructor(state: PersonContactState) {
    super(state, 'PersonContact', PeopleEvents.contactClosed);
  }

  public static record(
    request: RecordContact,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonContact> {
    const entered = checkedText(request.value, 'value', VALUE_LIMIT);

    if (!entered.ok) return entered;

    const normalized = normalizedFor(request.channel, entered.value);

    if (!normalized.ok) return normalized;

    const contact = new PersonContact({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      channel: request.channel,
      purpose: request.purpose,
      value: normalized.value,
      displayValue: entered.value,
      isPrimary: request.isPrimary ?? false,
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    // The channel and the purpose, never the address or the number.
    contact.raise(
      PeopleEvents.contactChanged,
      {
        contactId: contact.id,
        personId: request.personId,
        channel: request.channel,
        purpose: request.purpose,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(contact);
  }

  public static rehydrate(state: PersonContactState): PersonContact {
    return new PersonContact(state);
  }

  public get channel(): ContactChannel {
    return this.state.channel;
  }

  public get value(): string {
    return this.state.value;
  }
}

/**
 * The comparable form of a contact value.
 *
 * Exported because duplicate detection compares against it: the same address entered as
 * `Sara@Example.com` and `sara@example.com` is one mailbox, and a check that missed that would
 * create a second Person for one human being.
 */
export const normalizedFor = (channel: ContactChannel, value: string): PeopleResult<string> => {
  if (channel === 'email') {
    const lowered = value.toLowerCase();
    return isEmailAddress(lowered) ? accept(lowered) : refuse('email_malformed');
  }
  if (channel === 'mobile' || channel === 'phone' || channel === 'fax') {
    const stripped = normalizeTelephone(value);
    return isTelephoneNumber(stripped) ? accept(stripped) : refuse('telephone_malformed');
  }
  // A messaging handle has no universal shape — a handle is whatever the platform accepts — so it
  // is compared case-insensitively and otherwise taken as given.
  return accept(value.toLowerCase());
};
