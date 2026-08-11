import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CompensationComponentState } from '../domain/compensation-component.js';
import type { ComponentStore } from '../application/compensation-ports.js';

import {
  COMPONENT_COLUMNS,
  componentValues,
  toComponent,
  type ComponentRow,
} from './definition-rows.js';
import { insertRow, mutable } from './row-writer.js';

/**
 * The component catalogue, in PostgreSQL.
 *
 * `byIds` is the one worth reading: a page of compensation records refers to a handful of distinct
 * components, and reading them one at a time would be the N+1 every register read would pay.
 *
 * Apart from `definition.repository.ts` because that file holds the plan, its component terms and
 * its assignments, and one repository file for all four ran past its budget.
 */

export class ComponentRepository
  extends Repository<{ id: string; version: number }>
  implements ComponentStore
{
  public constructor() {
    super('compensation_component');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<CompensationComponentState | undefined> {
    const rows = await transaction.execute<ComponentRow>(
      `select ${COMPONENT_COLUMNS} from compensation_component c
        where c.id = $1 and c.tenant_id = $2 and c.deleted_at is null`,
      [id, transaction.tenantId],
    );
    const row = rows[0];

    return row === undefined ? undefined : toComponent(row);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CompensationComponentState | undefined> {
    const rows = await transaction.execute<ComponentRow>(
      `select ${COMPONENT_COLUMNS} from compensation_component c
        where c.tenant_id = $1 and c.code = $2 and c.deleted_at is null
        order by c.version_number desc limit 1`,
      [transaction.tenantId, code],
    );
    const row = rows[0];

    return row === undefined ? undefined : toComponent(row);
  }

  public async byIds(
    transaction: Transaction,
    ids: readonly string[],
  ): Promise<readonly CompensationComponentState[]> {
    if (ids.length === 0) return [];

    const rows = await transaction.execute<ComponentRow>(
      `select ${COMPONENT_COLUMNS} from compensation_component c
        where c.tenant_id = $1 and c.id = any($2::uuid[]) and c.deleted_at is null`,
      [transaction.tenantId, [...ids]],
    );
    return rows.map(toComponent);
  }

  public async all(transaction: Transaction): Promise<readonly CompensationComponentState[]> {
    const rows = await transaction.execute<ComponentRow>(
      `select ${COMPONENT_COLUMNS} from compensation_component c
        where c.tenant_id = $1 and c.deleted_at is null
        order by c.code, c.version_number`,
      [transaction.tenantId],
    );
    return rows.map(toComponent);
  }

  public async insert(transaction: Transaction, state: CompensationComponentState): Promise<void> {
    await insertRow(transaction, 'compensation_component', componentValues(state), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CompensationComponentState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, mutable(componentValues(state)));
  }
}
