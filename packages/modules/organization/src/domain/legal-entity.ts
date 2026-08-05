import { flatMap, map, uuidV7, type EventOrigin } from '@work/kernel';

import {
  OrganizationAggregate,
  checkedMetadata,
  nameFrom,
  type BilingualName,
  type Metadata,
} from './organization-aggregate.js';
import { OrganizationEvents } from './organization-events.js';
import { accept, refuse, type OrganizationResult } from './organization-rejection.js';
import {
  isCountryCode,
  isCurrencyCode,
  type OrganizationStatus,
} from './organization-vocabulary.js';

/**
 * A legally registered business entity, and — the part every later phase depends on — the
 * country whose law governs the people employed by it.
 *
 * This is where 00B's hardest rule becomes a column: *an employment resolves its country pack
 * from its legal entity, not from the tenant.* A tenant is a customer, and a customer may
 * operate a Saudi company and a Jordanian one at once; end of service, social insurance and the
 * wage protection file differ between them, and a tenant-level country would make that
 * unexpressible without a second tenant per country. Phase 11.1 reads `countryCode` from here,
 * and it will be right because there was never anywhere else for it to read it from.
 *
 * Nothing about any particular country appears in this file. `countryCode` is validated as an
 * ISO 3166-1 alpha-2 *shape*, never against a list: a hardcoded list is a code change every time
 * the product sells somewhere new, which 00B prohibits outright.
 *
 * The entity is a companion to a unit rather than a unit of its own. A legal entity *is* a node
 * in the structure — things sit under it — and giving it a second identity would mean two
 * answers to "what is under Munaxa Arabia Ltd".
 */

export interface LegalEntityState {
  readonly id: string;
  readonly tenantId: string;
  /** The unit this registration belongs to. One registration per unit. */
  readonly unitId: string;
  /** ISO 3166-1 alpha-2. The single input Phase 11.1 resolves a country pack from. */
  readonly countryCode: string;
  /** The name as registered with the authority, which is often not the trading name. */
  readonly registeredName: BilingualName;
  readonly registrationNumber: string;
  readonly taxIdentifier?: string;
  /** ISO 4217. The currency this entity's payroll is denominated in. */
  readonly currencyCode: string;
  readonly incorporatedOn?: Date;
  readonly status: OrganizationStatus;
  readonly metadata: Metadata;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date;
  readonly version: number;
}

export interface RegisterLegalEntity {
  readonly tenantId: string;
  readonly unitId: string;
  readonly countryCode: string;
  readonly registeredName: Readonly<Record<string, string>>;
  readonly registrationNumber: string;
  readonly taxIdentifier?: string;
  readonly currencyCode: string;
  readonly incorporatedOn?: Date;
  readonly metadata?: Metadata;
  readonly effectiveFrom: Date;
}

export class LegalEntity extends OrganizationAggregate {
  private constructor(private state: LegalEntityState) {
    super(state.id, state.tenantId, state.version, 'LegalEntity');
  }

  /** Checks in sequence, first failure returned. See `OrganizationUnit.create` for why. */
  public static register(
    request: RegisterLegalEntity,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<LegalEntity> {
    const jurisdiction = checkedJurisdiction(request.countryCode, request.currencyCode);

    if (!jurisdiction.ok) return jurisdiction;

    const registeredName = nameFrom(request.registeredName);

    if (!registeredName.ok) return registeredName;

    const registrationNumber = checkedRegistration(request.registrationNumber);

    if (!registrationNumber.ok) return registrationNumber;

    const metadata = checkedMetadata(request.metadata);

    if (!metadata.ok) return metadata;

    const entity = new LegalEntity({
      id: uuidV7(occurredAt.getTime()),
      tenantId: request.tenantId,
      unitId: request.unitId,
      countryCode: request.countryCode,
      registeredName: registeredName.value,
      registrationNumber: registrationNumber.value,
      ...(request.taxIdentifier === undefined ? {} : { taxIdentifier: request.taxIdentifier }),
      currencyCode: request.currencyCode,
      ...(request.incorporatedOn === undefined ? {} : { incorporatedOn: request.incorporatedOn }),
      status: 'active',
      metadata: metadata.value,
      effectiveFrom: request.effectiveFrom,
      version: 0,
    });

    entity.raise(
      OrganizationEvents.legalEntityRegistered,
      {
        legalEntityId: entity.id,
        unitId: request.unitId,
        // The fact Phase 11.1 subscribes to: this tenant now operates in this country.
        countryCode: request.countryCode,
        currencyCode: request.currencyCode,
      },
      origin,
      occurredAt,
    );
    return accept(entity);
  }

  public static rehydrate(state: LegalEntityState): LegalEntity {
    return new LegalEntity(state);
  }

  public get unitId(): string {
    return this.state.unitId;
  }

  public get countryCode(): string {
    return this.state.countryCode;
  }

  public get currencyCode(): string {
    return this.state.currencyCode;
  }

  public get currentStatus(): OrganizationStatus {
    return this.state.status;
  }

  /**
   * Amends the registration.
   *
   * The country is deliberately *not* amendable. An entity that changed country did not change
   * its country: it is a different registration under a different law, and re-pointing the
   * existing one would silently recompute every past end-of-service calculation against rules
   * that never applied to it. Registering a new entity and closing this one keeps both answers.
   */
  public amend(
    changes: {
      readonly registeredName?: Readonly<Record<string, string>>;
      readonly registrationNumber?: string;
      readonly taxIdentifier?: string;
      readonly currencyCode?: string;
    },
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<LegalEntityState> {
    if (this.state.status === 'closed') return refuse('legal_entity_closed');
    if (changes.currencyCode !== undefined && !isCurrencyCode(changes.currencyCode)) {
      return refuse('currency_code_malformed', { currency: changes.currencyCode });
    }
    return flatMap(optionalRegistration(changes.registrationNumber), (registrationNumber) =>
      map(optionalRegisteredName(changes.registeredName), (registeredName) => {
        this.state = {
          ...this.state,
          ...(registeredName === undefined ? {} : { registeredName }),
          ...(registrationNumber === undefined ? {} : { registrationNumber }),
          ...(changes.taxIdentifier === undefined ? {} : { taxIdentifier: changes.taxIdentifier }),
          ...(changes.currencyCode === undefined ? {} : { currencyCode: changes.currencyCode }),
        };
        this.raise(
          OrganizationEvents.legalEntityAmended,
          { legalEntityId: this.id, changed: Object.keys(changes) },
          origin,
          occurredAt,
        );
        return this.state;
      }),
    );
  }

  /** Closes the registration from a date. Everything ever employed under it still resolves. */
  public close(
    effectiveTo: Date,
    origin: EventOrigin,
    occurredAt: Date,
  ): OrganizationResult<OrganizationStatus> {
    if (this.state.status === 'closed') return refuse('legal_entity_closed');
    if (effectiveTo.getTime() <= this.state.effectiveFrom.getTime()) {
      return refuse('legal_entity_closed_before_it_existed');
    }

    this.state = { ...this.state, status: 'closed', effectiveTo };
    this.raise(
      OrganizationEvents.legalEntityAmended,
      { legalEntityId: this.id, changed: ['status'], effectiveTo },
      origin,
      occurredAt,
    );
    return accept(this.state.status);
  }

  public existsOn(instant: Date): boolean {
    const time = instant.getTime();
    if (time < this.state.effectiveFrom.getTime()) return false;
    return this.state.effectiveTo === undefined || time < this.state.effectiveTo.getTime();
  }

  public snapshot(): LegalEntityState {
    return { ...this.state, version: this.version };
  }
}

const REGISTRATION_LIMIT = 64;

const checkedJurisdiction = (
  countryCode: string,
  currencyCode: string,
): OrganizationResult<true> => {
  if (!isCountryCode(countryCode))
    return refuse('country_code_malformed', { country: countryCode });
  if (!isCurrencyCode(currencyCode)) {
    return refuse('currency_code_malformed', { currency: currencyCode });
  }
  return accept(true);
};

const checkedRegistration = (value: string): OrganizationResult<string> => {
  const trimmed = value.trim();

  if (trimmed === '' || trimmed.length > REGISTRATION_LIMIT) {
    return refuse('registration_number_malformed');
  }
  return accept(trimmed);
};

const optionalRegistration = (value: string | undefined): OrganizationResult<string | undefined> =>
  value === undefined ? accept(undefined) : checkedRegistration(value);

const optionalRegisteredName = (
  value: Readonly<Record<string, string>> | undefined,
): OrganizationResult<BilingualName | undefined> =>
  value === undefined ? accept(undefined) : nameFrom(value);
