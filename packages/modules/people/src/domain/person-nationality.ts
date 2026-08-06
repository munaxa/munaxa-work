import { uuidV7, type EventOrigin } from '@work/kernel';

import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { isCountryCode } from './people-vocabulary.js';
import { PersonRecord, type PersonRecordState } from './person-record.js';

/**
 * A citizenship this person holds.
 *
 * A row rather than a column, because dual and triple nationality is ordinary in the workforces
 * this product is sold into, and a single `nationality` column forces somebody to choose which of
 * their citizenships the system is allowed to know about. Several markets' social insurance rules
 * turn on whether the person holds the *local* nationality among others — a column would make
 * that question unanswerable for exactly the people it is asked about.
 *
 * **Nationality is an input to statutory rules and never a business rule in itself** (00B). This
 * module records which citizenships somebody holds and attaches no meaning at all: nothing here
 * branches on a country code, and a person's country of *employment* comes from their legal entity
 * (ADR-0035), never from their passport. A module that decided anything from a nationality would
 * be a module deciding something about a person from where they were born.
 */

export interface PersonNationalityState extends PersonRecordState {
  /** ISO 3166-1 alpha-2, validated by shape and never against a list. */
  readonly countryCode: string;
  /**
   * The one a person would name first. Not a ranking this product assigns — it is what goes on a
   * form that has room for one, and the person chooses it.
   */
  readonly isPrimary: boolean;
  readonly acquiredOn?: string;
}

export interface RecordNationality {
  readonly tenantId: string;
  readonly personId: string;
  readonly countryCode: string;
  readonly isPrimary?: boolean;
  readonly acquiredOn?: string;
}

export class PersonNationality extends PersonRecord<PersonNationalityState> {
  private constructor(state: PersonNationalityState) {
    super(state, 'PersonNationality', PeopleEvents.nationalityWithdrawn);
  }

  public static record(
    request: RecordNationality,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonNationality> {
    if (!isCountryCode(request.countryCode)) {
      return refuse('country_code_malformed', { country: request.countryCode });
    }

    const nationality = new PersonNationality({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      countryCode: request.countryCode,
      isPrimary: request.isPrimary ?? false,
      ...(request.acquiredOn === undefined ? {} : { acquiredOn: request.acquiredOn }),
      version: 0,
    });

    nationality.raise(
      PeopleEvents.nationalityRecorded,
      {
        nationalityId: nationality.id,
        personId: request.personId,
        countryCode: request.countryCode,
      },
      origin,
      occurredAt,
    );
    return accept(nationality);
  }

  public static rehydrate(state: PersonNationalityState): PersonNationality {
    return new PersonNationality(state);
  }

  public get countryCode(): string {
    return this.state.countryCode;
  }

  public get isPrimary(): boolean {
    return this.state.isPrimary;
  }

  /** Demotes this nationality, which is what recording a new primary one does. */
  public demote(): void {
    this.state = { ...this.state, isPrimary: false };
  }
}
