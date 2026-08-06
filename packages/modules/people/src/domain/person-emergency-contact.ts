import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedCode, checkedText, nameFrom, type BilingualName } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { normalizeTelephone, isTelephoneNumber } from './people-vocabulary.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';

/**
 * Who to reach when something has happened to this person.
 *
 * Versioned for a reason that is not bookkeeping. An emergency contact is read at the worst
 * moment somebody will ever have with this employer, and it is read *about a date* — an incident
 * report reconstructed weeks later asks who the company was told to call at the time, not who it
 * would call today.
 *
 * `priority` is an ordering the person chose, not a rank this product assigns: 1 is called first.
 * `relationship` is a code the tenant supplies, because family structures differ by culture and a
 * fixed list of relationships is a product opinion about somebody's family.
 *
 * This is **another human being's personal data held about a third party who never consented to
 * this system**. It is guarded by its own permission rather than folded into the person's general
 * record, and that separation is enforced in `people-permissions.ts` rather than described here.
 */

export interface PersonEmergencyContactState extends VersionedChildState {
  readonly name: BilingualName;
  /** A tenant-supplied code. Family structures differ; a fixed list is a product opinion. */
  readonly relationshipCode: string;
  readonly telephone: string;
  readonly alternateTelephone?: string;
  readonly email?: string;
  /** 1 is called first. The person's own ordering, not a rank this product assigns. */
  readonly priority: number;
}

export interface RecordEmergencyContact {
  readonly tenantId: string;
  readonly personId: string;
  readonly name: Readonly<Record<string, string>>;
  readonly relationshipCode: string;
  readonly telephone: string;
  readonly alternateTelephone?: string;
  readonly email?: string;
  readonly priority?: number;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

const PRIORITY_LIMIT = 20;
const EMAIL_LIMIT = 320;

export class PersonEmergencyContact extends VersionedChild<PersonEmergencyContactState> {
  private constructor(state: PersonEmergencyContactState) {
    super(state, 'PersonEmergencyContact', PeopleEvents.emergencyContactClosed);
  }

  public static record(
    request: RecordEmergencyContact,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonEmergencyContact> {
    const name = nameFrom(request.name);

    if (!name.ok) return name;

    const relationship = checkedCode(request.relationshipCode);

    if (!relationship.ok) return relationship;

    const telephones = checkedTelephones(request);

    if (!telephones.ok) return telephones;

    const priority = request.priority ?? 1;

    if (!Number.isInteger(priority) || priority < 1 || priority > PRIORITY_LIMIT) {
      return refuse('priority_out_of_range', { limit: String(PRIORITY_LIMIT) });
    }

    const contact = new PersonEmergencyContact({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      name: name.value,
      relationshipCode: relationship.value,
      ...telephones.value,
      priority,
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    contact.raise(
      PeopleEvents.emergencyContactChanged,
      {
        emergencyContactId: contact.id,
        personId: request.personId,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(contact);
  }

  public static rehydrate(state: PersonEmergencyContactState): PersonEmergencyContact {
    return new PersonEmergencyContact(state);
  }

  public get priority(): number {
    return this.state.priority;
  }
}

const checkedTelephones = (
  request: Pick<RecordEmergencyContact, 'telephone' | 'alternateTelephone' | 'email'>,
): PeopleResult<{
  readonly telephone: string;
  readonly alternateTelephone?: string;
  readonly email?: string;
}> => {
  const telephone = normalizeTelephone(request.telephone);

  if (!isTelephoneNumber(telephone)) return refuse('telephone_malformed');

  const alternate =
    request.alternateTelephone === undefined
      ? undefined
      : normalizeTelephone(request.alternateTelephone);

  if (alternate !== undefined && !isTelephoneNumber(alternate)) {
    return refuse('telephone_malformed');
  }
  if (request.email !== undefined) {
    const email = checkedText(request.email, 'email', EMAIL_LIMIT);

    if (!email.ok) return email;
    return accept({
      telephone,
      ...(alternate === undefined ? {} : { alternateTelephone: alternate }),
      email: email.value.toLowerCase(),
    });
  }
  return accept({
    telephone,
    ...(alternate === undefined ? {} : { alternateTelephone: alternate }),
  });
};
