import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CenterQuery, FinancialCenterStore } from '../application/organization-ports.js';
import type { CenterKind, FinancialCenterState } from '../domain/financial-center.js';
import type { BilingualName, Metadata } from '../domain/organization-aggregate.js';
import type { OrganizationStatus } from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface CenterRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly kind: string;
  readonly code: string;
  readonly name: BilingualName;
  readonly unit_id: string | null;
  readonly status: string;
  readonly metadata: Metadata;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, kind, code, name, unit_id, status, metadata, effective_from, effective_to, version';

const toState = (row: CenterRow): FinancialCenterState => ({
  id: row.id,
  tenantId: row.tenant_id,
  kind: row.kind as CenterKind,
  code: row.code,
  name: row.name,
  ...(row.unit_id === null ? {} : { unitId: row.unit_id }),
  status: row.status as OrganizationStatus,
  metadata: row.metadata,
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

/**
 * Cost and profit centres share a table and are distinguished by `kind`.
 *
 * Two tables would be two near-identical repositories, which is duplicated logic the standards
 * forbid — and the duplication would drift the first time one of them gained a column. The
 * *permissions* are what stay separate, and the read path takes `kind` on every lookup so a
 * caller holding one permission cannot reach the other kind by identifier.
 */
export class FinancialCenterRepository
  extends Repository<CenterRow & { id: string; version: number }>
  implements FinancialCenterStore
{
  public constructor() {
    super('financial_center');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<FinancialCenterState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async byCode(
    transaction: Transaction,
    kind: CenterKind,
    code: string,
  ): Promise<FinancialCenterState | undefined> {
    const rows = await transaction.execute<CenterRow>(
      `select ${COLUMNS} from financial_center
        where tenant_id = $1 and kind = $2 and lower(code) = lower($3) and deleted_at is null`,
      [transaction.tenantId, kind, code],
    );
    const row = rows[0];
    return row === undefined ? undefined : toState(row);
  }

  public async list(
    transaction: Transaction,
    query: CenterQuery,
  ): Promise<{ readonly items: readonly FinancialCenterState[]; readonly total: number }> {
    const where =
      query.status === undefined
        ? 'tenant_id = $1 and kind = $2 and deleted_at is null'
        : 'tenant_id = $1 and kind = $2 and status = $3 and deleted_at is null';
    const parameters = [
      transaction.tenantId,
      query.kind,
      query.status ?? null,
      query.limit,
      query.offset,
    ];
    const rows = await transaction.execute<CenterRow>(
      `select ${COLUMNS} from financial_center where ${where} order by code limit $4 offset $5`,
      parameters,
    );
    const counted = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from financial_center where ${where}`,
      parameters,
    );

    return { items: rows.map(toState), total: Number(counted[0]?.total ?? '0') };
  }

  public async insert(transaction: Transaction, state: FinancialCenterState): Promise<void> {
    await insertRow(
      transaction,
      'financial_center',
      {
        id: state.id,
        tenant_id: state.tenantId,
        kind: state.kind,
        code: state.code,
        name: JSON.stringify(state.name),
        unit_id: state.unitId ?? null,
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
    state: FinancialCenterState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      name: JSON.stringify(state.name),
      unit_id: state.unitId ?? null,
      status: state.status,
      metadata: JSON.stringify(state.metadata),
      effective_to: state.effectiveTo ?? null,
    });
  }
}
