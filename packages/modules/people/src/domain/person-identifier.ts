import { uuidV7, type EventOrigin } from '@work/kernel';

import { PeopleAggregate, checkedCivilDate, checkedCode, checkedText } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { isCountryCode } from './people-vocabulary.js';

/**
 * A government or business identifier: a national identifier, a passport, a residency permit, a
 * social insurance number, a tax reference.
 *
 * **The type is a code, never an enumeration this product ships.** Which documents exist and which
 * are required is one country's law, and 00B is explicit that identity document types are country
 * pack content (Phase 11.1). A fixed list here would mean a code change every time this product
 * sells into a new market, and a market whose documents did not fit the list would be unsellable.
 * The type is validated as a *code* and the issuing country as a *shape*, and nothing in this
 * module attaches a meaning to either.
 *
 * **This is the most sensitive data in the product.** A national identifier is the key to
 * somebody's credit, their medical record and their immigration status, and unlike a password it
 * cannot be rotated after a leak. Three things follow, and all three are enforced rather than
 * documented:
 *
 * - The **value never appears in an event**. Events are immutable, fan out to consumers this
 *   module does not know and end up in logs.
 * - The **value never appears in a rejection**. A refusal names the *kind* that clashed, so a
 *   duplicate-identifier message does not put the number into a browser history and a support
 *   ticket.
 * - Matching is done on a **digest**, not on the value. `matchKey` below is what duplicate
 *   detection compares and what the database indexes, so finding the person who already holds an
 *   identifier never requires reading anybody's plaintext.
 */

export interface PersonIdentifierState {
  readonly id: string;
  readonly tenantId: string;
  readonly personId: string;
  /** A code, supplied by the tenant or by a country pack. Never a list this product ships. */
  readonly identifierType: string;
  readonly value: string;
  /** The digest matching and the unique index use. Never reversible to the value. */
  readonly matchKey: string;
  /** ISO 3166-1 alpha-2, validated by shape and never against a list. */
  readonly issuingCountry?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  /**
   * The one a document or a submission should use when the person holds several of a type. A
   * person may hold two valid passports; only one is the one this employer files with.
   */
  readonly isPrimary: boolean;
  readonly withdrawnAt?: Date;
  readonly version: number;
}

export interface RecordIdentifier {
  readonly tenantId: string;
  readonly personId: string;
  readonly identifierType: string;
  readonly value: string;
  readonly issuingCountry?: string;
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly isPrimary?: boolean;
}

export interface AmendIdentifier {
  readonly issuedOn?: string;
  readonly expiresOn?: string;
  readonly isPrimary?: boolean;
}

const VALUE_LIMIT = 64;

/**
 * The comparable form of an identifier value.
 *
 * Case and separators are presentation: `1234-5678-90`, `1234 5678 90` and `1234567890` are one
 * document, and a duplicate check that treated them as three would let the same human being be
 * registered three times — which is exactly what AD-001 forbids.
 */
export const normalizeIdentifier = (value: string): string =>
  value.replace(/[\s.\-/\\]/g, '').toUpperCase();

/**
 * How a value becomes something safe to index and compare.
 *
 * The digest is supplied by the application layer rather than computed here, because it needs a
 * per-deployment secret and the domain reads no configuration. What the domain guarantees is that
 * the *normalized* value is what gets digested, so two spellings of one document produce one key.
 */
export interface IdentifierDigest {
  digest(identifierType: string, normalizedValue: string): string;
}

export class PersonIdentifier extends PeopleAggregate {
  private constructor(private state: PersonIdentifierState) {
    super(state.id, state.tenantId, state.version, 'PersonIdentifier');
  }

  public static record(
    request: RecordIdentifier,
    digest: IdentifierDigest,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonIdentifier> {
    const identifierType = checkedCode(request.identifierType);

    if (!identifierType.ok) return identifierType;

    const value = checkedText(request.value, 'value', VALUE_LIMIT);

    if (!value.ok) return value;

    const normalized = normalizeIdentifier(value.value);

    if (normalized === '') return refuse('identifier_value_empty');

    const country = checkedIssuingCountry(request.issuingCountry);

    if (!country.ok) return country;

    const dates = checkedIdentifierDates(request);

    if (!dates.ok) return dates;

    const identifier = new PersonIdentifier({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      identifierType: identifierType.value,
      value: value.value,
      matchKey: digest.digest(identifierType.value, normalized),
      ...country.value,
      ...dates.value,
      isPrimary: request.isPrimary ?? false,
      version: 0,
    });

    // The kind, never the number.
    identifier.raise(
      PeopleEvents.identifierRecorded,
      {
        identifierId: identifier.id,
        personId: request.personId,
        identifierType: identifierType.value,
      },
      origin,
      occurredAt,
    );
    return accept(identifier);
  }

  public static rehydrate(state: PersonIdentifierState): PersonIdentifier {
    return new PersonIdentifier(state);
  }

  public get identifierType(): string {
    return this.state.identifierType;
  }

  public get matchKey(): string {
    return this.state.matchKey;
  }

  public get personId(): string {
    return this.state.personId;
  }

  public get isWithdrawn(): boolean {
    return this.state.withdrawnAt !== undefined;
  }

  /**
   * Corrects the dates and the primary flag.
   *
   * The **value is not amendable**. A different number is a different document — a renewed
   * passport has a new number and a new expiry, and recording it over the old one would erase the
   * document a five-year-old visa application was made against (AD-009). Renewal is a new
   * identifier and a withdrawal of the old one.
   */
  public amend(
    request: AmendIdentifier,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonIdentifierState> {
    if (this.isWithdrawn) return refuse('identifier_withdrawn');

    const issuedOn = request.issuedOn ?? this.state.issuedOn;
    const expiresOn = request.expiresOn ?? this.state.expiresOn;
    const dates = checkedIdentifierDates({
      ...(issuedOn === undefined ? {} : { issuedOn }),
      ...(expiresOn === undefined ? {} : { expiresOn }),
    });

    if (!dates.ok) return dates;

    this.state = {
      ...this.state,
      ...dates.value,
      isPrimary: request.isPrimary ?? this.state.isPrimary,
    };
    this.raise(
      PeopleEvents.identifierAmended,
      {
        identifierId: this.id,
        personId: this.state.personId,
        identifierType: this.state.identifierType,
      },
      origin,
      occurredAt,
    );
    return accept(this.state);
  }

  /**
   * Withdraws the identifier — a document replaced, revoked or recorded in error.
   *
   * The row survives and keeps its match key, so a withdrawn passport still answers "who held this
   * number" (AD-009). What it stops doing is being offered as current.
   */
  public withdraw(origin: EventOrigin, occurredAt: Date): PeopleResult<Date> {
    if (this.isWithdrawn) return refuse('identifier_withdrawn');

    this.state = { ...this.state, withdrawnAt: occurredAt, isPrimary: false };
    this.raise(
      PeopleEvents.identifierWithdrawn,
      {
        identifierId: this.id,
        personId: this.state.personId,
        identifierType: this.state.identifierType,
      },
      origin,
      occurredAt,
    );
    return accept(occurredAt);
  }

  /** Demotes this identifier, which is what recording a new primary of the same type does. */
  public demote(): void {
    this.state = { ...this.state, isPrimary: false };
  }

  public snapshot(): PersonIdentifierState {
    return { ...this.state, version: this.version };
  }
}

const checkedIssuingCountry = (
  value: string | undefined,
): PeopleResult<{ readonly issuingCountry?: string }> => {
  if (value === undefined) return accept({});
  if (!isCountryCode(value)) return refuse('country_code_malformed', { country: value });
  return accept({ issuingCountry: value });
};

const checkedIdentifierDates = (
  request: Pick<AmendIdentifier, 'issuedOn' | 'expiresOn'>,
): PeopleResult<{ readonly issuedOn?: string; readonly expiresOn?: string }> => {
  const issued = request.issuedOn;
  const expires = request.expiresOn;

  if (issued !== undefined) {
    const checked = checkedCivilDate(issued, 'issuedOn');
    if (!checked.ok) return checked;
  }
  if (expires !== undefined) {
    const checked = checkedCivilDate(expires, 'expiresOn');
    if (!checked.ok) return checked;
  }
  if (issued !== undefined && expires !== undefined && expires < issued) {
    return refuse('identifier_expires_before_issue');
  }
  return accept({
    ...(issued === undefined ? {} : { issuedOn: issued }),
    ...(expires === undefined ? {} : { expiresOn: expires }),
  });
};
