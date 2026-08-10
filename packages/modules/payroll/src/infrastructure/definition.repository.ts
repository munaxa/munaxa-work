import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { DeductionDefinitionState } from '../domain/deductions.js';
import type { PayrollGroupState } from '../domain/payroll-group.js';
import type { PayrollPeriodState } from '../domain/payroll-period.js';
import type {
  DeductionDefinitionStore,
  GroupStore,
  Page,
  Paged,
  PeriodStore,
} from '../application/payroll-ports.js';
import {
  deductionDefinitionState,
  deductionDefinitionValues,
  groupState,
  groupValues,
  periodState,
  periodValues,
  PERIOD_COLUMNS,
  type DeductionDefinitionRow,
  type PayrollGroupRow,
  type PayrollPeriodRow,
} from './definition-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/**
 * The configuration tables, in PostgreSQL.
 *
 * The tenant is filtered in every statement **and** enforced by row-level security. The filter makes
 * the intent legible in the query plan; the policy makes it true even if a filter were ever wrong
 * (ADR-0030). Nothing here selects from another module's table, and nothing joins to one.
 */

export class PostgresGroupRepository extends Repository<PayrollGroupRow> implements GroupStore {
  public constructor() {
    super('payroll_group');
  }

  public async byId(transaction: Transaction, id: string): Promise<PayrollGroupState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : groupState(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<PayrollGroupState | undefined> {
    const rows = await transaction.execute<PayrollGroupRow>(
      `select * from payroll_group where tenant_id = $1 and code = $2 and deleted_at is null`,
      [transaction.tenantId, code],
    );

    return rows[0] === undefined ? undefined : groupState(rows[0]);
  }

  public async all(transaction: Transaction): Promise<readonly PayrollGroupState[]> {
    const rows = await transaction.execute<PayrollGroupRow>(
      `select * from payroll_group where tenant_id = $1 and deleted_at is null order by code`,
      [transaction.tenantId],
    );

    return rows.map(groupState);
  }

  public insert(transaction: Transaction, state: PayrollGroupState): Promise<void> {
    return insertRow(transaction, this.table, groupValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: PayrollGroupState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.payrollGroupId,
      expected,
      mutable(groupValues(state, transaction.tenantId)),
    );
  }
}

export class PostgresDeductionDefinitionRepository
  extends Repository<DeductionDefinitionRow>
  implements DeductionDefinitionStore
{
  public constructor() {
    super('payroll_deduction_definition');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<DeductionDefinitionState | undefined> {
    const row = await this.findRow(transaction, id);

    return row === undefined ? undefined : deductionDefinitionState(row);
  }

  public async forGroup(
    transaction: Transaction,
    groupId: string,
  ): Promise<readonly DeductionDefinitionState[]> {
    const rows = await transaction.execute<DeductionDefinitionRow>(
      `select * from payroll_deduction_definition
         where tenant_id = $1 and payroll_group_id = $2 and deleted_at is null
         order by priority, code`,
      [transaction.tenantId, groupId],
    );

    return rows.map(deductionDefinitionState);
  }

  public insert(transaction: Transaction, state: DeductionDefinitionState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      deductionDefinitionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: DeductionDefinitionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.deductionDefinitionId,
      expected,
      mutable(deductionDefinitionValues(state, transaction.tenantId)),
    );
  }
}

export class PostgresPeriodRepository extends Repository<PayrollPeriodRow> implements PeriodStore {
  public constructor() {
    super('payroll_period');
  }

  public async byId(transaction: Transaction, id: string): Promise<PayrollPeriodState | undefined> {
    const rows = await transaction.execute<PayrollPeriodRow>(
      `select ${PERIOD_COLUMNS} from payroll_period p
         where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : periodState(rows[0]);
  }

  public async forGroup(
    transaction: Transaction,
    groupId: string,
  ): Promise<readonly PayrollPeriodState[]> {
    const rows = await transaction.execute<PayrollPeriodRow>(
      `select ${PERIOD_COLUMNS} from payroll_period p
         where p.tenant_id = $1 and p.payroll_group_id = $2 and p.deleted_at is null
         order by p.period_start desc, p.id desc`,
      [transaction.tenantId, groupId],
    );

    return rows.map(periodState);
  }

  /**
   * The register's sort, exactly.
   *
   * `id desc` rather than `id`, because PostgreSQL can only walk an index backwards when **every**
   * key reverses — the Phase 10 lesson, applied here from the start rather than after a benchmark
   * found a sort.
   */
  public page(transaction: Transaction, paged: Paged): Promise<Page<PayrollPeriodState>> {
    return pageOf<PayrollPeriodRow, PayrollPeriodState>(
      transaction,
      {
        select: `select ${PERIOD_COLUMNS} from payroll_period p
                   where p.tenant_id = $1 and p.deleted_at is null
                   order by p.period_start desc, p.id desc limit $2 offset $3`,
        count: `select count(*)::text as total from payroll_period p
                  where p.tenant_id = $1 and p.deleted_at is null`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      periodState,
    );
  }

  public insert(transaction: Transaction, state: PayrollPeriodState): Promise<void> {
    return insertRow(
      transaction,
      this.table,
      periodValues(state, transaction.tenantId),
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: PayrollPeriodState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.payrollPeriodId,
      expected,
      mutable(periodValues(state, transaction.tenantId)),
    );
  }
}
