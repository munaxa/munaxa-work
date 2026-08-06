import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  checkedCivilDate,
  checkedCivilPeriod,
  checkedText,
  nameFrom,
  optionalNameFrom,
  type BilingualName,
} from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { isCountryCode, type HistoryKind } from './people-vocabulary.js';
import { PersonRecord, type PersonRecordState } from './person-record.js';

/**
 * A period of the person's life before, or outside, this employer: their education, their
 * professional experience elsewhere, and the certifications they hold.
 *
 * **None of this is employment with this company.** Employment, its contract and its assignment
 * are Phase 5's, and this module holds no assignment (AD-002). What is here is the history the
 * person brought with them — the degree on their CV, the four years at a previous employer, the
 * professional licence that expires next March.
 *
 * One aggregate for all three because they are one shape: an organization, a title, a period, a
 * country, and an optional expiry. Splitting them into three classes differing in the name of the
 * organization field would be three places to fix the next rule that applies to all three.
 *
 * The one behaviour that differs by kind is enforced rather than assumed: a **certification may
 * expire and the other two may not**, because "expired" is a meaningful state for a licence and a
 * meaningless one for a degree.
 */

export interface PersonHistoryState extends PersonRecordState {
  readonly kind: HistoryKind;
  /** The university, the employer, or the body that issued the certification. */
  readonly organizationName: BilingualName;
  /** The degree, the job title, or the name of the certification. */
  readonly title: BilingualName;
  /** The subject of a degree. Absent for the other two. */
  readonly fieldOfStudy?: BilingualName;
  /** ISO 3166-1 alpha-2, by shape only. */
  readonly countryCode?: string;
  readonly fromDate: string;
  readonly toDate?: string;
  /** A certification's expiry. Refused on an education or an experience record. */
  readonly expiresOn?: string;
  /** The licence or credential number, where the issuer gives one. */
  readonly reference?: string;
}

export interface RecordHistory {
  readonly tenantId: string;
  readonly personId: string;
  readonly kind: HistoryKind;
  readonly organizationName: Readonly<Record<string, string>>;
  readonly title: Readonly<Record<string, string>>;
  readonly fieldOfStudy?: Readonly<Record<string, string>>;
  readonly countryCode?: string;
  readonly fromDate: string;
  readonly toDate?: string;
  readonly expiresOn?: string;
  readonly reference?: string;
}

const REFERENCE_LIMIT = 128;

export class PersonHistory extends PersonRecord<PersonHistoryState> {
  private constructor(state: PersonHistoryState) {
    super(state, 'PersonHistory', PeopleEvents.historyWithdrawn);
  }

  public static record(
    request: RecordHistory,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonHistory> {
    const names = checkedNames(request);

    if (!names.ok) return names;

    const period = checkedCivilPeriod(request.fromDate, request.toDate, 'fromDate');

    if (!period.ok) return period;

    const expiry = checkedExpiry(request);

    if (!expiry.ok) return expiry;

    const extras = checkedExtras(request);

    if (!extras.ok) return extras;

    const history = new PersonHistory({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      kind: request.kind,
      ...names.value,
      fromDate: period.value.from,
      ...(period.value.to === undefined ? {} : { toDate: period.value.to }),
      ...expiry.value,
      ...extras.value,
      version: 0,
    });

    history.raise(
      PeopleEvents.historyRecorded,
      { historyId: history.id, personId: request.personId, kind: request.kind },
      origin,
      occurredAt,
    );
    return accept(history);
  }

  public static rehydrate(state: PersonHistoryState): PersonHistory {
    return new PersonHistory(state);
  }

  public get kind(): HistoryKind {
    return this.state.kind;
  }

  /** Whether a certification has lapsed as at a date. Always false for the other two kinds. */
  public hasExpiredOn(onDate: string): boolean {
    return this.state.expiresOn !== undefined && this.state.expiresOn < onDate;
  }
}

const checkedNames = (
  request: RecordHistory,
): PeopleResult<{
  readonly organizationName: BilingualName;
  readonly title: BilingualName;
  readonly fieldOfStudy?: BilingualName;
}> => {
  const organizationName = nameFrom(request.organizationName);

  if (!organizationName.ok) return organizationName;

  const title = nameFrom(request.title);

  if (!title.ok) return title;

  const fieldOfStudy = optionalNameFrom(request.fieldOfStudy);

  if (!fieldOfStudy.ok) return fieldOfStudy;
  if (fieldOfStudy.value !== undefined && request.kind !== 'education') {
    return refuse('field_of_study_only_on_education', { kind: request.kind });
  }
  return accept({
    organizationName: organizationName.value,
    title: title.value,
    ...(fieldOfStudy.value === undefined ? {} : { fieldOfStudy: fieldOfStudy.value }),
  });
};

const checkedExpiry = (request: RecordHistory): PeopleResult<{ readonly expiresOn?: string }> => {
  if (request.expiresOn === undefined) return accept({});
  if (request.kind !== 'certification') {
    return refuse('only_a_certification_expires', { kind: request.kind });
  }

  const checked = checkedCivilDate(request.expiresOn, 'expiresOn');

  if (!checked.ok) return checked;
  if (checked.value < request.fromDate)
    return refuse('period_ends_before_it_begins', {
      field: 'expiresOn',
    });
  return accept({ expiresOn: checked.value });
};

const checkedExtras = (
  request: RecordHistory,
): PeopleResult<{ readonly countryCode?: string; readonly reference?: string }> => {
  if (request.countryCode !== undefined && !isCountryCode(request.countryCode)) {
    return refuse('country_code_malformed', { country: request.countryCode });
  }
  if (request.reference === undefined) {
    return accept({
      ...(request.countryCode === undefined ? {} : { countryCode: request.countryCode }),
    });
  }

  const reference = checkedText(request.reference, 'reference', REFERENCE_LIMIT);

  if (!reference.ok) return reference;
  return accept({
    ...(request.countryCode === undefined ? {} : { countryCode: request.countryCode }),
    reference: reference.value,
  });
};
