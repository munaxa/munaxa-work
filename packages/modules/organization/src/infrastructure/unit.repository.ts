import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { UnitQuery, UnitStore } from '../application/organization-ports.js';
import type { BilingualName, Metadata } from '../domain/organization-aggregate.js';
import type { OrganizationUnitState } from '../domain/organization-unit.js';
import type { OrganizationStatus } from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface UnitRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly unit_type_id: string;
  readonly code: string;
  readonly name: BilingualName;
  readonly description: BilingualName | null;
  readonly status: string;
  readonly metadata: Metadata;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, unit_type_id, code, name, description, status, metadata, effective_from, effective_to, version';

/**
 * The list filter. Every parameter is referenced, and typed, whether or not its filter is set:
 * PostgreSQL refuses a statement with a parameter it cannot type ("could not determine data type
 * of parameter"), which is what an unset filter left out of the clause used to be. An unset filter
 * is passed as null and its clause is then true.
 */
const LIST_WHERE = `tenant_id = $1 and deleted_at is null
  and ($2::uuid is null or unit_type_id = $2::uuid)
  and ($3::text is null or status = $3::text)
  and ($4::text is null
    or code ilike $4::text or name->>'en' ilike $4::text or name->>'ar' ilike $4::text)`;

/** The filter's parameters, $1 to $4; the page's limit and offset follow them in the list only. */
const filtersFor = (tenantId: string, query: UnitQuery): readonly unknown[] => [
  tenantId,
  query.unitTypeId ?? null,
  query.status ?? null,
  query.term === undefined ? null : `%${query.term}%`,
];

const toState = (row: UnitRow): OrganizationUnitState => ({
  id: row.id,
  tenantId: row.tenant_id,
  unitTypeId: row.unit_type_id,
  code: row.code,
  name: row.name,
  ...(row.description === null ? {} : { description: row.description }),
  status: row.status as OrganizationStatus,
  metadata: row.metadata,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

export class UnitRepository
  extends Repository<UnitRow & { id: string; version: number }>
  implements UnitStore
{
  public constructor() {
    super('organization_unit');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<OrganizationUnitState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /** Case-insensitive, matching the unique index rather than merely resembling it. */
  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<OrganizationUnitState | undefined> {
    const rows = await transaction.execute<UnitRow>(
      `select ${COLUMNS} from organization_unit
        where tenant_id = $1 and lower(code) = lower($2) and deleted_at is null`,
      [transaction.tenantId, code],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly OrganizationUnitState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<UnitRow>(
      `select ${COLUMNS} from organization_unit
        where tenant_id = $1 and id = any($2::uuid[]) and deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toState);
  }

  /**
   * Free text matches the code and the name in *either* language.
   *
   * `name->>'en'` and `name->>'ar'` rather than casting the whole document to text: casting
   * would also match the language tags themselves, so searching for "ar" would return every
   * unit in the tenant.
   */
  public async list(
    transaction: Transaction,
    query: UnitQuery,
  ): Promise<{ readonly items: readonly OrganizationUnitState[]; readonly total: number }> {
    const filters = filtersFor(transaction.tenantId, query);

    const rows = await transaction.execute<UnitRow>(
      `select ${COLUMNS} from organization_unit where ${LIST_WHERE}
        order by code limit $5 offset $6`,
      [...filters, query.limit, query.offset],
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from organization_unit where ${LIST_WHERE}`,
      filters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async all(transaction: Transaction): Promise<readonly OrganizationUnitState[]> {
    const rows = await transaction.execute<UnitRow>(
      `select ${COLUMNS} from organization_unit
        where tenant_id = $1 and deleted_at is null order by code`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: OrganizationUnitState): Promise<void> {
    await insertRow(
      transaction,
      'organization_unit',
      {
        id: state.id,
        tenant_id: state.tenantId,
        unit_type_id: state.unitTypeId,
        code: state.code,
        name: JSON.stringify(state.name),
        description: state.description === undefined ? null : JSON.stringify(state.description),
        status: state.status,
        metadata: JSON.stringify(state.metadata),
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: OrganizationUnitState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      name: JSON.stringify(state.name),
      description: state.description === undefined ? null : JSON.stringify(state.description),
      status: state.status,
      metadata: JSON.stringify(state.metadata),
      effective_to: state.effectiveTo ?? null,
    });
  }
}
