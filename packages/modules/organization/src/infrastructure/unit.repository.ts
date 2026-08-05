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
 * The `where` clause and its parameters, built once.
 *
 * Extracted from `list` so the method stays inside the complexity budget repositories are held
 * to — five, deliberately tighter than the general limit, because a repository that needs
 * branching is usually one with a business rule creeping into it.
 */
const whereClauses = (query: UnitQuery): readonly string[] =>
  [
    'tenant_id = $1',
    'deleted_at is null',
    query.unitTypeId === undefined ? undefined : 'unit_type_id = $2',
    query.status === undefined ? undefined : 'status = $3',
    query.term === undefined
      ? undefined
      : "(code ilike $4 or name->>'en' ilike $4 or name->>'ar' ilike $4)",
  ].filter((clause): clause is string => clause !== undefined);

const filtersFor = (
  tenantId: string,
  query: UnitQuery,
): { readonly where: string; readonly parameters: readonly unknown[] } => ({
  where: whereClauses(query).join(' and '),
  parameters: [
    tenantId,
    query.unitTypeId ?? null,
    query.status ?? null,
    query.term === undefined ? null : `%${query.term}%`,
    query.limit,
    query.offset,
  ],
});

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
    const { where, parameters } = filtersFor(transaction.tenantId, query);

    const rows = await transaction.execute<UnitRow>(
      `select ${COLUMNS} from organization_unit where ${where} order by code limit $5 offset $6`,
      parameters,
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from organization_unit where ${where}`,
      parameters,
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
