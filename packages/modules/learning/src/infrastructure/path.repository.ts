import { Repository } from '@work/persistence';
import type { Transaction } from '@work/kernel';

import type { PathState, PathStepState } from '../domain/path.js';
import type { MandatoryRuleState } from '../domain/mandatory-rule.js';
import type { MandatoryRuleStore, Page, Paged, PathStore } from '../application/learning-ports.js';
import {
  STEP_COLUMNS,
  pathColumns,
  pathState,
  pathStepState,
  pathStepValues,
  pathValues,
  type PathRow,
  type PathStepRow,
} from './catalogue-rows.js';
import { ruleColumns, ruleState, ruleValues, type RuleRow } from './learner-rows.js';
import { insertRow, mutable, pageOf } from './row-writer.js';

/**
 * Learning paths and the requirements a tenant made mandatory.
 *
 * **A step is soft-deleted, never removed.** Taking a course out of a path changes what the path
 * asks for from now on and leaves every assignment already generated from it alone — what somebody
 * was asked to do in March is a historical fact, and rewriting it would destroy the compliance trail
 * the module exists to keep.
 */

export class PostgresPathRepository
  extends Repository<PathRow & { version: number }>
  implements PathStore
{
  public constructor() {
    super('learning_path');
  }

  public async byId(transaction: Transaction, id: string): Promise<PathState | undefined> {
    const rows = await transaction.execute<PathRow>(
      `select ${pathColumns('p')} from learning_path p
         where p.id = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : pathState(rows[0]);
  }

  public async byCode(transaction: Transaction, code: string): Promise<PathState | undefined> {
    const rows = await transaction.execute<PathRow>(
      `select ${pathColumns('p')} from learning_path p
         where p.code = $1 and p.tenant_id = $2 and p.deleted_at is null`,
      [code, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : pathState(rows[0]);
  }

  public all(transaction: Transaction, paged: Paged): Promise<Page<PathState>> {
    return pageOf<PathRow, PathState>(
      transaction,
      {
        select: `select ${pathColumns('p')} from learning_path p
                   where p.tenant_id = $1 and p.deleted_at is null
                   order by p.code
                   limit $2 offset $3`,
        count: `select count(*)::text as total from learning_path p
                  where p.tenant_id = $1 and p.deleted_at is null`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      pathState,
    );
  }

  public async stepsFor(
    transaction: Transaction,
    pathId: string,
  ): Promise<readonly PathStepState[]> {
    const rows = await transaction.execute<PathStepRow>(
      `select ${STEP_COLUMNS} from learning_path_step
         where path_id = $1 and tenant_id = $2 and deleted_at is null
         order by sequence`,
      [pathId, transaction.tenantId],
    );

    return rows.map(pathStepState);
  }

  public insert(transaction: Transaction, state: PathState): Promise<void> {
    return insertRow(transaction, this.table, pathValues(state, transaction.tenantId), new Date());
  }

  public async update(transaction: Transaction, state: PathState, expected: number): Promise<void> {
    await this.updateRow(
      transaction,
      state.pathId,
      expected,
      mutable(pathValues(state, transaction.tenantId)),
    );
  }

  public insertStep(transaction: Transaction, state: PathStepState): Promise<void> {
    return insertRow(
      transaction,
      'learning_path_step',
      pathStepValues(state, transaction.tenantId),
      new Date(),
    );
  }

  /**
   * A step leaves the path by being soft-deleted.
   *
   * The partial unique indexes on `(tenant, path, sequence)` and `(tenant, path, course)` both
   * exclude deleted rows, so the position and the course are free again immediately — which is what
   * "reorder a path" has to mean.
   */
  public async removeStep(
    transaction: Transaction,
    stepId: string,
    at: Date,
    by: string,
  ): Promise<void> {
    await transaction.execute(
      `update learning_path_step
          set deleted_at = $3, deleted_by = $4, updated_at = $3, updated_by = $4,
              version = version + 1
        where id = $1 and tenant_id = $2 and deleted_at is null`,
      [stepId, transaction.tenantId, at, by],
    );
  }
}

export class PostgresMandatoryRuleRepository
  extends Repository<RuleRow & { version: number }>
  implements MandatoryRuleStore
{
  public constructor() {
    super('learning_mandatory_rule');
  }

  public async byId(transaction: Transaction, id: string): Promise<MandatoryRuleState | undefined> {
    const rows = await transaction.execute<RuleRow>(
      `select ${ruleColumns('r')} from learning_mandatory_rule r
         where r.id = $1 and r.tenant_id = $2 and r.deleted_at is null`,
      [id, transaction.tenantId],
    );

    return rows[0] === undefined ? undefined : ruleState(rows[0]);
  }

  public all(
    transaction: Transaction,
    activeOnly: boolean,
    paged: Paged,
  ): Promise<Page<MandatoryRuleState>> {
    // The active filter is a literal clause rather than a parameter: a boolean placeholder compared
    // to a boolean column is one of the shapes PostgreSQL cannot deduce a type for.
    const activeClause = activeOnly ? ' and r.active' : '';

    return pageOf<RuleRow, MandatoryRuleState>(
      transaction,
      {
        select: `select ${ruleColumns('r')} from learning_mandatory_rule r
                   where r.tenant_id = $1 and r.deleted_at is null${activeClause}
                   order by r.effective_from desc, r.id desc
                   limit $2 offset $3`,
        count: `select count(*)::text as total from learning_mandatory_rule r
                  where r.tenant_id = $1 and r.deleted_at is null${activeClause}`,
        parameters: [transaction.tenantId],
        limit: paged.limit,
        offset: paged.offset,
      },
      ruleState,
    );
  }

  public insert(transaction: Transaction, state: MandatoryRuleState): Promise<void> {
    return insertRow(transaction, this.table, ruleValues(state, transaction.tenantId), new Date());
  }

  public async update(
    transaction: Transaction,
    state: MandatoryRuleState,
    expected: number,
  ): Promise<void> {
    await this.updateRow(
      transaction,
      state.mandatoryRuleId,
      expected,
      mutable(ruleValues(state, transaction.tenantId)),
    );
  }
}
