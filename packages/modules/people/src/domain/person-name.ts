import { uuidV7, type EventOrigin } from '@work/kernel';

import { PeopleEvents } from './people-events.js';
import { accept, type PeopleResult } from './people-rejection.js';
import { nameFrom, optionalNameFrom, type BilingualName } from './people-aggregate.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';

/**
 * What a person is called, and from when.
 *
 * This is the aggregate that makes "what was this person's legal name on the date they signed
 * that contract" answerable. A legal name changes — marriage, divorce, naturalisation, a court
 * correction — and a registry that overwrote it would leave every historical contract, letter,
 * payslip and government submission naming somebody who, as far as the system is concerned, never
 * existed.
 *
 * Phase 3 recorded, honestly, that a unit's *attributes* are not queryable as at a past date and
 * pushed that to Phase 21. This phase deliberately does not inherit that for the legal name.
 * The reasoning that made a rename an ordinary correction for an organizational unit does not
 * transfer: a department renamed is the same department, whereas a person's legal name is the
 * thing their signature, their identity documents and their statutory filings are matched
 * against. It is the single attribute in this module where yesterday's value has legal force
 * today. See ADR-0037.
 *
 * The **preferred name** travels on the same period rather than a separate one. A person who
 * marries usually changes both at once, and two independent timelines over the same event would
 * make "what were they called in March" two questions with two answers.
 */

export interface PersonNameState extends VersionedChildState {
  /** The name on their identity documents. Required in both first-class languages. */
  readonly legalName: BilingualName;
  /** What they ask to be called. Optional; half-present is refused, as everywhere else. */
  readonly preferredName?: BilingualName;
}

export interface RecordName {
  readonly tenantId: string;
  readonly personId: string;
  readonly legalName: Readonly<Record<string, string>>;
  readonly preferredName?: Readonly<Record<string, string>>;
  readonly effectiveFrom: Date;
  /**
   * Bounded at creation only when a later period already exists — which happens when a correction
   * is back-dated in front of a change recorded earlier. Ordinary names are open-ended.
   */
  readonly effectiveTo?: Date;
}

export class PersonName extends VersionedChild<PersonNameState> {
  private constructor(state: PersonNameState) {
    super(state, 'PersonName', PeopleEvents.personNameClosed);
  }

  public static record(
    request: RecordName,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonName> {
    const legal = nameFrom(request.legalName);

    if (!legal.ok) return legal;

    const preferred = optionalNameFrom(request.preferredName);

    if (!preferred.ok) return preferred;

    const name = new PersonName({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      legalName: legal.value,
      ...(preferred.value === undefined ? {} : { preferredName: preferred.value }),
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    // The event records that the person was renamed and from when. It carries neither the old
    // name nor the new one: a name is personal data, events fan out to consumers this module does
    // not know, and an event payload is the easiest place to leak one permanently.
    name.raise(
      PeopleEvents.personRenamed,
      {
        nameId: name.id,
        personId: request.personId,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(name);
  }

  public static rehydrate(state: PersonNameState): PersonName {
    return new PersonName(state);
  }

  public get legalName(): BilingualName {
    return this.state.legalName;
  }

  public get preferredName(): BilingualName | undefined {
    return this.state.preferredName;
  }
}

/** Every form of a name, for the search index and for duplicate matching. */
export const namesIn = (state: PersonNameState): readonly string[] =>
  [state.legalName.en, state.legalName.ar, state.preferredName?.en, state.preferredName?.ar].filter(
    (value): value is string => value !== undefined,
  );
