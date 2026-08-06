import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { EstablishmentStore } from '../application/organization-ports.js';
import type { EstablishmentState } from '../domain/establishment.js';
import type { EstablishmentStatus } from '../domain/organization-vocabulary.js';

import { asVersion, insertRow } from './row-writer.js';

interface EstablishmentRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly position_id: string;
  readonly unit_id: string;
  readonly budgeted_headcount: number;
  readonly status: string;
  readonly approved_at: Date | null;
  readonly approved_by: string | null;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS =
  'id, tenant_id, position_id, unit_id, budgeted_headcount, status, approved_at, approved_by, effective_from, effective_to, version';

const toState = (row: EstablishmentRow): EstablishmentState => ({
  id: row.id,
  tenantId: row.tenant_id,
  positionId: row.position_id,
  unitId: row.unit_id,
  budgetedHeadcount: row.budgeted_headcount,
  status: row.status as EstablishmentStatus,
  ...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
  ...(row.approved_by === null ? {} : { approvedBy: row.approved_by }),
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

export class EstablishmentRepository
  extends Repository<EstablishmentRow & { id: string; version: number }>
  implements EstablishmentStore
{
  public constructor() {
    super('position_establishment');
  }

  public async byId(transaction: Transaction, id: string): Promise<EstablishmentState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  /** Every period for one position in one unit — the timeline the budget is dated on. */
  public async forPositionInUnit(
    transaction: Transaction,
    positionId: string,
    unitId: string,
  ): Promise<readonly EstablishmentState[]> {
    const rows = await transaction.execute<EstablishmentRow>(
      `select ${COLUMNS} from position_establishment
        where tenant_id = $1 and position_id = $2 and unit_id = $3 and deleted_at is null
        order by effective_from`,
      [transaction.tenantId, positionId, unitId],
    );
    return rows.map(toState);
  }

  public async forUnit(
    transaction: Transaction,
    unitId: string,
  ): Promise<readonly EstablishmentState[]> {
    const rows = await transaction.execute<EstablishmentRow>(
      `select ${COLUMNS} from position_establishment
        where tenant_id = $1 and unit_id = $2 and deleted_at is null
        order by position_id, effective_from`,
      [transaction.tenantId, unitId],
    );
    return rows.map(toState);
  }

  public async all(transaction: Transaction): Promise<readonly EstablishmentState[]> {
    const rows = await transaction.execute<EstablishmentRow>(
      `select ${COLUMNS} from position_establishment
        where tenant_id = $1 and deleted_at is null
        order by unit_id, position_id, effective_from`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: EstablishmentState): Promise<void> {
    await insertRow(
      transaction,
      'position_establishment',
      {
        id: state.id,
        tenant_id: state.tenantId,
        position_id: state.positionId,
        unit_id: state.unitId,
        budgeted_headcount: state.budgetedHeadcount,
        status: state.status,
        approved_at: state.approvedAt ?? null,
        approved_by: state.approvedBy ?? null,
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  /**
   * `budgeted_headcount` is not assignable, and `effective_from` is not either.
   *
   * Changing either would rewrite a period rather than supersede it, and the whole reason this
   * table is effective dated is that last year's approved figure must keep its answer. A new
   * number is a new line.
   */
  public async update(
    transaction: Transaction,
    state: EstablishmentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      status: state.status,
      approved_at: state.approvedAt ?? null,
      approved_by: state.approvedBy ?? null,
      effective_to: state.effectiveTo ?? null,
    });
  }
}
