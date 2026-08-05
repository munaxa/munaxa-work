import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { UnitTypeStore } from '../application/organization-ports.js';
import type { BilingualName } from '../domain/organization-aggregate.js';
import type { OrganizationUnitTypeState } from '../domain/organization-unit-type.js';
import type { OrganizationStatus } from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface UnitTypeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly code: string;
  readonly name: BilingualName;
  readonly ordinal: number;
  readonly allowed_parent_codes: readonly string[];
  readonly allowed_at_root: boolean;
  readonly carries_legal_entity: boolean;
  readonly status: string;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, code, name, ordinal, allowed_parent_codes, allowed_at_root, carries_legal_entity, status, version';

const toState = (row: UnitTypeRow): OrganizationUnitTypeState => ({
  id: row.id,
  tenantId: row.tenant_id,
  code: row.code,
  name: row.name,
  ordinal: row.ordinal,
  allowedParentCodes: row.allowed_parent_codes,
  allowedAtRoot: row.allowed_at_root,
  carriesLegalEntity: row.carries_legal_entity,
  status: row.status as OrganizationStatus,
  version: asVersion(row.version),
});

export class UnitTypeRepository
  extends Repository<UnitTypeRow & { id: string; version: number }>
  implements UnitTypeStore
{
  public constructor() {
    super('organization_unit_type');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<OrganizationUnitTypeState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<OrganizationUnitTypeState | undefined> {
    const rows = await transaction.execute<UnitTypeRow>(
      `select ${COLUMNS} from organization_unit_type
        where tenant_id = $1 and lower(code) = lower($2) and deleted_at is null`,
      [transaction.tenantId, code],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  /** Ordered by the tenant's own display order, then by code so the order is total. */
  public async list(transaction: Transaction): Promise<readonly OrganizationUnitTypeState[]> {
    const rows = await transaction.execute<UnitTypeRow>(
      `select ${COLUMNS} from organization_unit_type
        where tenant_id = $1 and deleted_at is null order by ordinal, code`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: OrganizationUnitTypeState): Promise<void> {
    await insertRow(
      transaction,
      'organization_unit_type',
      {
        id: state.id,
        tenant_id: state.tenantId,
        code: state.code,
        name: JSON.stringify(state.name),
        ordinal: state.ordinal,
        allowed_parent_codes: [...state.allowedParentCodes],
        allowed_at_root: state.allowedAtRoot,
        carries_legal_entity: state.carriesLegalEntity,
        status: state.status,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: OrganizationUnitTypeState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      name: JSON.stringify(state.name),
      ordinal: state.ordinal,
      allowed_parent_codes: [...state.allowedParentCodes],
      allowed_at_root: state.allowedAtRoot,
      carries_legal_entity: state.carriesLegalEntity,
      status: state.status,
    });
  }
}
