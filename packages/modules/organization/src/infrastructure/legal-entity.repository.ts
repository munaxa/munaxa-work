import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { LegalEntityStore } from '../application/organization-ports.js';
import type { LegalEntityState } from '../domain/legal-entity.js';
import type { BilingualName, Metadata } from '../domain/organization-aggregate.js';
import type { OrganizationStatus } from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface LegalEntityRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly unit_id: string;
  readonly country_code: string;
  readonly registered_name: BilingualName;
  readonly registration_number: string;
  readonly tax_identifier: string | null;
  readonly currency_code: string;
  readonly incorporated_on: Date | null;
  readonly status: string;
  readonly metadata: Metadata;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, unit_id, country_code, registered_name, registration_number, tax_identifier, currency_code, incorporated_on, status, metadata, effective_from, effective_to, version';

const toState = (row: LegalEntityRow): LegalEntityState => ({
  id: row.id,
  tenantId: row.tenant_id,
  unitId: row.unit_id,
  countryCode: row.country_code,
  registeredName: row.registered_name,
  registrationNumber: row.registration_number,
  ...(row.tax_identifier === null ? {} : { taxIdentifier: row.tax_identifier }),
  currencyCode: row.currency_code,
  ...(row.incorporated_on === null ? {} : { incorporatedOn: row.incorporated_on }),
  status: row.status as OrganizationStatus,
  metadata: row.metadata,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

export class LegalEntityRepository
  extends Repository<LegalEntityRow & { id: string; version: number }>
  implements LegalEntityStore
{
  public constructor() {
    super('legal_entity');
  }

  public async byId(transaction: Transaction, id: string): Promise<LegalEntityState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async forUnit(
    transaction: Transaction,
    unitId: string,
  ): Promise<LegalEntityState | undefined> {
    const rows = await transaction.execute<LegalEntityRow>(
      `select ${COLUMNS} from legal_entity
        where tenant_id = $1 and unit_id = $2 and deleted_at is null`,
      [transaction.tenantId, unitId],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /**
   * Every registration on a set of units, in one read.
   *
   * This is what resolving a unit's governing country calls: the ancestor chain is known, and
   * asking for its registrations one unit at a time would be a query per level of a hierarchy
   * whose depth is deliberately unbounded (AD-003).
   */
  public async forUnits(
    transaction: Transaction,
    unitIds: readonly string[],
  ): Promise<readonly LegalEntityState[]> {
    if (unitIds.length === 0) return [];

    const rows = await transaction.execute<LegalEntityRow>(
      `select ${COLUMNS} from legal_entity
        where tenant_id = $1 and unit_id = any($2::uuid[]) and deleted_at is null`,
      [transaction.tenantId, [...unitIds]],
    );
    return rows.map(toState);
  }

  public async list(transaction: Transaction): Promise<readonly LegalEntityState[]> {
    const rows = await transaction.execute<LegalEntityRow>(
      `select ${COLUMNS} from legal_entity
        where tenant_id = $1 and deleted_at is null order by country_code, registration_number`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: LegalEntityState): Promise<void> {
    await insertRow(
      transaction,
      'legal_entity',
      {
        id: state.id,
        tenant_id: state.tenantId,
        unit_id: state.unitId,
        country_code: state.countryCode,
        registered_name: JSON.stringify(state.registeredName),
        registration_number: state.registrationNumber,
        tax_identifier: state.taxIdentifier ?? null,
        currency_code: state.currencyCode,
        incorporated_on: state.incorporatedOn ?? null,
        status: state.status,
        metadata: JSON.stringify(state.metadata),
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  /**
   * `country_code` is deliberately absent from the assignment list.
   *
   * The domain refuses to change it and the database has no path to change it either: an entity
   * that changed country is a different registration under a different law, and re-pointing this
   * one would silently recompute every past statutory figure against rules that never applied.
   */
  public async update(
    transaction: Transaction,
    state: LegalEntityState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      registered_name: JSON.stringify(state.registeredName),
      registration_number: state.registrationNumber,
      tax_identifier: state.taxIdentifier ?? null,
      currency_code: state.currencyCode,
      status: state.status,
      metadata: JSON.stringify(state.metadata),
      effective_to: state.effectiveTo ?? null,
    });
  }
}
