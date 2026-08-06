import { uuidV7, type EventOrigin } from '@work/kernel';

import { checkedText, nameFrom, type BilingualName } from './people-aggregate.js';
import { PeopleEvents } from './people-events.js';
import { accept, refuse, type PeopleResult } from './people-rejection.js';
import { isCountryCode, type AddressKind } from './people-vocabulary.js';
import { VersionedChild, type VersionedChildState } from './versioned-child.js';

/**
 * Where a person lives or receives post, and from when.
 *
 * A versioned child entity for the same reason a contact is: "which address was on file when that
 * settlement letter was posted" is a question about a date, and a registry that overwrote the
 * value could not answer it.
 *
 * **No address format is assumed.** There is no `state`, no `county`, no five-digit postal code
 * and no required ordering of the lines, because an address that fits one country's form does not
 * fit another's — and 00B forbids a country being wired into a business module. What is held is
 * an ordered list of lines the customer wrote, a city, an optional region, an optional postal
 * code, and the country as a two-letter *shape*. Validating a postal code against a country's
 * pattern is country-pack content (Phase 11.1), not this module's.
 *
 * The lines are `LocalizedText`-shaped for the same reason a name is: an Arabic-speaking courier
 * needs the Arabic address, and a registry holding only the English form produces an envelope
 * nobody in Riyadh can deliver.
 */

export interface PersonAddressState extends VersionedChildState {
  readonly kind: AddressKind;
  /** The street lines, in the order the customer wrote them, in both first-class languages. */
  readonly lines: readonly BilingualName[];
  readonly city: BilingualName;
  readonly region?: BilingualName;
  readonly postalCode?: string;
  /** ISO 3166-1 alpha-2, validated by shape and never against a list (00B). */
  readonly countryCode: string;
}

export interface RecordAddress {
  readonly tenantId: string;
  readonly personId: string;
  readonly kind: AddressKind;
  readonly lines: readonly Readonly<Record<string, string>>[];
  readonly city: Readonly<Record<string, string>>;
  readonly region?: Readonly<Record<string, string>>;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
}

const LINE_LIMIT = 8;
const POSTAL_CODE_LIMIT = 16;

export class PersonAddress extends VersionedChild<PersonAddressState> {
  private constructor(state: PersonAddressState) {
    super(state, 'PersonAddress', PeopleEvents.addressClosed);
  }

  public static record(
    request: RecordAddress,
    origin: EventOrigin,
    occurredAt: Date,
  ): PeopleResult<PersonAddress> {
    if (!isCountryCode(request.countryCode)) {
      return refuse('country_code_malformed', { country: request.countryCode });
    }

    const lines = checkedLines(request.lines);

    if (!lines.ok) return lines;

    const place = checkedPlace(request);

    if (!place.ok) return place;

    const postalCode = checkedPostalCode(request.postalCode);

    if (!postalCode.ok) return postalCode;

    const address = new PersonAddress({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      personId: request.personId,
      kind: request.kind,
      lines: lines.value,
      ...place.value,
      ...postalCode.value,
      countryCode: request.countryCode,
      effectiveFrom: request.effectiveFrom,
      ...(request.effectiveTo === undefined ? {} : { effectiveTo: request.effectiveTo }),
      version: 0,
    });

    // The kind and the country. Not the street.
    address.raise(
      PeopleEvents.addressChanged,
      {
        addressId: address.id,
        personId: request.personId,
        kind: request.kind,
        countryCode: request.countryCode,
        effectiveFrom: request.effectiveFrom,
      },
      origin,
      occurredAt,
    );
    return accept(address);
  }

  public static rehydrate(state: PersonAddressState): PersonAddress {
    return new PersonAddress(state);
  }

  public get kind(): AddressKind {
    return this.state.kind;
  }

  public get countryCode(): string {
    return this.state.countryCode;
  }
}

const checkedLines = (
  lines: readonly Readonly<Record<string, string>>[],
): PeopleResult<readonly BilingualName[]> => {
  if (lines.length === 0) return refuse('address_requires_a_line');
  if (lines.length > LINE_LIMIT) return refuse('address_has_too_many_lines');

  const checked: BilingualName[] = [];

  for (const line of lines) {
    const name = nameFrom(line);

    if (!name.ok) return name;
    checked.push(name.value);
  }
  return accept(checked);
};

const checkedPlace = (
  request: Pick<RecordAddress, 'city' | 'region'>,
): PeopleResult<{ readonly city: BilingualName; readonly region?: BilingualName }> => {
  const city = nameFrom(request.city);

  if (!city.ok) return city;
  if (request.region === undefined) return accept({ city: city.value });

  const region = nameFrom(request.region);

  if (!region.ok) return region;
  return accept({ city: city.value, region: region.value });
};

const checkedPostalCode = (
  value: string | undefined,
): PeopleResult<{ readonly postalCode?: string }> => {
  if (value === undefined) return accept({});

  const checked = checkedText(value, 'postalCode', POSTAL_CODE_LIMIT);

  if (!checked.ok) return checked;
  return accept({ postalCode: checked.value });
};
