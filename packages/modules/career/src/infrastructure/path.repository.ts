import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { CareerPathState, CareerStageState } from '../domain/path.js';
import type { Page, Paged, PathFilters, PathStore } from '../application/career-ports.js';
import {
  STAGE_COLUMNS,
  pathColumns,
  pathState,
  pathValues,
  stageState,
  stageValues,
  type PathRow,
  type StageRow,
} from './career-config-rows.js';
import { asNumber, insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Career paths and the stages along them, as tables.
 *
 * **Nothing here opens a transaction.** Every method takes the `Transaction` the application layer's
 * unit of work established, so a command that writes a path and its first stage does both or
 * neither. A repository that began its own would break that atomicity silently, and the rollback
 * test in the persistence suite is what would catch it.
 *
 * No business rule lives here. These map rows and run the statements the application asked for; the
 * domain decided whether the path could be published, and a check constraint refuses the state
 * again at the table.
 */
export class PostgresPathRepository
  extends Repository<PathRow & { version: number }>
  implements PathStore
{
  public constructor() {
    super('career_path');
  }

  public async byId(transaction: Transaction, id: string): Promise<CareerPathState | undefined> {
    const rows = await transaction.execute<PathRow>(
      `select ${pathColumns('p')} from career_path p
         where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : pathState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<CareerPathState | undefined> {
    const rows = await transaction.execute<PathRow>(
      `select ${pathColumns('p')} from career_path p
         where p.code = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : pathState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: PathFilters,
    paged: Paged,
  ): Promise<Page<CareerPathState>> {
    const predicate = predicateFor('p', transaction.tenantId, pathFilters(filters));

    return pageOf<PathRow, CareerPathState>(
      transaction,
      {
        select: `select ${pathColumns('p')} from career_path p
                   where ${predicate.clause}
                   order by p.code
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from career_path p where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      pathState,
    );
  }

  /** In sequence order. The order is an order along the path and never a prerequisite (D-17). */
  public async stagesFor(
    transaction: Transaction,
    pathId: string,
  ): Promise<readonly CareerStageState[]> {
    const rows = await transaction.execute<StageRow>(
      `select ${STAGE_COLUMNS} from career_stage
         where path_id = $1 and tenant_id = $2 and deleted_at is null
         order by sequence`,
      [pathId, transaction.tenantId],
    );

    return rows.map(stageState);
  }

  /**
   * Counted by the database rather than by the length of a page.
   *
   * `publishPath` refuses a path with no stages, and a count taken from a page would be right until
   * a path had more stages than the page held — at which point it would still be right, and then
   * wrong the first time somebody paged. Counting is simply what the question asks for.
   */
  public async stageCountOf(transaction: Transaction, pathId: string): Promise<number> {
    const rows = await transaction.execute<{ total: string }>(
      `select count(*)::text as total from career_stage
         where path_id = $1 and tenant_id = $2 and deleted_at is null`,
      [pathId, transaction.tenantId],
    );

    return asNumber(rows[0]?.total ?? '0');
  }

  public async stageById(
    transaction: Transaction,
    id: string,
  ): Promise<CareerStageState | undefined> {
    const rows = await transaction.execute<StageRow>(
      `select ${STAGE_COLUMNS} from career_stage
         where id = $1 and tenant_id = $2 and deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : stageState(rows[0]);
  }

  public insert(transaction: Transaction, state: CareerPathState): Promise<void> {
    return insertRow(transaction, this.table, pathValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: CareerPathState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.pathId,
      expected,
      mutable(pathValues(state, transaction.tenantId)),
    );
  }

  public insertStage(transaction: Transaction, state: CareerStageState): Promise<void> {
    return insertRow(
      transaction,
      'career_stage',
      stageValues(state, transaction.tenantId),
      new Date(),
    );
  }
}

const pathFilters = (filters: PathFilters): readonly Filter[] => [
  { column: 'p.status', value: filters.status },
  { column: 'p.kind', value: filters.kind },
];
