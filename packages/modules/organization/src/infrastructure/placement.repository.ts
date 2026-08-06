import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PlacementStore } from '../application/organization-ports.js';
import type { UnitPlacementState } from '../domain/unit-placement.js';

import { asVersion, insertRow } from './row-writer.js';

interface PlacementRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly unit_id: string;
  readonly parent_unit_id: string | null;
  readonly effective_from: Date;
  readonly effective_to: Date | null;
  readonly version: number | string;
}

const COLUMNS = 'id, tenant_id, unit_id, parent_unit_id, effective_from, effective_to, version';

const toState = (row: PlacementRow): UnitPlacementState => ({
  id: row.id,
  tenantId: row.tenant_id,
  unitId: row.unit_id,
  ...(row.parent_unit_id === null ? {} : { parentUnitId: row.parent_unit_id }),
  effectiveFrom: row.effective_from,
  ...(row.effective_to === null ? {} : { effectiveTo: row.effective_to }),
  version: asVersion(row.version),
});

/**
 * Placement periods — the table that makes historical reorganizations answerable.
 *
 * There is no query here that walks the hierarchy. The walk is in the application layer, over an
 * index built from `all()`, because it is a *rule* (an ancestor chain, a cycle guard) rather than
 * a storage concern, and a recursive CTE here would put a business rule in a repository — which
 * the standards forbid, and which would make the rule untestable without a database.
 *
 * That costs one full read of a tenant's placements per structure query. A structure with ten
 * thousand periods is a few hundred kilobytes and an index scan; an organization large enough
 * for that to matter does not exist, and if one ever does, the fix is the projection store
 * Phase 20 owns rather than a rule moved into SQL.
 */
export class PlacementRepository
  extends Repository<PlacementRow & { id: string; version: number }>
  implements PlacementStore
{
  public constructor() {
    super('organization_unit_placement');
  }

  public async byId(transaction: Transaction, id: string): Promise<UnitPlacementState | undefined> {
    const row = await this.findRow(transaction, id);
    return row === undefined ? undefined : toState(row);
  }

  public async forUnit(
    transaction: Transaction,
    unitId: string,
  ): Promise<readonly UnitPlacementState[]> {
    const rows = await transaction.execute<PlacementRow>(
      `select ${COLUMNS} from organization_unit_placement
        where tenant_id = $1 and unit_id = $2 and deleted_at is null
        order by effective_from`,
      [transaction.tenantId, unitId],
    );
    return rows.map(toState);
  }

  /**
   * Half-open, exactly as `DateRange` is: `effective_from` inclusive, `effective_to` exclusive.
   *
   * With inclusive ends, two adjacent periods would both be in force on the boundary instant,
   * and "which parent did this unit have that day" would have two answers on every move date.
   */
  public async inForceAt(
    transaction: Transaction,
    instant: Date,
  ): Promise<readonly UnitPlacementState[]> {
    const rows = await transaction.execute<PlacementRow>(
      `select ${COLUMNS} from organization_unit_placement
        where tenant_id = $1 and deleted_at is null
          and effective_from <= $2 and (effective_to is null or effective_to > $2)`,
      [transaction.tenantId, instant],
    );
    return rows.map(toState);
  }

  public async all(transaction: Transaction): Promise<readonly UnitPlacementState[]> {
    const rows = await transaction.execute<PlacementRow>(
      `select ${COLUMNS} from organization_unit_placement
        where tenant_id = $1 and deleted_at is null
        order by unit_id, effective_from`,
      [transaction.tenantId],
    );
    return rows.map(toState);
  }

  public async insert(transaction: Transaction, state: UnitPlacementState): Promise<void> {
    await insertRow(
      transaction,
      'organization_unit_placement',
      {
        id: state.id,
        tenant_id: state.tenantId,
        unit_id: state.unitId,
        parent_unit_id: state.parentUnitId ?? null,
        effective_from: state.effectiveFrom,
        effective_to: state.effectiveTo ?? null,
      },
      new Date(),
    );
  }

  public async update(
    transaction: Transaction,
    state: UnitPlacementState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(transaction, state.id, expected, {
      parent_unit_id: state.parentUnitId ?? null,
      effective_to: state.effectiveTo ?? null,
    });
  }
}
