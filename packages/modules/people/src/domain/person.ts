import { uuidV7, type EventOrigin } from '@work/kernel';

import {
  PeopleAggregate,
  checkedCivilDate,
  checkedCode,
  checkedMetadata,
  type Metadata,
} from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { acceptsAmendment, isEntityCode, type PersonStatus } from './people-vocabulary.js';

/**
 * A Person: one permanent human identity.
 *
 * Business relationships change and identity does not. The same Person may be hired, promoted,
 * made a manager, leave, and return four years later — and remain one Person throughout, with one
 * identifier every other module references (AD-001, AD-006). That is the whole reason this
 * aggregate exists separately from Employment.
 *
 * **What this aggregate deliberately has no field for.** No department, company, branch, division,
 * section, team, position, manager, cost centre, shift or supervisor (AD-003). No salary, no
 * payroll figure (AD-004). No attendance (AD-005). Employment references Person; Person never
 * references Employment (AD-002), and the absence of those columns is that boundary being kept
 * rather than described.
 *
 * **What is not here either, and is elsewhere in this module.** The person's *name* is not a
 * column on this row. A legal name changes — marriage, naturalisation, a court correction — and
 * "what was this person's legal name on the date they signed that contract" is a question with
 * legal weight and exactly one right answer. So the name is a versioned child entity on its own
 * timeline (`PersonName`), and this aggregate holds no cached copy of it, because a cached copy
 * is a second answer. See ADR-0037.
 *
 * The facts that *are* here are the ones that do not have a history: which human being this is
 * (their number), when they were born, where, and where the record stands in its lifecycle.
 */

export interface PersonState {
  readonly id: string;
  readonly tenantId: string;
  /** The tenant's own reference for this person. Every customer already has one. */
  readonly personNumber: string;
  /**
   * A civil date, not an instant. `1990-03-14` is the same date in Riyadh and in London; stored
   * as a timestamp it shifts across a zone boundary and changes somebody's age, their eligibility
   * and — in several of this product's markets — their retirement date.
   */
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  /**
   * A tenant-supplied code, never an enumeration this product ships.
   *
   * Gender is an input to statutory rules in most of this product's markets, and the categories a
   * given authority recognises are that authority's, not ours. A fixed list here would be a
   * business rule about people hardcoded in a registry, and a country whose form does not match it
   * would need a code change — which 00B forbids.
   */
  readonly genderCode?: string;
  /** Likewise a code. Marital status drives allowances and dependants in several markets. */
  readonly maritalStatusCode?: string;
  readonly status: PersonStatus;
  /**
   * A reference into the document store, never bytes in a row. A photograph is biometric-adjacent
   * personal data with its own retention rules, and a database column is the one place it cannot
   * be given them.
   */
  readonly photoDocumentId?: string;
  /** Set when this record was found to be the same human being as another (AD-001). */
  readonly mergedIntoPersonId?: string;
  readonly metadata: Metadata;
  readonly version: number;
}

export interface CreatePerson {
  readonly tenantId: string;
  readonly personNumber: string;
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
  readonly metadata?: Metadata;
}

export interface AmendPersonDetails {
  readonly dateOfBirth?: string;
  readonly placeOfBirth?: string;
  readonly genderCode?: string;
  readonly maritalStatusCode?: string;
}

/**
 * Nobody alive was born before this, and nobody is born tomorrow.
 *
 * A bound rather than a rule about employment age: minimum working age is statutory, varies by
 * country and by industry, and belongs to the country pack (00B). What this refuses is a typo —
 * `2960` for `1960` — which otherwise reaches a payroll calculation as a plausible number.
 */
const EARLIEST_PLAUSIBLE_BIRTH = '1900-01-01';

export class Person extends PeopleAggregate {
  private constructor(private state: PersonState) {
    super(state.id, state.tenantId, state.version, 'Person');
  }

  /**
   * Every check runs and the first failure returns, in sequence rather than nested.
   *
   * A chain of nested callbacks reads as one expression and hides which check produced a refusal
   * four levels down; early returns keep each rule on its own line, which is what somebody
   * debugging a rejected import is actually looking for.
   */
  public static create(
    request: CreatePerson,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<Person> {
    const personNumber = checkedCode(request.personNumber);

    if (!personNumber.ok) return personNumber;

    const details = checkedDetails(request, occurredAt);

    if (!details.ok) return details;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const person = new Person({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personNumber: personNumber.value,
      ...details.value,
      status: 'draft',
      metadata: metadata.value,
      version: 0,
    });

    // The event names the person and nothing about them. Every consumer that is entitled to their
    // details asks the application service, where the permission is checked.
    person.raise(
      PeopleEvents.personCreated,
      { personId: person.id, personNumber: personNumber.value },
      origin,
      occurredAt,
    );
    return accept(person);
  }

  public static rehydrate(state: PersonState): Person {
    return new Person(state);
  }

  public get personNumber(): string {
    return this.state.personNumber;
  }

  public get currentStatus(): PersonStatus {
    return this.state.status;
  }

  public get dateOfBirth(): string | undefined {
    return this.state.dateOfBirth;
  }

  /**
   * Corrects the facts that have no history.
   *
   * A date of birth changing is a *correction* rather than a change: nobody's date of birth moves,
   * so a timeline of birth dates would model something that cannot happen. The previous value
   * travels in the event, so the correction is reconstructible from the log (AD-009).
   */
  public amendDetails(
    request: AmendPersonDetails,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonState> {
    if (!acceptsAmendment(this.state.status)) {
      return refuse('person_merged', { status: this.state.status });
    }

    const details = checkedDetails(request, occurredAt);

    if (!details.ok) return details;

    // Which fields were corrected, never what they were corrected from or to. A payload carrying
    // a date of birth would put it into every consumer's log permanently.
    const changed = Object.keys(details.value);

    this.state = { ...this.state, ...details.value };
    this.raise(
      PeopleEvents.personDetailsAmended,
      { personId: this.id, fields: changed },
      origin,
      occurredAt,
    );
    return accept(this.state);
  }

  /**
   * Moves the person through their lifecycle.
   *
   * Archiving is not deleting and never becomes one: identity is permanent (AD-009), and every
   * employment, payslip and letter that ever pointed here must still resolve. `merged` is set by
   * `mergeInto` rather than here, because a merge needs the record it merges into.
   */
  public changeStatus(
    status: PersonStatus,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonStatus> {
    if (status === 'merged') return refuse('merge_is_not_a_status_change');
    if (this.state.status === 'merged') return refuse('person_merged', { status: 'merged' });
    if (status === this.state.status) return refuse('person_already_in_status', { status });

    const previous = this.state.status;

    this.state = { ...this.state, status };
    this.raise(
      PeopleEvents.personStatusChanged,
      { personId: this.id, from: previous, to: status },
      origin,
      occurredAt,
    );
    return accept(status);
  }

  /**
   * Records that this record is the same human being as another (AD-001).
   *
   * The record is redirected, never removed. Everything that ever referenced it — an employment,
   * a payslip, a leave balance from six years ago — must still resolve, and a delete would break
   * exactly the references a merge exists to reconcile.
   */
  public mergeInto(
    survivorId: string,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<string> {
    if (survivorId === this.id) return refuse('person_cannot_merge_into_itself');
    if (this.state.status === 'merged') return refuse('person_merged', { status: 'merged' });

    this.state = { ...this.state, status: 'merged', mergedIntoPersonId: survivorId };
    this.raise(
      PeopleEvents.personMerged,
      { personId: this.id, mergedIntoPersonId: survivorId },
      origin,
      occurredAt,
    );
    return accept(survivorId);
  }

  public reviseMetadata(
    metadata: Metadata,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<Metadata> {
    if (!acceptsAmendment(this.state.status)) {
      return refuse('person_merged', { status: this.state.status });
    }

    const checked = checkedMetadata(metadata);

    if (!checked.ok) return checked;

    this.state = { ...this.state, metadata: checked.value };
    this.raise(
      PeopleEvents.personMetadataChanged,
      { personId: this.id, keys: Object.keys(checked.value) },
      origin,
      occurredAt,
    );
    return accept(checked.value);
  }

  /** Attaches a photograph held in the document store. Passing nothing removes the reference. */
  public setPhoto(
    documentId: string | undefined,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<string | undefined> {
    if (!acceptsAmendment(this.state.status)) {
      return refuse('person_merged', { status: this.state.status });
    }
    if (documentId !== undefined && !isEntityCode(documentId)) {
      return refuse('document_reference_malformed');
    }

    const { photoDocumentId: _removed, ...withoutPhoto } = this.state;

    this.state =
      documentId === undefined ? withoutPhoto : { ...withoutPhoto, photoDocumentId: documentId };
    this.raise(
      PeopleEvents.personPhotoChanged,
      { personId: this.id, attached: documentId !== undefined },
      origin,
      occurredAt,
    );
    return accept(documentId);
  }

  public snapshot(): PersonState {
    return { ...this.state, version: this.version };
  }
}

/** The optional facts, checked together so `create` and `amendDetails` cannot diverge. */
const checkedDetails = (
  request: AmendPersonDetails,
  occurredAt: Date,
): PeopleResult<AmendPersonDetails> => {
  const born = checkedDateOfBirth(request.dateOfBirth, occurredAt);

  if (!born.ok) return born;

  const codes = checkedOptionalCodes(request);

  if (!codes.ok) return codes;

  return accept({
    ...(born.value === undefined ? {} : { dateOfBirth: born.value }),
    ...(request.placeOfBirth === undefined ? {} : { placeOfBirth: request.placeOfBirth.trim() }),
    ...codes.value,
  });
};

const checkedDateOfBirth = (
  value: string | undefined,
  occurredAt: Date,
): PeopleResult<string | undefined> => {
  if (value === undefined) return accept(undefined);

  const checked = checkedCivilDate(value, 'dateOfBirth');

  if (!checked.ok) return checked;
  if (checked.value < EARLIEST_PLAUSIBLE_BIRTH) return refuse('date_of_birth_implausible');

  const today = occurredAt.toISOString().slice(0, 10);

  if (checked.value > today) return refuse('date_of_birth_in_the_future');
  return accept(checked.value);
};

const checkedOptionalCodes = (
  request: AmendPersonDetails,
): PeopleResult<{ readonly genderCode?: string; readonly maritalStatusCode?: string }> => {
  const gender = request.genderCode;
  const marital = request.maritalStatusCode;

  if (gender !== undefined && !isEntityCode(gender)) {
    return refuse('code_malformed', { code: gender });
  }
  if (marital !== undefined && !isEntityCode(marital)) {
    return refuse('code_malformed', { code: marital });
  }
  return accept({
    ...(gender === undefined ? {} : { genderCode: gender }),
    ...(marital === undefined ? {} : { maritalStatusCode: marital }),
  });
};
