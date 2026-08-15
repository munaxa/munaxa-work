import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { WorkflowDefinitionState } from '../domain/definition.js';
import type {
  DefinitionFilters,
  DefinitionStore,
  Page,
  Paged,
} from '../application/workflow-ports.js';
import {
  definitionColumns,
  definitionState,
  definitionValues,
  type DefinitionRow,
} from './workflow-config-rows.js';
import { insertRow, mutable, pageOf, predicateFor, type Filter } from './row-writer.js';

/**
 * Workflow definitions, as a table.
 *
 * **Nothing here opens a transaction.** Every method takes the `Transaction` the application layer's
 * unit of work established, so a command that writes a definition and its first version does both or
 * neither. A repository that began its own would break that atomicity silently, and the rollback
 * test in the persistence suite is what would catch it.
 *
 * No business rule lives here. These map rows and run the statements the application asked for; the
 * domain decided whether the definition could be retired, and a check constraint refuses the state
 * again at the table.
 *
 * The ordering ends in the identifier on every paged read. Two definitions created in the same
 * millisecond would otherwise page non-deterministically, which is how one row appears on two pages
 * and another on none.
 */
export class PostgresDefinitionRepository
  extends Repository<DefinitionRow & { version: number }>
  implements DefinitionStore
{
  public constructor() {
    super('workflow_definition');
  }

  public async byId(
    transaction: Transaction,
    id: string,
  ): Promise<WorkflowDefinitionState | undefined> {
    const rows = await transaction.execute<DefinitionRow>(
      `select ${definitionColumns('d')} from workflow_definition d
         where d.id = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : definitionState(rows[0]);
  }

  public async byCode(
    transaction: Transaction,
    code: string,
  ): Promise<WorkflowDefinitionState | undefined> {
    const rows = await transaction.execute<DefinitionRow>(
      `select ${definitionColumns('d')} from workflow_definition d
         where d.code = $1 and d.tenant_id = $2 and d.deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : definitionState(rows[0]);
  }

  public search(
    transaction: Transaction,
    filters: DefinitionFilters,
    paged: Paged,
  ): Promise<Page<WorkflowDefinitionState>> {
    const predicate = predicateFor('d', transaction.tenantId, definitionFilters(filters));

    return pageOf<DefinitionRow, WorkflowDefinitionState>(
      transaction,
      {
        select: `select ${definitionColumns('d')} from workflow_definition d
                   where ${predicate.clause}
                   order by d.code, d.id
                   limit $${String(predicate.next)} offset $${String(predicate.next + 1)}`,
        count: `select count(*)::text as total from workflow_definition d where ${predicate.clause}`,
        parameters: predicate.parameters,
        limit: paged.limit,
        offset: paged.offset,
      },
      definitionState,
    );
  }

  public insert(transaction: Transaction, state: WorkflowDefinitionState): Promise<void> {
    return insertRow(
      transaction,
      'workflow_definition',
      definitionValues(state, transaction.tenantId),
      new Date(),
    );
  }

  /**
   * Optimistic. The expected version is in the `where` clause of the `update` rather than in a
   * preceding read, because a read followed by a write is two statements with a gap between them,
   * and the gap is where the second administrator's change disappears. Zero rows affected becomes a
   * `ConcurrencyException`, which the edge renders as 409.
   */
  public async update(
    transaction: Transaction,
    state: WorkflowDefinitionState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.definitionId,
      expected,
      mutable(definitionValues(state, transaction.tenantId)),
    );
  }
}

const definitionFilters = (filters: DefinitionFilters): readonly Filter[] => [
  { column: 'd.status', value: filters.status },
  { column: 'd.subject_type', value: filters.subjectType },
];
